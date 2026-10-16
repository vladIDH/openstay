/**
 * The relay: boxes, secrets, limits and expiry, with an in-memory storage in
 * place of the Durable Object's. The bodies are invented "fg1." strings: the
 * relay never opens them, so it does not need real ones.
 */
import { describe, expect, it } from "vitest";
import { MAX_MESSAGES, MailboxLogic, sha256Hex, type BoxStorage } from "../src/mailbox.js";
import worker, { Mailbox, PAGE_CSP, type DurableObjectNamespaceLike, type Env } from "../src/worker.js";

class MemoryStorage implements BoxStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async put(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.data.delete(key);
  }
  async list<T>(o: { prefix: string }) {
    return new Map([...this.data].filter(([k]) => k.startsWith(o.prefix)).sort(([a], [b]) => a.localeCompare(b))) as Map<string, T>;
  }
  async deleteAll() {
    this.data.clear();
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
}

const READ = "read-secret-0000-not-real-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WRITE = "write-secret-0000-not-real";
const SEALED = "fg1.AAAA.BBBB.CCCC.DDDD";
const NOW = Date.parse("2099-06-01T09:00:00Z");

async function box(now = () => NOW) {
  const storage = new MemoryStorage();
  const logic = new MailboxLogic(storage, now);
  const res = await logic.handle(
    new Request("https://box/", { method: "PUT", headers: { authorization: `Bearer ${READ}` }, body: JSON.stringify({ writeHash: await sha256Hex(WRITE), expires: "2099-06-14T12:00:00Z" }) }),
    "",
  );
  expect(res.status).toBe(201);
  return { storage, logic };
}

const post = (logic: MailboxLogic, body = SEALED, secret = WRITE) => logic.handle(new Request("https://box/messages", { method: "POST", headers: { "x-fairguest-write": secret }, body }), "/messages");
const read = (logic: MailboxLogic, secret = READ) => logic.handle(new Request("https://box/messages", { headers: { authorization: `Bearer ${secret}` } }), "/messages");

describe("a mailbox", () => {
  it("keeps only hashes of the secrets and sets the alarm at the expiry", async () => {
    const { storage } = await box();
    const stored = JSON.stringify([...storage.data.values()]);
    expect(stored).not.toContain(READ);
    expect(stored).not.toContain(WRITE);
    expect(storage.alarm).toBe(Date.parse("2099-06-14T12:00:00Z"));
  });

  it("takes sealed text with the write secret, gives it with the read secret, then deletes it", async () => {
    const { logic } = await box();
    expect((await post(logic)).status).toBe(201);
    const list = (await (await read(logic)).json()) as { messages: { id: string; body: string }[] };
    expect(list.messages.map((m) => m.body)).toEqual([SEALED]);
    const id = list.messages[0]?.id as string;
    const del = await logic.handle(new Request(`https://box/messages/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${READ}` } }), `/messages/${id}`);
    expect(await del.json()).toEqual({ deleted: 1 });
    expect(((await (await read(logic)).json()) as { messages: unknown[] }).messages).toEqual([]);
  });

  it("refuses the wrong secrets, clear text and oversized bodies", async () => {
    const { logic } = await box();
    expect((await post(logic, SEALED, "wrong-secret-0000-not-real")).status).toBe(403);
    expect((await post(logic, '{"givenName":"Ospite"}')).status).toBe(400);
    expect((await post(logic, `fg1.${"A".repeat(30_000)}.B.C.D`)).status).toBe(413);
    expect((await read(logic, "wrong-read-secret-0000-not-real")).status).toBe(403);
    // Nobody else can take the box over.
    const other = await logic.handle(
      new Request("https://box/", { method: "PUT", headers: { authorization: "Bearer another-read-secret-0000-not-real" }, body: JSON.stringify({ writeHash: await sha256Hex(WRITE), expires: "2099-06-14T12:00:00Z" }) }),
      "",
    );
    expect(other.status).toBe(409);
  });

  it("is full after a limit, until the host downloads it", async () => {
    const { logic } = await box();
    for (let i = 0; i < MAX_MESSAGES; i++) expect((await post(logic)).status).toBe(201);
    expect((await post(logic)).status).toBe(429);
  });

  it("forgets everything at the expiry, read or not", async () => {
    let now = NOW;
    const { logic, storage } = await box(() => now);
    await post(logic);
    now = Date.parse("2099-06-15T00:00:00Z");
    expect((await read(logic)).status).toBe(404);
    expect(storage.data.size).toBe(0);
    const again = await box();
    await post(again.logic);
    await again.logic.expire();
    expect(again.storage.data.size).toBe(0);
  });

  it("refuses an expiry too far away", async () => {
    const logic = new MailboxLogic(new MemoryStorage(), () => NOW);
    const res = await logic.handle(new Request("https://box/", { method: "PUT", headers: { authorization: `Bearer ${READ}` }, body: JSON.stringify({ writeHash: await sha256Hex(WRITE), expires: "2100-06-01T00:00:00Z" }) }), "");
    expect(res.status).toBe(400);
  });
});

describe("the worker", () => {
  function env() {
    const boxes = new Map<string, Mailbox>();
    const jurisdictions: string[] = [];
    const ns: DurableObjectNamespaceLike = {
      jurisdiction(name) {
        jurisdictions.push(name);
        return ns;
      },
      idFromName: (name) => ({ toString: () => name }),
      get(id) {
        const key = id.toString();
        if (!boxes.has(key)) boxes.set(key, new Mailbox({ storage: new MemoryStorage() }));
        const mb = boxes.get(key) as Mailbox;
        return { fetch: (r: Request) => mb.fetch(r) };
      },
    };
    const assets = { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`, { headers: { "content-type": "text/html" } }) };
    return { env: { MAILBOX: ns, ASSETS: assets } as Env, jurisdictions };
  }
  const BOX_ID = "AAAAAAAAAAAAAAAAAAAAAA";

  it("routes the API to the box of the EU jurisdiction", async () => {
    const { env: e, jurisdictions } = env();
    const created = await worker.fetch(
      // The worker's boxes use the real clock: an expiry one day from now.
      new Request(`https://relay.example/api/box/${BOX_ID}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${READ}` },
        body: JSON.stringify({ writeHash: await sha256Hex(WRITE), expires: new Date(Date.now() + 86_400_000).toISOString() }),
      }),
      e,
    );
    expect(created.status).toBe(201);
    expect(jurisdictions).toEqual(["eu"]);
    expect((await worker.fetch(new Request(`https://relay.example/api/box/bad/messages`), e)).status).toBe(404);
  });

  it("serves the page for /c/<box> with a strict content security policy", async () => {
    const { env: e } = env();
    const res = await worker.fetch(new Request(`https://relay.example/c/${BOX_ID}`), e);
    expect(await res.text()).toBe("asset /checkin.html");
    expect(res.headers.get("content-security-policy")).toBe(PAGE_CSP);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await worker.fetch(new Request("https://relay.example/c/x"), e)).status).toBe(404);
  });
});

describe("the payment links of a box", () => {
  const PAY = { town: "Barcelona", items: [{ kind: "tax", amountCents: 2850, currency: "EUR", state: "open", url: "https://buy.stripe.com/test_abc123", people: 1, nights: 3 }] };
  const putPay = (logic: MailboxLogic, body: unknown, secret = READ) =>
    logic.handle(new Request("https://box/pay", { method: "PUT", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) }), "/pay");
  const getPay = (logic: MailboxLogic, secret = WRITE) => logic.handle(new Request("https://box/pay", { headers: { "x-fairguest-write": secret } }), "/pay");

  it("the host's computer leaves them with the read secret, the page reads them with the write secret", async () => {
    const { logic } = await box();
    expect(await (await getPay(logic)).json()).toEqual({ pay: null });
    expect((await putPay(logic, PAY)).status).toBe(200);
    expect(await (await getPay(logic)).json()).toEqual({ pay: PAY });
    expect((await putPay(logic, PAY, "x".repeat(40))).status).toBe(403);
    expect((await getPay(logic, "y".repeat(30))).status).toBe(403);
  });

  it("only Stripe's own pages and the expected fields: no money and no person goes through the relay", async () => {
    const { logic } = await box();
    const item = PAY.items[0] as Record<string, unknown>;
    for (const bad of [
      { items: [{ ...item, url: "https://evil.example/pay" }] },
      { items: [{ ...item, name: "Ospite Prova" }] },
      { items: [{ ...item, amountCents: -1 }] },
      { items: [item, item, item] },
      "not an object",
    ]) {
      expect((await putPay(logic, bad)).status).toBe(400);
    }
  });
});
