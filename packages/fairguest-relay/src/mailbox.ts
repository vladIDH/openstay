/**
 * One mailbox per stay. It holds only what the guest's browser sealed for the
 * host's public key ("fg1." text): nothing in here can open it.
 *
 * - The host's computer creates the box with a read secret (it keeps it) and
 *   the hash of a write secret (it goes in the link, after the "#").
 * - The guest's page posts sealed messages with the write secret.
 * - The host's computer reads them with the read secret, then deletes them.
 * - At the expiry everything in the box is deleted, read or not.
 * - The host's computer may leave the guest the links to pay on Stripe (the
 *   tourist tax, the deposit): Stripe's addresses and amounts, nothing about a
 *   person. The page reads them with the write secret. No money comes here.
 *
 * Only hashes of the secrets are stored. Nothing is logged.
 */

/** The part of a Durable Object's storage the box uses (tests pass a Map-backed one). */
export interface BoxStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
}

interface Meta {
  readHash: string;
  writeHash: string;
  /** Milliseconds since 1970. */
  expires: number;
}

interface Message {
  id: string;
  at: number;
  body: string;
}

/** What the page shows to pay: links to Stripe's own pages only. */
interface PayItem {
  kind: "tax" | "deposit";
  amountCents: number;
  currency: string;
  state: "open" | "done" | "later" | "pending";
  url?: string;
  from?: string;
  people?: number;
  nights?: number;
}
interface Pay {
  town?: string;
  items: PayItem[];
}

const MAX_PAY = 4 * 1024;
const STRIPE_URL = /^https:\/\/(buy|checkout)\.stripe\.com\/[A-Za-z0-9_\-/#%.=?&]+$/;

/** Only the expected fields, of the expected kinds: anything else is refused. */
export function readPay(input: unknown): Pay | null {
  if (typeof input !== "object" || input === null) return null;
  const p = input as { town?: unknown; items?: unknown };
  if (p.town !== undefined && (typeof p.town !== "string" || p.town.length > 80)) return null;
  if (!Array.isArray(p.items) || p.items.length > 2) return null;
  const items: PayItem[] = [];
  for (const raw of p.items as unknown[]) {
    if (typeof raw !== "object" || raw === null) return null;
    const it = raw as Record<string, unknown>;
    const keys = Object.keys(it);
    if (keys.some((k) => !["kind", "amountCents", "currency", "state", "url", "from", "people", "nights"].includes(k))) return null;
    if (it.kind !== "tax" && it.kind !== "deposit") return null;
    if (!Number.isInteger(it.amountCents) || (it.amountCents as number) < 0 || (it.amountCents as number) > 1_000_000) return null;
    if (typeof it.currency !== "string" || !/^[A-Z]{3}$/.test(it.currency)) return null;
    if (!["open", "done", "later", "pending"].includes(it.state as string)) return null;
    if (it.url !== undefined && (typeof it.url !== "string" || it.url.length > 500 || !STRIPE_URL.test(it.url))) return null;
    if (it.from !== undefined && (typeof it.from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(it.from))) return null;
    for (const k of ["people", "nights"]) if (it[k] !== undefined && (!Number.isInteger(it[k]) || (it[k] as number) < 0 || (it[k] as number) > 1000)) return null;
    items.push(it as unknown as PayItem);
  }
  return p.town === undefined ? { items } : { town: p.town as string, items };
}

/** A sealed guest is about 6 KB; well above that is not one. */
export const MAX_MESSAGE = 24 * 1024;
export const MAX_MESSAGES = 60;
/** A box lives at most this long: a stay plus its check-in days. */
export const MAX_LIFETIME_MS = 120 * 86_400_000;
const SEALED = /^fg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SECRET = /^[A-Za-z0-9_-]{22,86}$/;
const HASH = /^[0-9a-f]{64}$/;

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same length strings compared without stopping at the first difference. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function bearer(request: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") ?? "");
  return m && SECRET.test(m[1] as string) ? (m[1] as string) : null;
}

export class MailboxLogic {
  constructor(
    private readonly storage: BoxStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private async meta(): Promise<Meta | null> {
    const meta = (await this.storage.get<Meta>("meta")) ?? null;
    if (meta && meta.expires <= this.now()) {
      await this.storage.deleteAll();
      return null;
    }
    return meta;
  }

  private async isReader(request: Request, meta: Meta): Promise<boolean> {
    const secret = bearer(request);
    return !!secret && sameHash(await sha256Hex(secret), meta.readHash);
  }

  /** `path` is what follows /api/box/<id>: "", "/messages" or "/messages/<id>". */
  async handle(request: Request, path: string): Promise<Response> {
    const method = request.method;
    if (path === "" && method === "PUT") return this.create(request);
    const meta = await this.meta();
    if (!meta) return json(404, { error: "no such box" });
    if (path === "/messages" && method === "POST") return this.post(request, meta);
    if (path === "/pay" && method === "GET") return this.readPayFor(request, meta);
    if (!(await this.isReader(request, meta))) return json(403, { error: "wrong read secret" });
    if (path === "/messages" && method === "GET") {
      const list = await this.storage.list<Message>({ prefix: "m:" });
      return json(200, { messages: [...list.values()].sort((a, b) => a.at - b.at).map((m) => ({ id: m.id, at: new Date(m.at).toISOString(), body: m.body })) });
    }
    if (path === "/pay" && method === "PUT") return this.putPay(request);
    const one = /^\/messages\/([A-Za-z0-9_-]{8,40})$/.exec(path);
    if (one && method === "DELETE") {
      const keys = [...(await this.storage.list<Message>({ prefix: "m:" })).entries()].filter(([, m]) => m.id === one[1]).map(([k]) => k);
      for (const k of keys) await this.storage.delete(k);
      return json(200, { deleted: keys.length });
    }
    if (path === "" && method === "DELETE") {
      await this.storage.deleteAll();
      return json(200, { deleted: true });
    }
    return json(405, { error: "method not allowed" });
  }

  private async create(request: Request): Promise<Response> {
    const secret = bearer(request);
    if (!secret) return json(400, { error: "the read secret goes in Authorization: Bearer" });
    let body: { writeHash?: unknown; expires?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(400, { error: "the body is JSON with writeHash and expires" });
    }
    const expires = typeof body.expires === "string" ? Date.parse(body.expires) : NaN;
    if (typeof body.writeHash !== "string" || !HASH.test(body.writeHash)) return json(400, { error: "writeHash is the SHA-256 of the write secret, in hex" });
    if (!Number.isFinite(expires) || expires <= this.now() || expires > this.now() + MAX_LIFETIME_MS) return json(400, { error: "expires must be a date within 120 days" });
    const readHash = await sha256Hex(secret);
    const existing = await this.meta();
    if (existing && !sameHash(existing.readHash, readHash)) return json(409, { error: "this box belongs to someone else" });
    await this.storage.put("meta", { readHash, writeHash: body.writeHash, expires } satisfies Meta);
    await this.storage.setAlarm(expires);
    return json(existing ? 200 : 201, { expires: new Date(expires).toISOString() });
  }

  private async post(request: Request, meta: Meta): Promise<Response> {
    const secret = request.headers.get("x-fairguest-write") ?? "";
    if (!SECRET.test(secret) || !sameHash(await sha256Hex(secret), meta.writeHash)) return json(403, { error: "wrong write secret" });
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_MESSAGE) return json(413, { error: "too large" });
    const body = await request.text();
    if (body.length > MAX_MESSAGE) return json(413, { error: "too large" });
    if (!SEALED.test(body)) return json(400, { error: "only sealed fg1 text is accepted" });
    const count = (await this.storage.list({ prefix: "m:" })).size;
    if (count >= MAX_MESSAGES) return json(429, { error: "the box is full: the host has to download it first" });
    const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const at = this.now();
    await this.storage.put(`m:${String(at).padStart(15, "0")}:${id}`, { id, at, body } satisfies Message);
    return json(201, { id });
  }

  /** The host's computer leaves the payment links (read secret checked by the caller). */
  private async putPay(request: Request): Promise<Response> {
    const text = await request.text();
    if (text.length > MAX_PAY) return json(413, { error: "too large" });
    let pay: Pay | null = null;
    try {
      pay = readPay(JSON.parse(text));
    } catch {
      pay = null;
    }
    if (!pay) return json(400, { error: "only links to Stripe's payment pages, with kind, amountCents, currency and state" });
    await this.storage.put("pay", pay);
    return json(200, { saved: pay.items.length });
  }

  /** The guest's page reads them with the write secret. */
  private async readPayFor(request: Request, meta: Meta): Promise<Response> {
    const secret = request.headers.get("x-fairguest-write") ?? "";
    if (!SECRET.test(secret) || !sameHash(await sha256Hex(secret), meta.writeHash)) return json(403, { error: "wrong write secret" });
    return json(200, { pay: (await this.storage.get<Pay>("pay")) ?? null });
  }

  /** The alarm set at the expiry: everything goes. */
  async expire(): Promise<void> {
    await this.storage.deleteAll();
  }
}
