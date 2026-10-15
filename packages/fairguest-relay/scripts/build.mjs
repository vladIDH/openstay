/**
 * Builds the static files of the guest's page into public/, the folder the
 * Worker serves:
 *   checkin.html, app.css, app.js (+ chunks/), ocr/ (Tesseract and the MRZ model), licenses/
 *
 * No network here. The MRZ model is downloaded once by `npm run assets` (into
 * assets/, also kept in git); without it the page works and only the photo reading
 * is missing.
 *
 * Then it writes the SHA-256 of every file the page loads into
 * ../fairnight-cli/src/guests/page-hashes.ts, so that `fairnight ospiti
 * verifica-pagina` can tell whether a relay serves exactly this code.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "public");
const require = createRequire(import.meta.url);
const fairguestBrowser = path.resolve(root, "../fairguest/src/browser.ts");

export async function buildPage({ outDir = out, hashesFile = path.resolve(root, "../fairnight-cli/src/guests/page-hashes.ts") } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, "ocr"), { recursive: true });
  mkdirSync(path.join(outDir, "licenses"), { recursive: true });

  await build({
    entryPoints: { app: path.join(root, "src/client/main.ts") },
    bundle: true,
    format: "esm",
    splitting: true,
    outdir: outDir,
    chunkNames: "chunks/[name]-[hash]",
    platform: "browser",
    target: "es2020",
    minify: true,
    legalComments: "none",
    alias: { "fairguest/browser": fairguestBrowser },
    logLevel: "warning",
  });

  // The look of the form: the very same STYLE as the host's form, plus the photo block.
  const tmp = path.join(outDir, ".style.mjs");
  await build({ stdin: { contents: 'export { STYLE } from "fairguest/browser";', resolveDir: root, loader: "ts" }, bundle: true, format: "esm", platform: "neutral", outfile: tmp, alias: { "fairguest/browser": fairguestBrowser }, logLevel: "warning" });
  const { STYLE } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`);
  rmSync(tmp);
  const extra = `
.photo{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 16px;margin:14px 0}
.photo h2{margin:4px 0 6px}
.button.secondary{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}
.photo-note{min-height:1.2em;margin:8px 0 0;font-weight:600}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
button[disabled]{opacity:.6;cursor:progress}
`;
  writeFileSync(path.join(outDir, "app.css"), `${STYLE.trim()}\n${extra.trim()}\n`);

  writeFileSync(
    path.join(outDir, "checkin.html"),
    `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Fairguest</title>
<link rel="stylesheet" href="/app.css">
<script type="module" src="/app.js"></script>
</head>
<body>
<main id="app"><noscript><p class="message">Este formulario necesita JavaScript para cifrar los datos en su teléfono. · This form needs JavaScript to encrypt your details on your phone. · Questo modulo ha bisogno di JavaScript per cifrare i dati sul tuo telefono.</p></noscript></main>
</body>
</html>
`,
  );

  // Tesseract: the worker and the LSTM cores (with and without SIMD), all from npm.
  const tesseract = path.dirname(require.resolve("tesseract.js/package.json"));
  const core = path.dirname(require.resolve("tesseract.js-core/package.json"));
  copyFileSync(path.join(tesseract, "dist/worker.min.js"), path.join(outDir, "ocr/worker.min.js"));
  for (const f of readdirSync(core).filter((f) => /^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f))) copyFileSync(path.join(core, f), path.join(outDir, "ocr", f));
  copyFileSync(path.join(tesseract, "LICENSE.md"), path.join(outDir, "licenses/tesseract.js.txt"));
  copyFileSync(path.join(core, "LICENSE"), path.join(outDir, "licenses/tesseract.js-core.txt"));
  copyFileSync(path.join(root, "../../node_modules/@noble/curves/LICENSE"), path.join(outDir, "licenses/noble-curves.txt"));
  const model = path.join(root, "assets/mrz.traineddata");
  if (existsSync(model)) {
    copyFileSync(model, path.join(outDir, "ocr/mrz.traineddata"));
    copyFileSync(path.join(root, "assets/mrz-LICENSE.txt"), path.join(outDir, "licenses/tesseractMRZ.txt"));
  } else console.warn("assets/mrz.traineddata is missing: run `npm run assets -w fairguest-relay` before a deploy (the photo reading needs it).");

  // The hashes of the code the page runs (the model has its own pinned hash in assets.mjs).
  const hashes = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (!name.endsWith(".traineddata") && !full.includes(`${path.sep}licenses${path.sep}`)) {
        hashes[`/${path.relative(outDir, full).split(path.sep).join("/")}`] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(outDir);
  if (hashesFile) {
    const body = Object.entries(hashes)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
      .join("\n");
    writeFileSync(
      hashesFile,
      `/**
 * SHA-256 of every file of the guest's page, written by \`npm run build -w fairguest-relay\`.
 * \`fairnight ospiti verifica-pagina\` compares them with what a relay serves. Do not edit by hand.
 */
export const PAGE_HASHES: Record<string, string> = {
${body}
};
`,
    );
  }
  return hashes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hashes = await buildPage();
  console.log(`Built public/: ${Object.keys(hashes).length} files.`);
}
