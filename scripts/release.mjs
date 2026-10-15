#!/usr/bin/env node
/**
 * The steps of a release, kept here so they can be tried on any computer
 * before a tag is pushed. The workflow .github/workflows/release.yml calls them.
 *
 *   node scripts/release.mjs packages            the public packages, in publish order
 *   node scripts/release.mjs check v0.2.0        versions, dependencies and changelog match the tag
 *   node scripts/release.mjs notes 0.2.0         the changelog section of a version
 *   node scripts/release.mjs pack <dir>          one npm tarball per public package
 *   node scripts/release.mjs publish [--dry-run] [--provenance]
 *                                                publish in order, skipping versions already on npm
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, opts = {}) {
  // npm.cmd needs a shell on Windows; arguments here are package names and flags only.
  return execFileSync(npm, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32", ...opts });
}

/** Every workspace package, with its folder. */
function workspaces() {
  const dir = path.join(root, "packages");
  return readdirSync(dir).map((d) => ({ dir: `packages/${d}`, pkg: JSON.parse(readFileSync(path.join(dir, d, "package.json"), "utf8")) }));
}

/** Public packages, each after the workspace packages it depends on. */
export function publicPackages() {
  const all = workspaces().filter((w) => !w.pkg.private);
  const names = new Set(all.map((w) => w.pkg.name));
  const done = new Set();
  const order = [];
  const visit = (w, seen = new Set()) => {
    if (done.has(w.pkg.name)) return;
    if (seen.has(w.pkg.name)) throw new Error(`dependency cycle at ${w.pkg.name}`);
    seen.add(w.pkg.name);
    for (const dep of Object.keys(w.pkg.dependencies ?? {}).filter((n) => names.has(n)).sort()) {
      visit(all.find((x) => x.pkg.name === dep), seen);
    }
    done.add(w.pkg.name);
    order.push(w);
  };
  for (const w of [...all].sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))) visit(w);
  return order;
}

/** The text under "## [version]" in CHANGELOG.md, up to the next version heading. */
export function notes(version) {
  const lines = readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return { heading: lines[start], body: lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim() };
}

function check(tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag ?? "");
  if (!m) throw new Error(`the tag must look like v0.2.0, got ${JSON.stringify(tag)}`);
  const version = m[1];
  const problems = [];
  const all = workspaces();
  const names = new Set(all.map((w) => w.pkg.name));
  for (const { dir, pkg } of all) {
    if (pkg.version !== version) problems.push(`${dir}: version ${pkg.version}, the tag says ${version}`);
    for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
      if (names.has(dep) && range !== version) problems.push(`${dir}: depends on ${dep}@${range}, should be ${version}`);
    }
    if (!pkg.private) {
      if (pkg.license !== "AGPL-3.0-only") problems.push(`${dir}: license ${pkg.license}`);
      if (!pkg.repository?.url) problems.push(`${dir}: no repository field (needed for npm provenance)`);
      if (!pkg.files?.includes("LICENSE")) problems.push(`${dir}: LICENSE missing from "files"`);
      // npm 11 drops a bin written as "./bin/x.js" from the published manifest: the command would not be installed.
      for (const [cmd, file] of Object.entries(pkg.bin ?? {})) {
        if (file.startsWith("./")) problems.push(`${dir}: bin "${cmd}" must be written "${file.slice(2)}", without "./"`);
      }
    }
  }
  const section = notes(version);
  if (!section) problems.push(`CHANGELOG.md: no "## [${version}]" section`);
  else if (/unreleased|in development|not released/i.test(section.heading)) problems.push(`CHANGELOG.md: "${section.heading}" still says it is not released`);
  if (problems.length) throw new Error(`the tag ${tag} does not match the repository:\n- ${problems.join("\n- ")}`);
  console.log(`${tag}: ${all.length} packages at ${version}, changelog ready.`);
}

function pack(dest) {
  mkdirSync(path.resolve(root, dest), { recursive: true });
  for (const { pkg } of publicPackages()) {
    const out = run(["pack", "-w", pkg.name, "--pack-destination", dest]).trim().split(/\r?\n/).pop();
    console.log(out);
  }
}

function onNpm(name, version) {
  try {
    return run(["view", `${name}@${version}`, "version"], { stdio: ["ignore", "pipe", "ignore"] }).trim() === version;
  } catch {
    return false; // E404: the name or the version is not there yet
  }
}

function publish(flags) {
  const dryRun = flags.includes("--dry-run");
  for (const { pkg } of publicPackages()) {
    if (!dryRun && onNpm(pkg.name, pkg.version)) {
      console.log(`${pkg.name}@${pkg.version} is already on npm, skipped.`);
      continue;
    }
    const args = ["publish", "-w", pkg.name, "--access", "public"];
    if (flags.includes("--provenance")) args.push("--provenance");
    // npm refuses a prerelease (0.3.0-rc.1) without a tag: it must never become "latest".
    if (pkg.version.includes("-")) args.push("--tag", "next");
    if (dryRun) args.push("--dry-run");
    console.log(`${dryRun ? "[dry run] " : ""}npm ${args.join(" ")}`);
    run(args, { stdio: "inherit" });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "packages") for (const { pkg } of publicPackages()) console.log(`${pkg.name}@${pkg.version}`);
    else if (cmd === "check") check(rest[0]);
    else if (cmd === "notes") {
      const n = notes(rest[0]?.replace(/^v/, ""));
      if (!n) throw new Error(`no changelog section for ${rest[0]}`);
      console.log(n.body);
    } else if (cmd === "pack") pack(rest[0] ?? "release-files");
    else if (cmd === "publish") publish(rest);
    else throw new Error("usage: node scripts/release.mjs packages | check <tag> | notes <version> | pack <dir> | publish [--dry-run] [--provenance]");
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
