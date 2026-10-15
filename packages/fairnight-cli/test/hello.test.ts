/**
 * The guest assistant end to end: fake Smoobu and Beds24 servers, a fake
 * model, invented guests. Nothing reaches a real service.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeBeds24, TEST_REFRESH, type FakeBeds24, type FakeBooking as FakeBeds24Booking } from "../../fairnight-beds24/test/fake-beds24.js";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeBooking, type FakeSmoobu } from "../../fairnight-smoobu/test/fake-smoobu.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { startServer } from "../src/serve.js";
import { beds24Messages, fakeModel, smoobuMessages, type FakeSmoobuMessage, type ModelReply } from "./hello-fakes.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

const NOW = "2026-11-01T09:00:00Z";
const ANTHROPIC_KEY = "anthropic-0000-not-real";
const ENV = { SMOOBU_API_KEY: TEST_CREDENTIALS.apiKey, SMOOBU_API_SECRET: TEST_CREDENTIALS.apiSecret, ANTHROPIC_API_KEY: ANTHROPIC_KEY };

const HOUSE = `# Seaside Loft

## Check-in
From 16:00. The key box is on the left of the door.

## Wifi
Network "Loft-Guest", the password is on the router.

## Access codes
Key box 4471
`;

const PRICING = { currency: "EUR", basePrice: 100, defaultMinStay: 2, factors: { rounding: { enabled: true, step: 1 } } };

let smoobu: FakeSmoobu | null = null;
let beds24: FakeBeds24 | null = null;
const servers: Server[] = [];
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  for (const db of opened.splice(0)) if (db.open) db.close();
  await smoobu?.close();
  await beds24?.close();
  smoobu = null;
  beds24 = null;
});

function booking(id: number, apartment: number, arrival: string, departure: string, extra: Record<string, unknown> = {}): FakeBooking {
  return {
    id,
    type: "reservation",
    arrival,
    departure,
    "created-at": "2026-10-20 14:03",
    apartment: { id: apartment, name: "x" },
    channel: { id: 1, name: "Airbnb" },
    "guest-name": "Invented Guest",
    price: 400,
    "is-blocked-booking": false,
    adults: 2,
    ...extra,
  } as FakeBooking;
}

const guestAsks = (id: number, text: string): FakeSmoobuMessage => ({ id, type: 1, message: text });
const hostSays = (id: number, text: string): FakeSmoobuMessage => ({ id, type: 2, message: text });

async function smoobuFolder(options: { bookings?: FakeBooking[]; messages?: Record<number, FakeSmoobuMessage[]>; house?: string | null; config?: object } = {}) {
  const bookings = options.bookings ?? [booking(501, 398, "2026-11-05", "2026-11-09", { language: "de" })];
  smoobu = await startFakeSmoobu({
    ...TEST_CREDENTIALS,
    now: () => new Date(NOW),
    apartments: [{ id: 398, name: "Seaside Loft", currency: "EUR", minimal: "80.00", maximal: "180.00" }],
    bookings,
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify(options.config ?? { language: "it", listings: [{ name: "loft", calendars: [{ source: "smoobu", apartmentId: 398 }], pricing: { ...PRICING, name: "Seaside Loft" } }] }, null, 2),
  );
  if (options.house !== null) {
    mkdirSync(path.join(dir, "casa"), { recursive: true });
    writeFileSync(path.join(dir, "casa", "loft.md"), options.house ?? HOUSE);
  }
  const msgs = smoobuMessages(options.messages ?? { 501: [hostSays(10, "Welcome to the loft!"), guestAsks(11, "Hallo! What time is check-in? <b>thanks</b>")] }, Object.fromEntries(bookings.map((b) => [b.id, b.apartment.id])));
  return { dir, msgs };
}

function io(dir: string, msgs: { fetch: unknown }, model: { fetch: unknown }, extra: Partial<TestIo> = {}): TestIo {
  const t = testIo(dir, undefined, NOW);
  Object.assign(t, {
    env: ENV,
    smoobuBaseUrl: (smoobu as FakeSmoobu).baseUrl,
    smoobuFetch: msgs.fetch,
    modelFetch: model.fetch,
    anthropicBaseUrl: "https://anthropic.example.com",
    sleep: async () => {},
    ...extra,
  });
  return t;
}

function db(dir: string) {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

const drafts = (dir: string) => db(dir).prepare("SELECT id, stay_id, message_id, text, edited_text, status, flags, language, needs_host FROM hello_drafts ORDER BY id").all() as {
  id: number;
  stay_id: string;
  message_id: string;
  text: string;
  edited_text: string | null;
  status: string;
  flags: string;
  language: string | null;
  needs_host: number;
}[];

const said = (t: TestIo) => [...t.lines, ...t.errors].join("\n");
const reply = (r: ModelReply) => () => r;

describe("fairnight risposte leggi (Smoobu)", () => {
  it("reads the messages and writes a draft for the guest waiting, with what the assistant may know", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ language: "de", reply: "Hallo! **Check-in** ist ab 16 Uhr.\n\nMarta" }));
    const t = io(dir, msgs, model);
    expect(await main(["risposte", "leggi"], t)).toBe(0);
    expect(said(t)).toContain("Smoobu: 1 bookings, 2 new messages.");
    expect(said(t)).toContain("Drafts written: 1. Tokens: 300 in, 80 out, 1200 read from cache.");
    expect(said(t)).not.toContain(ANTHROPIC_KEY);

    expect(drafts(dir)).toEqual([
      { id: 1, stay_id: "smoobu:501", message_id: "11", text: "Hallo! Check-in ist ab 16 Uhr.\n\nMarta", edited_text: null, status: "waiting", flags: "[]", language: "de", needs_host: 0 },
    ]);
    const stay = db(dir).prepare("SELECT listing, language, channel, guests FROM hello_stays").get();
    expect(stay).toEqual({ listing: "loft", language: "de", channel: "Airbnb", guests: 2 });

    // What went to the model: the key only in the header, the house without the codes (the stay has not started), the conversation.
    expect(model.calls).toHaveLength(1);
    const call = model.calls[0] as (typeof model.calls)[number];
    expect(call.url).toBe("https://anthropic.example.com/v1/messages");
    expect(call.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
    expect(call.body.model).toBe("claude-haiku-5-5");
    const sent = JSON.stringify(call.body);
    expect(sent).not.toContain(ANTHROPIC_KEY);
    expect(sent).not.toContain("4471");
    expect(sent).not.toContain("Invented Guest");
    expect(sent).not.toMatch(/\b(?:100|180|80)\b ?(?:€|EUR)/);
    expect(call.body.system?.[0]?.text).toContain("Loft-Guest");
    expect(call.body.messages[0]?.content).toContain("GUEST: Hallo! What time is check-in?");
    expect(call.body.messages[0]?.content).toContain("Free nights in the calendar right after check-out: 2026-11-09, 2026-11-10, 2026-11-11");
  });

  it("reads again only the conversations that changed, and never writes two drafts for one message", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "Check-in from 16:00." }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    expect(msgs.reads).toEqual([501]);
    const t = io(dir, msgs, model);
    expect(await main(["risposte", "leggi"], t)).toBe(0);
    expect(msgs.reads).toEqual([501]);
    expect(model.calls).toHaveLength(1);
    expect(said(t)).toContain("Drafts written: 0.");
  });

  it("writes nothing when the host answered last, and nothing without casa/<listing>.md", async () => {
    const answered = await smoobuFolder({ messages: { 501: [guestAsks(11, "Hi"), hostSays(12, "Hi! See you")] } });
    const model = fakeModel(reply({ reply: "x" }));
    await main(["risposte", "leggi"], io(answered.dir, answered.msgs, model));
    expect(model.calls).toHaveLength(0);
    await smoobu?.close();

    const noHouse = await smoobuFolder({ house: null });
    const t = io(noHouse.dir, noHouse.msgs, model);
    expect(await main(["risposte", "leggi"], t)).toBe(0);
    expect(model.calls).toHaveLength(0);
    expect(said(t)).toContain('Listing "loft" has guests waiting but no casa/loft.md');
  });

  it("gives the access codes during the stay only, after the registration when the listing uses Fairguest", async () => {
    const { dir, msgs } = await smoobuFolder({ bookings: [booking(501, 398, "2026-10-31", "2026-11-03")] });
    const model = fakeModel(reply({ reply: "The key box code is 4471." }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    expect(model.calls[0]?.body.messages[0]?.content).toContain("<access_codes>\nKey box 4471\n</access_codes>");
  });

  it("marks a draft with a price and the sensitive topics, and stops at the limit per reading", async () => {
    const { dir, msgs } = await smoobuFolder({
      bookings: [booking(501, 398, "2026-11-05", "2026-11-09"), booking(502, 398, "2026-11-20", "2026-11-22")],
      messages: { 501: [guestAsks(11, "Can we have a discount?")], 502: [guestAsks(21, "Is there parking?")] },
    });
    writeFileSync(path.join(dir, "fairhello.json"), JSON.stringify({ maxDraftsPerRun: 1 }));
    const model = fakeModel(reply({ reply: "Sure, 20 € less per night." }));
    const t = io(dir, msgs, model);
    await main(["risposte", "leggi"], t);
    expect(drafts(dir).map((d) => [d.stay_id, d.flags, d.needs_host])).toEqual([["smoobu:501", '["price","money"]', 1]]);
    expect(said(t)).toContain("1 conversation left for the next reading.");
  });

  it("stops at once on a wrong key, and says so without showing it", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(() => ({ status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
    const t = io(dir, msgs, model);
    expect(await main(["risposte", "leggi"], t)).toBe(1);
    expect(said(t)).toContain("Anthropic refused the key (401)");
    expect(said(t)).not.toContain(ANTHROPIC_KEY);
    expect(drafts(dir)).toEqual([]);
  });

  it("can use Ollama on this computer, with no key", async () => {
    const { dir, msgs } = await smoobuFolder();
    writeFileSync(path.join(dir, "fairhello.json"), JSON.stringify({ provider: "ollama", model: "qwen3:8b" }));
    const model = fakeModel(reply({ reply: "Ab 16 Uhr." }));
    await main(["risposte", "leggi"], io(dir, msgs, model, { env: { ...ENV, ANTHROPIC_API_KEY: undefined } }));
    expect(model.calls[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(model.calls[0]?.body.model).toBe("qwen3:8b");
    expect(drafts(dir)[0]?.text).toBe("Ab 16 Uhr.");
  });

  it("erases the messages of stays past the retention period", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "x" }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    const later = io(dir, smoobuMessages({}, {}), model);
    later.setNow("2027-01-20T09:00:00Z");
    await main(["risposte", "leggi", "--senza-bozze"], later);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM hello_messages").get()).toEqual({ n: 0 });
    expect(drafts(dir)).toEqual([]);
    expect(db(dir).prepare("SELECT erased_at IS NOT NULL AS gone, guests FROM hello_stays").get()).toEqual({ gone: 1, guests: null });
    expect(said(later)).toContain("Erased the messages of 1 stay past the retention period.");
  });
});

describe("fairnight risposte invia", () => {
  it("shows what would be sent, sends only with --applica, once", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "Check-in from 16:00. See you!" }));
    await main(["risposte", "leggi"], io(dir, msgs, model));

    const dry = io(dir, msgs, model);
    expect(await main(["risposte", "invia", "1"], dry)).toBe(0);
    expect(said(dry)).toContain("Nothing was sent.");
    expect(msgs.sent).toEqual([]);

    const t = io(dir, msgs, model);
    expect(await main(["risposte", "invia", "1", "--applica"], t)).toBe(0);
    expect(msgs.sent).toEqual([{ bookingId: 501, body: { messageBody: "Check-in from 16:00. See you!" } }]);
    expect(drafts(dir)[0]?.status).toBe("sent");

    const again = io(dir, msgs, model);
    expect(await main(["risposte", "invia", "1", "--applica"], again)).toBe(1);
    expect(said(again)).toContain("Already sent");
    expect(msgs.sent).toHaveLength(1);
  });

  it("refuses a draft the guest made stale by writing again, read right before sending", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "From 16:00." }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    msgs.messages[501]?.push(guestAsks(13, "Sorry, we arrive at 23:00, is that ok?"));
    const t = io(dir, msgs, model);
    expect(await main(["risposte", "invia", "1", "--applica"], t)).toBe(1);
    expect(said(t)).toContain("The guest wrote again");
    expect(msgs.sent).toEqual([]);
    // The next reading writes the draft for the new message; the old one stays unsent.
    await main(["risposte", "leggi"], io(dir, msgs, model));
    expect(drafts(dir).map((d) => [d.id, d.message_id, d.status])).toEqual([
      [1, "11", "waiting"],
      [2, "13", "waiting"],
    ]);
    const list = io(dir, msgs, model);
    await main(["risposte"], list);
    expect(said(list)).toContain("#2  Seaside Loft, 2026-11-05 → 2026-11-09");
    expect(said(list)).toContain("1 outdated draft");
  });

  it("refuses a cancelled booking and a draft with a price nobody edited", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "It is 80 € more." }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    const t = io(dir, msgs, model);
    expect(await main(["risposte", "invia", "1", "--applica"], t)).toBe(1);
    expect(said(t)).toContain("contains a price");

    await smoobu?.close();
    const cancelled = await smoobuFolder({ bookings: [booking(501, 398, "2026-11-05", "2026-11-09", { type: "cancellation" })] });
    const m2 = fakeModel(reply({ reply: "x" }));
    await main(["risposte", "leggi"], io(cancelled.dir, cancelled.msgs, m2));
    expect(m2.calls).toHaveLength(0);
  });

  it("keeps a failed send to try again, with Smoobu's reason", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "From 16:00." }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    msgs.failSend = { status: 400, body: { title: "Validation", detail: "messageBody is too long" } };
    const t = io(dir, msgs, model);
    expect(await main(["risposte", "invia", "1", "--applica"], t)).toBe(1);
    expect(said(t)).toContain("messageBody is too long");
    expect(drafts(dir)[0]?.status).toBe("failed");
    msgs.failSend = null;
    expect(await main(["risposte", "invia", "1", "--applica"], io(dir, msgs, model))).toBe(0);
    expect(drafts(dir)[0]?.status).toBe("sent");
  });

  it("discards a draft", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "x" }));
    await main(["risposte", "leggi"], io(dir, msgs, model));
    expect(await main(["risposte", "scarta", "1"], io(dir, msgs, model))).toBe(0);
    expect(drafts(dir)[0]?.status).toBe("discarded");
    expect(await main(["risposte", "scarta", "1"], io(dir, msgs, model))).toBe(1);
  });
});

describe("the /risposte page", () => {
  async function serve(dir: string, t: TestIo) {
    const server = await startServer({ dir, io: t, days: 30, port: 0, lan: false, quiet: true });
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  const tokenOf = (html: string, action: string) => {
    const form = html.slice(html.indexOf(`action="${action}`));
    return /name="t" value="([^"]+)"/.exec(form)?.[1] as string;
  };
  const post = (url: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString() });

  it("shows the draft with the conversation, escaped, in the host's language, and the free nights with their price", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "Ab 16 Uhr <3", note: "check the time" }));
    const t = io(dir, msgs, model);
    await main(["risposte", "leggi"], t);
    const base = await serve(dir, t);
    const res = await fetch(`${base}/risposte`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("form-action 'self'");
    const html = await res.text();
    expect(html).toContain('<html lang="it">');
    expect(html).toContain("Risposte agli ospiti");
    expect(html).toContain("Hallo! What time is check-in? &lt;b&gt;thanks&lt;/b&gt;");
    expect(html).toContain("Ab 16 Uhr &lt;3</textarea>");
    expect(html).toContain("check the time");
    expect(html).toContain("Dopo la partenza:");
    expect(html).toMatch(/9 nov[^,]*100\s?€/);
    expect(html).not.toContain("<script");
  });

  it("is refused through a proxy or tunnel, and to forms without the right token", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "x" }));
    const t = io(dir, msgs, model);
    await main(["risposte", "leggi"], t);
    const base = await serve(dir, t);
    expect((await fetch(`${base}/risposte`, { headers: { "x-forwarded-for": "203.0.113.9" } })).status).toBe(403);
    expect((await post(`${base}/risposte/1/invia`, { t: "forged", text: "hi" })).status).toBe(403);
    expect((await post(`${base}/risposte/1/invia`, { t: "x" }, { origin: "https://evil.example.com" })).status).toBe(403);
    expect((await fetch(`${base}/risposte/1/invia`)).status).toBe(405);
    expect(msgs.sent).toEqual([]);
  });

  it("sends the host's version of the draft, even one that had a price", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "It costs 80 €." }));
    const t = io(dir, msgs, model);
    await main(["risposte", "leggi"], t);
    const base = await serve(dir, t);
    const html = await (await fetch(`${base}/risposte`)).text();
    const tok = tokenOf(html, "/risposte/1/invia");
    // Unchanged, the price blocks it.
    let res = await post(`${base}/risposte/1/invia`, { t: tok, text: "It costs 80 €." });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("esito=price");
    expect(msgs.sent).toEqual([]);
    // The host writes their own words: it goes.
    res = await post(`${base}/risposte/1/invia`, { t: tok, text: "Check-in from 16:00, I will write you about the late arrival.\r\n" });
    expect(res.headers.get("location")).toContain("esito=sent");
    expect(msgs.sent).toEqual([{ bookingId: 501, body: { messageBody: "Check-in from 16:00, I will write you about the late arrival." } }]);
    expect(drafts(dir)[0]?.edited_text).toBe("Check-in from 16:00, I will write you about the late arrival.");
  });

  it("reads new messages and discards from the buttons", async () => {
    const { dir, msgs } = await smoobuFolder();
    const model = fakeModel(reply({ reply: "From 16:00." }));
    const t = io(dir, msgs, model);
    const base = await serve(dir, t);
    const html = await (await fetch(`${base}/risposte`)).text();
    expect(html).toContain("Nessuna risposta da approvare.");
    let res = await post(`${base}/risposte/leggi?lang=it`, { t: tokenOf(html, "/risposte/leggi") });
    expect(res.headers.get("location")).toBe("/risposte?lang=it&esito=read&d=1&m=2");
    const page = await (await fetch(`${base}${res.headers.get("location")}`)).text();
    expect(page).toContain("Letti 2 messaggi nuovi, scritte 1 bozze.");
    res = await post(`${base}/risposte/1/scarta`, { t: tokenOf(page, "/risposte/1/invia") });
    expect(res.headers.get("location")).toContain("esito=discarded");
    expect(drafts(dir)[0]?.status).toBe("discarded");
  });
});

describe("Beds24", () => {
  it("reads the messages of the bookings, drafts in the guest's language and sends through Beds24", async () => {
    const clock = { now: Date.parse(NOW) };
    const b: FakeBeds24Booking = {
      id: 7001,
      propertyId: 10,
      roomId: 101,
      status: "confirmed",
      arrival: "2026-11-05",
      departure: "2026-11-08",
      bookingTime: "2026-10-20T14:03:00Z",
      price: 300,
      firstName: "Invented",
      lastName: "Guest",
      numAdult: 2,
      numChild: 1,
    };
    beds24 = await startFakeBeds24({
      inviteCode: "invite-0000-not-real",
      refreshToken: TEST_REFRESH,
      clock,
      properties: [{ id: 10, name: "Seaside House", currency: "EUR", rooms: [{ id: 101, name: "Loft", qty: 1 }] }],
      bookings: [{ ...b, lang: "it" } as FakeBeds24Booking],
    });
    const dir = tempDir();
    await main(["init"], testIo(dir));
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [{ name: "loft", calendars: [{ source: "beds24", roomId: 101 }], pricing: PRICING }] }));
    mkdirSync(path.join(dir, "casa"));
    writeFileSync(path.join(dir, "casa", "loft.md"), HOUSE);
    const msgs = beds24Messages([
      { id: 1, bookingId: 7001, source: "guest", message: "Ciao, c'è il parcheggio?", time: "2026-10-31T08:00:00Z" },
      { id: 2, bookingId: 7001, source: "internalNote", message: "nota interna", time: "2026-10-31T08:01:00Z" },
    ]);
    const model = fakeModel(reply({ language: "it", reply: "Ciao! Sì, in strada." }));
    const t = testIo(dir, undefined, NOW);
    Object.assign(t, { env: { BEDS24_REFRESH_TOKEN: TEST_REFRESH, ANTHROPIC_API_KEY: ANTHROPIC_KEY }, beds24BaseUrl: beds24.baseUrl, beds24Fetch: msgs.fetch, modelFetch: model.fetch, anthropicBaseUrl: "https://anthropic.example.com", now: () => new Date(clock.now), sleep: async () => {} });
    expect(await main(["risposte", "leggi"], t)).toBe(0);
    expect(said(t)).toContain("Beds24: 1 bookings, 1 new message.");
    expect(model.calls[0]?.body.messages[0]?.content).not.toContain("nota interna");
    expect(model.calls[0]?.body.messages[0]?.content).toContain("Guest's language according to the booking: it");
    expect(db(dir).prepare("SELECT guests, language FROM hello_stays").get()).toEqual({ guests: 3, language: "it" });
    expect(await main(["risposte", "invia", "1", "--applica"], t)).toBe(0);
    expect(msgs.sent).toEqual([{ bookingId: 7001, message: "Ciao! Sì, in strada." }]);
  });
});

describe("setup", () => {
  it("collega saves the model and the key, never shown", async () => {
    const dir = tempDir();
    await main(["init"], testIo(dir));
    const answers = ["1", "Marta", ANTHROPIC_KEY];
    const asked: { q: string; hidden: boolean }[] = [];
    const t = testIo(dir);
    Object.assign(t, { env: {}, prompt: async (q: string, o: { hidden: boolean }) => (asked.push({ q, hidden: o.hidden }), answers.shift() as string) });
    expect(await main(["risposte", "collega"], t)).toBe(0);
    expect(asked.map((a) => a.hidden)).toEqual([false, false, true]);
    expect(JSON.parse(readFileSync(path.join(dir, "fairhello.json"), "utf8"))).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", signature: "Marta", retentionDays: 60, maxDraftsPerRun: 20 });
    expect(JSON.parse(readFileSync(path.join(dir, "fairhello-credentials.json"), "utf8"))).toEqual({ anthropicApiKey: ANTHROPIC_KEY });
    expect(said(t)).not.toContain(ANTHROPIC_KEY);

    const st = testIo(dir);
    Object.assign(st, { env: {} });
    expect(await main(["risposte", "stato"], st)).toBe(0);
    expect(said(st)).toContain("Anthropic key: saved in fairhello-credentials.json");
    expect(said(st)).not.toContain(ANTHROPIC_KEY);

    const ollama = testIo(dir);
    const more = ["2", "", "gemma4:12b"];
    Object.assign(ollama, { env: {}, prompt: async () => more.shift() as string });
    await main(["risposte", "collega"], ollama);
    expect(JSON.parse(readFileSync(path.join(dir, "fairhello.json"), "utf8"))).toMatchObject({ provider: "ollama", model: "gemma4:12b", ollamaUrl: "http://127.0.0.1:11434", signature: "Marta" });
  });

  it("refuses a broken fairhello.json with every problem", async () => {
    const { dir, msgs } = await smoobuFolder();
    writeFileSync(path.join(dir, "fairhello.json"), JSON.stringify({ provider: "openai", ollamaUrl: "http://192.168.1.5:11434", retentionDays: 1, extra: true }));
    const t = io(dir, msgs, fakeModel(reply({ reply: "x" })));
    expect(await main(["risposte", "leggi"], t)).toBe(1);
    for (const p of ['unknown field "extra"', "provider must be anthropic or ollama", "ollamaUrl must be on this computer", "retentionDays must be a whole number from 3"]) expect(said(t)).toContain(p);
  });

  it("casa writes the house file from questions, codes apart, and never overwrites it", async () => {
    const dir = tempDir();
    await main(["init"], testIo(dir));
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ language: "it", listings: [{ name: "loft", calendars: [], pricing: PRICING }] }));
    const answers = ["Loft sul mare", "Dalle 16:00, cassetta a sinistra", "", "Rete Loft", "", "", "", "", "", "", "Cassetta 4471"];
    const t = testIo(dir);
    Object.assign(t, { prompt: async () => answers.shift() ?? "" });
    expect(await main(["risposte", "casa", "--listing", "loft"], t)).toBe(0);
    const text = readFileSync(path.join(dir, "casa", "loft.md"), "utf8");
    expect(text).toContain("# Loft sul mare\n\n## Check-in\nDalle 16:00, cassetta a sinistra\n\n## Wifi\nRete Loft\n");
    expect(text).toContain("## Codici d'accesso\nCassetta 4471");
    expect(text).not.toContain("## Check-out");
    const again = testIo(dir);
    Object.assign(again, { prompt: async () => "x" });
    expect(await main(["risposte", "casa", "--listing", "loft"], again)).toBe(1);
    expect(said(again)).toContain("esiste già");
    expect(existsSync(path.join(dir, "casa", "loft.md"))).toBe(true);
  });

  it("needs a listing linked to Smoobu or Beds24", async () => {
    const dir = tempDir();
    await main(["init"], testIo(dir));
    const t = testIo(dir);
    expect(await main(["risposte", "leggi"], t)).toBe(1);
    expect(said(t)).toContain("No listing is linked to Smoobu or Beds24");
  });
});
