/**
 * Runs only when the Ministry's XSD are on this computer: the folder
 * openstay-ses-docs next to the repository (or OPENSTAY_SES_DOCS). Never in
 * CI, never in git. With the files present it fails until the hook SES_SCHEMA
 * (es-ses-parte.ts) is filled in from them, then validates every generated
 * document against the XSD with xmllint.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SES_SCHEMA, sesRequests, sesXml, type Kind } from "../src/index.js";
import { child, holder, stay } from "./data.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCS = process.env.OPENSTAY_SES_DOCS ?? path.resolve(repo, "..", "openstay-ses-docs");

function xsdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? xsdFiles(p) : f.toLowerCase().endsWith(".xsd") ? [p] : [];
  });
}

const files = xsdFiles(DOCS);
const targetOf = (file: string) => /targetNamespace="([^"]+)"/.exec(readFileSync(file, "utf8"))?.[1] ?? null;

describe.skipIf(files.length === 0)(`SES XML against the Ministry's XSD (${DOCS})`, () => {
  it("the hook SES_SCHEMA is filled in from these XSD", () => {
    expect(SES_SCHEMA, "Fill in SES_SCHEMA in packages/fairguest/src/countries/es-ses-parte.ts from the XSD (see the comment above it).").not.toBeNull();
    const targets = new Set(files.map(targetOf));
    for (const ns of Object.values(SES_SCHEMA?.namespace ?? {})) expect(targets.has(ns), `no XSD has targetNamespace ${ns}`).toBe(true);
  });

  for (const kind of ["checkin", "reservation"] as Kind[]) {
    it(`the ${kind === "checkin" ? "parte de viajeros" : "reserva de hospedaje"} is valid`, () => {
      if (!SES_SCHEMA) return;
      const ns = SES_SCHEMA.namespace[kind];
      const xsd = files.find((f) => targetOf(f) === ns);
      expect(xsd, `no XSD for ${ns}`).toBeDefined();
      const work = mkdtempSync(path.join(os.tmpdir(), "ses-xsd-"));
      try {
        const req = sesRequests([stay({ guests: [holder(), child()] })], kind)[0];
        if (!req || !xsd) return;
        const doc = path.join(work, "doc.xml");
        writeFileSync(doc, sesXml(req, SES_SCHEMA));
        // xmllint (libxml2) must be installed: it says exactly which element is wrong.
        execFileSync("xmllint", ["--noout", "--schema", xsd, doc], { stdio: "pipe" });
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
  }
});
