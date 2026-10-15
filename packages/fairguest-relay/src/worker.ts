/**
 * Fairguest relay: a Cloudflare Worker with one Durable Object per mailbox.
 *
 *   GET  /c/<box>                         the guest's page (static files in public/)
 *   PUT  /api/box/<box>                   the host's computer creates the box
 *   POST /api/box/<box>/messages          the page posts one sealed guest
 *   GET  /api/box/<box>/messages          the host's computer reads them
 *   DELETE /api/box/<box>/messages/<id>   … and deletes each one
 *   DELETE /api/box/<box>                 … or the whole box
 *
 * The boxes live in the EU jurisdiction of Durable Objects. No request is
 * logged by this code; Workers logs are off in wrangler.toml.
 */
import { MailboxLogic, type BoxStorage } from "./mailbox.js";

interface DurableObjectId {
  toString(): string;
}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
export interface DurableObjectNamespaceLike {
  jurisdiction(name: "eu"): DurableObjectNamespaceLike;
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface Env {
  MAILBOX: DurableObjectNamespaceLike;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const BOX = /^[A-Za-z0-9_-]{22}$/;

/** The page asks for nothing outside this site; the OCR runs in a worker and needs WebAssembly. */
export const PAGE_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function withHeaders(res: Response, page: boolean): Response {
  const headers = new Headers(res.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("permissions-policy", "camera=(self), microphone=(), geolocation=()");
  if (page) {
    headers.set("content-security-policy", PAGE_CSP);
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex");
  }
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const api = /^\/api\/box\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (api) {
      if (!BOX.test(api[1] as string)) return new Response("not found", { status: 404 });
      const eu = env.MAILBOX.jurisdiction("eu");
      const stub = eu.get(eu.idFromName(api[1] as string));
      const inner = new URL(`https://box${api[2] ?? ""}`);
      // The body is small (a sealed guest): read it whole, so it is passed the same everywhere.
      const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
      return stub.fetch(new Request(inner, { method: request.method, headers: request.headers, body }));
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
    const page = /^\/c\/([^/]+)$/.exec(url.pathname);
    if (page) {
      if (!BOX.test(page[1] as string)) return new Response("not found", { status: 404 });
      return withHeaders(await env.ASSETS.fetch(new Request(new URL("/checkin.html", url), request)), true);
    }
    if (url.pathname === "/" || url.pathname === "/checkin.html") return new Response("Fairguest relay", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    return withHeaders(await env.ASSETS.fetch(request), false);
  },
};

/** The Durable Object: one per box, its storage and its alarm. */
export class Mailbox {
  private readonly logic: MailboxLogic;

  constructor(state: { storage: BoxStorage }) {
    this.logic = new MailboxLogic(state.storage);
  }

  fetch(request: Request): Promise<Response> {
    return this.logic.handle(request, new URL(request.url).pathname.replace(/\/$/, ""));
  }

  alarm(): Promise<void> {
    return this.logic.expire();
  }
}
