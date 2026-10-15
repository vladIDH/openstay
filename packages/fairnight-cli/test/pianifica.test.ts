import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SystemInfo } from "../src/io.js";
import { main } from "../src/main.js";
import { agentLabel, macAgent, taskName, windowsTask } from "../src/pianifica.js";
import { tempDir, testIo } from "./helpers.js";

const WINDOWS: SystemInfo = {
  platform: "win32",
  home: "C:\\Users\\anna",
  user: "PC-ANNA\\anna",
  uid: null,
  node: "C:\\Users\\anna\\Fairnight\\programma\\node\\node.exe",
  script: "C:\\Users\\anna\\Fairnight\\programma\\fairnight.js",
};

async function folder() {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  return dir;
}

/** A fake schtasks / launchctl: records the calls, answers with the given status. */
function runner(status: (cmd: string, args: string[]) => number = () => 0) {
  const calls: { cmd: string; args: string[]; file?: Buffer }[] = [];
  const run = (cmd: string, args: string[]) => {
    const i = args.indexOf("/XML");
    calls.push({ cmd, args, ...(i >= 0 ? { file: readFileSync(args[i + 1] as string) } : {}) });
    return { status: status(cmd, args), stdout: "", stderr: status(cmd, args) === 0 ? "" : "ERROR: invented" };
  };
  return { calls, run };
}

describe("the daily task on Windows", () => {
  it("runs every day at the time and at sign-in, catches up a missed run, no window, no administrator", () => {
    const task = windowsTask("C:\\Users\\anna\\Fairnight", "06:00", WINDOWS, "2026-11-01");
    expect(task).toContain("<StartBoundary>2026-11-01T06:00:00</StartBoundary>");
    expect(task).toContain("<DaysInterval>1</DaysInterval>");
    expect(task).toMatch(/<LogonTrigger>[\s\S]*<UserId>PC-ANNA\\anna<\/UserId>[\s\S]*<Delay>PT2M<\/Delay>/);
    expect(task).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(task).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(task).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(task).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(task).toMatch(/<Command>.*conhost\.exe<\/Command>/);
    expect(task).toContain(
      "<Arguments>--headless &quot;C:\\Users\\anna\\Fairnight\\programma\\node\\node.exe&quot; &quot;C:\\Users\\anna\\Fairnight\\programma\\fairnight.js&quot; pilota giro --pianificato --dir &quot;C:\\Users\\anna\\Fairnight&quot;</Arguments>",
    );
  });

  it("escapes a folder name that would break the XML", () => {
    const task = windowsTask("C:\\Users\\a&b\\<F>", "06:00", WINDOWS, "2026-11-01");
    expect(task).toContain("C:\\Users\\a&amp;b\\&lt;F&gt;");
    expect(task).not.toContain("a&b");
  });

  it("pianifica creates the task from a UTF-16 file, keeps the time in the config, and removes the file", async () => {
    const dir = await folder();
    const r = runner();
    const t = testIo(dir);
    Object.assign(t, { system: WINDOWS, run: r.run });
    expect(await main(["pilota", "pianifica", "--ora", "07:15"], t)).toBe(0);
    const call = r.calls[0];
    expect(call?.cmd).toBe("schtasks");
    expect(call?.args.slice(0, 3)).toEqual(["/Create", "/TN", taskName(dir)]);
    expect(call?.args.at(-1)).toBe("/F");
    expect([...(call?.file ?? Buffer.alloc(0)).subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(call?.file?.subarray(2).toString("utf16le")).toContain("<StartBoundary>2026-11-01T07:15:00</StartBoundary>");
    expect(existsSync(call?.args[4] as string)).toBe(false);
    expect(JSON.parse(readFileSync(path.join(dir, "fairnight.config.json"), "utf8")).pilot).toEqual({ time: "07:15" });
    expect(t.lines.at(-1)).toBe(`Daily run set up at 07:15 (Task Scheduler, "${taskName(dir)}"). If the computer is off then, it runs when it is back on.`);
  });

  it("togli deletes the task, and says so when there was none", async () => {
    const dir = await folder();
    let exists = true;
    const r = runner((_, args) => (args[0] === "/Query" && !exists ? 1 : 0));
    const t = testIo(dir);
    Object.assign(t, { system: WINDOWS, run: r.run });
    await main(["pilota", "togli"], t);
    expect(r.calls.map((c) => c.args[0])).toEqual(["/Query", "/Delete"]);
    expect(t.lines.at(-1)).toBe("Daily run removed from this computer.");
    exists = false;
    await main(["pilota", "togli"], t);
    expect(t.lines.at(-1)).toBe("There was no daily run on this computer.");
  });

  it("says what Task Scheduler answered when it refuses", async () => {
    const dir = await folder();
    const t = testIo(dir);
    Object.assign(t, { system: WINDOWS, run: runner(() => 1).run });
    expect(await main(["pilota", "pianifica"], t)).toBe(1);
    expect(t.errors.join("\n")).toContain("Task Scheduler failed: ERROR: invented");
  });

  it("a wrong time is refused before anything is touched", async () => {
    const dir = await folder();
    const r = runner();
    const t = testIo(dir);
    Object.assign(t, { system: WINDOWS, run: r.run });
    expect(await main(["pilota", "pianifica", "--ora", "6"], t)).toBe(2);
    expect(r.calls).toEqual([]);
  });
});

describe("the daily task on a Mac", () => {
  it("is a LaunchAgent at the time and at login, logging next to the data", async () => {
    const dir = await folder();
    const home = tempDir();
    const mac: SystemInfo = { platform: "darwin", home, user: "anna", uid: 501, node: "/Users/anna/Fairnight/programma/node/bin/node", script: "/Users/anna/Fairnight/programma/fairnight.js" };
    const r = runner();
    const t = testIo(dir);
    Object.assign(t, { system: mac, run: r.run });
    expect(await main(["pilota", "pianifica", "--ora", "05:30"], t)).toBe(0);
    const file = path.join(home, "Library", "LaunchAgents", `${agentLabel(dir)}.plist`);
    const plist = readFileSync(file, "utf8");
    expect(plist).toContain("<key>Hour</key>\n    <integer>5</integer>");
    expect(plist).toContain("<key>Minute</key>\n    <integer>30</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<string>--pianificato</string>");
    expect(r.calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ["launchctl", "bootout", `gui/501/${agentLabel(dir)}`],
      ["launchctl", "bootstrap", "gui/501", file],
    ]);

    await main(["pilota", "togli"], t);
    expect(existsSync(file)).toBe(false);
    expect(t.lines.at(-1)).toBe("Daily run removed from this computer.");
  });

  it("the plist has the arguments in order", () => {
    const mac: SystemInfo = { platform: "darwin", home: "/Users/anna", user: "anna", uid: 501, node: "/n/node", script: "/n/fairnight.js" };
    const plist = macAgent("/Users/anna/Fairnight", "06:00", mac);
    const args = [...plist.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    expect(args.slice(1, 8)).toEqual(["/n/node", "/n/fairnight.js", "pilota", "giro", "--pianificato", "--dir", "/Users/anna/Fairnight"]);
  });
});

describe("elsewhere", () => {
  it("explains how to run it every day by hand", async () => {
    const dir = await folder();
    const t = testIo(dir);
    Object.assign(t, { system: { ...WINDOWS, platform: "linux" }, run: runner().run });
    expect(await main(["pilota", "pianifica"], t)).toBe(1);
    expect(t.errors.join("\n")).toContain('run "fairnight pilota giro --pianificato" every day with cron or a systemd timer');
  });

  it("without a way to run programs it says it cannot", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "x"), "");
    const t = testIo(dir);
    expect(await main(["pilota", "pianifica"], t)).toBe(1);
    expect(t.errors.join("\n")).toContain("cannot be told to run Fairnight every day");
  });
});
