/**
 * The page's hashes kept in fairnight-cli (for `fairnight ospiti verifica-pagina`)
 * must be those of a fresh build: otherwise a host would be told that an honest
 * relay serves a different page.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_HASHES } from "../../fairnight-cli/src/guests/page-hashes.js";
// @ts-expect-error a plain .mjs build script, without types
import { buildPage } from "../scripts/build.mjs";

describe("the guest's page", () => {
  it("builds to exactly the hashes fairnight-cli checks", async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), "fairguest-page-"));
    try {
      const hashes = (await buildPage({ outDir: out, hashesFile: null })) as Record<string, string>;
      expect(hashes).toEqual(PAGE_HASHES);
      const html = readFileSync(path.join(out, "checkin.html"), "utf8");
      // Nothing from another site: one stylesheet and one script, both of this site.
      expect(html.match(/(?:href|src)="([^"]+)"/g)).toEqual(['href="/app.css"', 'src="/app.js"']);
      const js = readFileSync(path.join(out, "app.js"), "utf8");
      expect(js).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
