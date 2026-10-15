/**
 * The relay on this computer, for trying the link before a deploy:
 *   npm run build -w fairguest-relay && node packages/fairguest-relay/scripts/dev.mjs [port]
 * Same Worker code, boxes in memory (gone when it stops), files from public/.
 * Put "fairguestRelay": "http://localhost:8788" in fairnight.config.json to use it.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const port = Number(process.argv[2] ?? 8788);

const bundled = path.join(os.tmpdir(), `fairguest-relay-dev-${process.pid}.mjs`);
await build({ entryPoints: [path.join(root, "src/worker.ts")], bundle: true, format: "esm", platform: "neutral", outfile: bundled, logLevel: "warning" });
const { default: worker, Mailbox } = await import(pathToFileURL(bundled).href);

class MemoryStorage {
  data = new Map();
  async get(k) {
    return this.data.get(k);
  }
  async put(k, v) {
    this.data.set(k, structuredClone(v));
  }
  async delete(k) {
    return this.data.delete(k);
  }
  async list({ prefix }) {
    return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)));
  }
  async deleteAll() {
    this.data.clear();
  }
  async setAlarm() {}
}

const boxes = new Map();
const namespace = {
  jurisdiction: () => namespace,
  idFromName: (name) => ({ toString: () => name }),
  get(id) {
    const key = id.toString();
    if (!boxes.has(key)) boxes.set(key, new Mailbox({ storage: new MemoryStorage() }));
    const box = boxes.get(key);
    return { fetch: (r) => box.fetch(r) };
  },
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
const assets = {
  async fetch(request) {
    const file = path.join(publicDir, decodeURIComponent(new URL(request.url).pathname));
    if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
    const body = await new Response(createReadStream(file)).arrayBuffer();
    return new Response(body, { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" } });
  },
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
  const response = await worker.fetch(request, { MAILBOX: namespace, ASSETS: assets });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`Fairguest relay (local, boxes in memory): http://localhost:${port}`));
