/**
 * Downloads the MRZ model for Tesseract into assets/ (outside git), once,
 * before a deploy. Fixed commit and fixed SHA-256: any other file is refused.
 *
 * Model: DoubangoTelecom/tesseractMRZ, tessdata_fast/mrz.traineddata,
 * BSD-3-Clause, commit 1e7adfec (5 January 2020).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "1e7adfecda5f3c9ae1fb12cf6b4b8c3958c63e46";
const BASE = `https://raw.githubusercontent.com/DoubangoTelecom/tesseractMRZ/${COMMIT}`;
export const MODEL_SHA256 = "ece2a54f125a73792f9cec74e6f8e62f6e5e00c7f19153ba865af689be5b5f01";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const model = await get(`${BASE}/tessdata_fast/mrz.traineddata`);
const hash = createHash("sha256").update(model).digest("hex");
if (hash !== MODEL_SHA256) throw new Error(`mrz.traineddata has SHA-256 ${hash}, expected ${MODEL_SHA256}: not saved.`);
writeFileSync(path.join(dir, "mrz.traineddata"), model);
writeFileSync(path.join(dir, "mrz-LICENSE.txt"), await get(`${BASE}/LICENSE`));
console.log("Saved assets/mrz.traineddata (SHA-256 checked) and its licence.");
