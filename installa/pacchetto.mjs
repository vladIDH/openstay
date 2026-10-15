#!/usr/bin/env node
/**
 * Builds the zip that hosts download from GitHub Releases after the launch:
 * installa/pacchetto/Fairnight-installa.zip, with the two double-click files,
 * the installer scripts and the icons. Without the project next to them, the
 * scripts install Fairnight from npm.
 *
 * The zip is written here (no zip tool needed on Windows) so that the Mac
 * files keep their "executable" mark: without it a double click on
 * "Installa Fairnight (Mac).command" is refused.
 *
 *   node installa/pacchetto.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOP = "Installa Fairnight";

/** [path in the repo, path in the zip, unix mode] */
const FILES = [
  ["Installa Fairnight (Windows).cmd", "Installa Fairnight (Windows).cmd", 0o644],
  ["Installa Fairnight (Mac).command", "Installa Fairnight (Mac).command", 0o755],
  ["installa/windows.ps1", "installa/windows.ps1", 0o644],
  ["installa/mac.sh", "installa/mac.sh", 0o755],
  ["installa/fairnight.ico", "installa/fairnight.ico", 0o644],
  ["installa/fairnight.png", "installa/fairnight.png", 0o644],
  ["installa/LEGGIMI.txt", "LEGGIMI.txt", 0o644],
  ["installa/LEEME.txt", "LEEME.txt", 0o644],
];

/** Line ends as each system expects them, whatever the checkout did. */
function content(file) {
  const data = readFileSync(path.join(root, file));
  if (/\.(cmd|ps1)$/.test(file)) return Buffer.from(data.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8");
  if (/\.(command|sh)$/.test(file)) return Buffer.from(data.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return data;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const { time, date } = dosTime(new Date());
const locals = [];
const centrals = [];
let offset = 0;
for (const [from, to, mode] of FILES) {
  const data = content(from);
  const packed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(`${TOP}/${to}`, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // names in UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made on unix: the mode below counts
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); // regular file + permissions
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}

const directory = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(FILES.length, 8);
end.writeUInt16LE(FILES.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(root, "installa", "pacchetto");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "Fairnight-installa.zip");
writeFileSync(out, Buffer.concat([...locals, directory, end]));
process.stdout.write(`${out}\n`);
