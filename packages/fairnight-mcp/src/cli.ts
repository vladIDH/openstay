#!/usr/bin/env node
/**
 * fairnight-mcp [--dir <folder>]: serve a Fairnight folder over stdio.
 * The folder can also be given with the FAIRNIGHT_DIR environment variable.
 * stdout belongs to the MCP protocol: messages for humans go to stderr.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server.js";

const { values } = parseArgs({ options: { dir: { type: "string" }, help: { type: "boolean", short: "h" } }, strict: true });
if (values.help) {
  process.stderr.write("Usage: fairnight-mcp --dir <your Fairnight folder>   (or set FAIRNIGHT_DIR)\n");
  process.exit(0);
}
const dir = path.resolve(values.dir ?? process.env.FAIRNIGHT_DIR ?? process.cwd());
const folder = { dir, now: () => new Date() };
serveStdio(() => buildServer(folder, (e) => process.stderr.write(`fairnight-mcp: ${(e as Error).stack ?? String(e)}\n`)));
process.stderr.write(`fairnight-mcp: reading ${dir} (read only)\n`);
