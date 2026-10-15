#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import { main } from "./main.js";
import { terminalPrompt } from "./prompt.js";

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
  fetch: (url, init) => fetch(url, init),
  now: () => new Date(),
  env: process.env,
  prompt: terminalPrompt(),
  smoobuFetch: (url, init) => fetch(url, init),
  beds24Fetch: (url, init) => fetch(url, init),
  airroiFetch: (url, init) => fetch(url, init),
  alloggiatiFetch: (url, init) => fetch(url, init),
  system: {
    platform: process.platform,
    home: os.homedir(),
    user: process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    node: process.execPath,
    script: process.argv[1] ?? "",
  },
  run: (command, args) => {
    const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : "") };
  },
  openUrl: (url) => {
    // The default browser: "start" on Windows, "open" on a Mac, xdg-open elsewhere.
    const [cmd, args]: [string, string[]] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {}); // no browser to open: the address is printed anyway
    child.unref();
  },
});
