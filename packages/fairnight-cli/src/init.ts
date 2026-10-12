/**
 * `fairnight init [folder]`: create the host's folder with an example config,
 * an empty database and a three-line README. Writes only inside that folder
 * and never overwrites a file that already exists.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDb } from "./db.js";
import { CONFIG_FILE, configPath, dbPath } from "./io.js";
import { EXAMPLE_CONFIG, LOCAL_README } from "./template.js";

export interface InitReport {
  folder: string;
  created: string[];
  kept: string[];
}

export function initFolder(folder: string): InitReport {
  const dir = path.resolve(folder);
  mkdirSync(dir, { recursive: true });
  const report: InitReport = { folder: dir, created: [], kept: [] };

  const config = configPath(dir);
  if (existsSync(config)) report.kept.push(CONFIG_FILE);
  else {
    writeFileSync(config, JSON.stringify(EXAMPLE_CONFIG, null, 2) + "\n", "utf8");
    report.created.push(CONFIG_FILE);
  }

  const readme = path.join(dir, "README.txt");
  if (existsSync(readme)) report.kept.push("README.txt");
  else {
    writeFileSync(readme, LOCAL_README, "utf8");
    report.created.push("README.txt");
  }

  const db = dbPath(dir);
  const relDb = path.relative(dir, db);
  if (existsSync(db)) report.kept.push(relDb);
  else report.created.push(relDb);
  openDb(db).close(); // creates the file and its tables, or checks an existing one

  return report;
}
