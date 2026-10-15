#!/usr/bin/env node
import { spawn } from "node:child_process";
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
  openUrl: (url) => {
    // The default browser: "start" on Windows, "open" on a Mac, xdg-open elsewhere.
    const [cmd, args]: [string, string[]] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {}); // no browser to open: the address is printed anyway
    child.unref();
  },
});
