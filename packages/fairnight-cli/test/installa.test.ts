/**
 * The language of the Windows installer: Spanish when Windows is, Italian
 * otherwise, -Lingua to choose it. The script is run for real with a Node.js
 * that does not exist, so it stops at its first message without installing.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.js";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../installa/windows.ps1");

function install(args: string[], culture: string) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Cartella", tempDir(), "-SenzaDomande", ...args], {
    encoding: "utf8",
    env: { ...process.env, FAIRNIGHT_NODE: "C:\\nessuno\\node.exe", FAIRNIGHT_CULTURA: culture },
    windowsHide: true,
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const SPANISH = "Para que Fairnight funcione hace falta Node.js, un programa gratuito (versión 22 o más reciente).";
const ITALIAN = "Per far funzionare Fairnight serve Node.js, un programma gratuito (versione 22 o più recente).";

describe.skipIf(process.platform !== "win32")("Windows installer language", () => {
  it("speaks Spanish on a Spanish Windows", () => {
    const r = install([], "es-ES");
    expect(r.code).toBe(2);
    expect(r.out).toContain("Fairnight: los precios de tus noches, calculados en tu ordenador");
    expect(r.out).toContain(SPANISH);
    expect(r.out).toContain("  3. Luego haz otra vez doble clic en «Installa Fairnight (Windows)».");
    expect(r.out).not.toContain(ITALIAN);
  });

  it("speaks Italian on an Italian Windows and on any other", () => {
    for (const culture of ["it-IT", "en-US", "de-DE"]) {
      const r = install([], culture);
      expect(r.code).toBe(2);
      expect(r.out).toContain(ITALIAN);
      expect(r.out).not.toContain(SPANISH);
    }
  });

  it("follows -Lingua whatever the language of Windows, and refuses any other language", () => {
    expect(install(["-Lingua", "es"], "it-IT").out).toContain(SPANISH);
    expect(install(["-Lingua", "it"], "es-ES").out).toContain(ITALIAN);
    const wrong = install(["-Lingua", "fr"], "it-IT");
    expect(wrong.code).not.toBe(0);
    expect(wrong.out).not.toContain(ITALIAN);
  });
}, 60_000);

describe("Windows installer texts", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const block = (lang: string) => {
    const m = source.match(new RegExp(`\\n  ${lang} = @\\{\\r?\\n([\\s\\S]*?)\\r?\\n  \\}`));
    if (!m) throw new Error(`no ${lang} block`);
    const lines = (m[1] as string).split(/\r?\n/);
    return Object.fromEntries(lines.map((l): [string, string] => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
  };

  it("has every message in Italian and in Spanish, and never the euro sign", () => {
    const it_ = block("it");
    const es = block("es");
    expect(Object.keys(it_).length).toBeGreaterThan(40);
    expect(Object.keys(es).sort()).toEqual(Object.keys(it_).sort());
    for (const [key, text] of Object.entries(es)) {
      expect(text, key).not.toBe(it_[key]);
      expect(text.match(/\{\d\}/g) ?? [], key).toEqual(it_[key]?.match(/\{\d\}/g) ?? []);
    }
    expect(source).not.toContain("€");
  });
});
