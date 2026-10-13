#!/usr/bin/env node
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
});
