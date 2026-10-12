#!/usr/bin/env node
// Launcher kept in git so npm can link the "fairnight-mcp" command at install
// time, before the TypeScript sources are built into dist/.
import { existsSync } from "node:fs";

const cli = new URL("../dist/cli.js", import.meta.url);
if (!existsSync(cli)) {
  process.stderr.write('fairnight-mcp is not built yet: run "npm run build" in the repository first.\n');
  process.exit(1);
}
await import(cli.href);
