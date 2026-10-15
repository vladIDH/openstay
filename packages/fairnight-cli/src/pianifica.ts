/**
 * The daily run of the autopilot on the host's computer, with no terminal:
 *
 * - Windows: a task of the user in Task Scheduler (no administrator, no saved
 *   password), every day at the chosen time and when the user signs in. "Start
 *   when available" runs a missed one as soon as the computer is back on. It
 *   starts without a window (conhost --headless).
 * - Mac: a LaunchAgent in ~/Library/LaunchAgents, at the chosen time and at
 *   login; a Mac that was asleep runs it when it wakes up.
 *
 * Both start `fairnight pilota giro --pianificato`, which does nothing when
 * today's run is already done: the sign-in start only catches up.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SetupError } from "./config.js";
import { DATA_DIR, type Io, type SystemInfo } from "./io.js";
import { folderId } from "./serve.js";

/** One task per Fairnight folder, so two folders on one computer do not clash. */
export const taskName = (dir: string) => `Fairnight pilota ${folderId(dir).slice(0, 8)}`;
export const agentLabel = (dir: string) => `dev.fairnight.pilota.${folderId(dir).slice(0, 8)}`;
export const PILOT_LOG = "pilota.log";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A Windows command-line argument in double quotes (paths with spaces). */
const quoteWin = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

const runArgs = (dir: string) => ["pilota", "giro", "--pianificato", "--dir", dir];

/** The Task Scheduler definition (schtasks /XML). */
export function windowsTask(dir: string, time: string, sys: SystemInfo, today: string): string {
  const args = [quoteWin(sys.node), quoteWin(sys.script), ...runArgs(dir).map((a) => (a === dir ? quoteWin(a) : a))].join(" ");
  const conhost = path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "conhost.exe");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(`Fairnight: reads the calendars and, for the houses where the autopilot is on, sends the new prices. Folder: ${dir}`)}</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${today}T${time}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xml(sys.user)}</UserId>
      <Delay>PT2M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(sys.user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(conhost)}</Command>
      <Arguments>${xml(`--headless ${args}`)}</Arguments>
      <WorkingDirectory>${xml(dir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** The LaunchAgent (a property list). */
export function macAgent(dir: string, time: string, sys: SystemInfo): string {
  const [hour, minute] = time.split(":").map(Number);
  const log = path.posix.join(dir, DATA_DIR, "pilota-launchd.log");
  const strings = [sys.node, sys.script, ...runArgs(dir)].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${agentLabel(dir)}</string>
  <key>ProgramArguments</key>
  <array>
${strings}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(dir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

const agentFile = (dir: string, sys: SystemInfo) => path.join(sys.home, "Library", "LaunchAgents", `${agentLabel(dir)}.plist`);

function needs(io: Io): { sys: SystemInfo; run: NonNullable<Io["run"]> } {
  if (!io.system || !io.run) throw new SetupError("This computer cannot be told to run Fairnight every day from here.");
  if (io.system.platform !== "win32" && io.system.platform !== "darwin") {
    throw new SetupError('The daily run can be set up on Windows and on a Mac. Elsewhere, run "fairnight pilota giro --pianificato" every day with cron or a systemd timer.');
  }
  return { sys: io.system, run: io.run };
}

function check(r: { status: number | null; stdout: string; stderr: string }, what: string): void {
  if (r.status !== 0) throw new SetupError(`${what} failed: ${(r.stderr || r.stdout).trim() || `exit code ${r.status}`}`);
}

/** Set up (or replace) the daily run at time ("06:00"). Returns where it lives, for the host. */
export function installSchedule(dir: string, io: Io, time: string, today: string): string {
  const { sys, run } = needs(io);
  if (sys.platform === "win32") {
    const file = path.join(dir, DATA_DIR, "pilota-task.xml");
    mkdirSync(path.dirname(file), { recursive: true });
    // schtasks reads the file as UTF-16 with its byte-order mark.
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsTask(dir, time, sys, today), "utf16le")]));
    try {
      check(run("schtasks", ["/Create", "/TN", taskName(dir), "/XML", file, "/F"]), "Task Scheduler");
    } finally {
      rmSync(file, { force: true });
    }
    return `Task Scheduler, "${taskName(dir)}"`;
  }
  const file = agentFile(dir, sys);
  mkdirSync(path.dirname(file), { recursive: true });
  run("launchctl", ["bootout", `gui/${sys.uid}/${agentLabel(dir)}`]); // an older one, if any
  writeFileSync(file, macAgent(dir, time, sys), "utf8");
  check(run("launchctl", ["bootstrap", `gui/${sys.uid}`, file]), "launchctl");
  return file;
}

/** Remove the daily run. False when there was none. */
export function removeSchedule(dir: string, io: Io): boolean {
  const { sys, run } = needs(io);
  if (sys.platform === "win32") {
    if (run("schtasks", ["/Query", "/TN", taskName(dir)]).status !== 0) return false;
    check(run("schtasks", ["/Delete", "/TN", taskName(dir), "/F"]), "Task Scheduler");
    return true;
  }
  const file = agentFile(dir, sys);
  const had = existsSync(file);
  run("launchctl", ["bootout", `gui/${sys.uid}/${agentLabel(dir)}`]);
  rmSync(file, { force: true });
  return had;
}

/** Is the daily run set up on this computer? null when it cannot tell. */
export function isScheduled(dir: string, io: Io): boolean | null {
  if (!io.system || !io.run) return null;
  if (io.system.platform === "win32") return io.run("schtasks", ["/Query", "/TN", taskName(dir)]).status === 0;
  if (io.system.platform === "darwin") return existsSync(agentFile(dir, io.system));
  return null;
}
