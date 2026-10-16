/**
 * The tourist tax and the payments in the host's own Stripe account, from the
 * check-in form to the deposit kept or released. Stripe is a fake in memory
 * that accepts only test keys (sk_test_…), like Stripe's test mode: no real
 * money anywhere. Invented data only: Ospite Prova, stays in 2099.
 *
 * With STRIPE_TEST_SECRET_KEY set (a real sk_test_ key), one more block holds
 * and then keeps or releases a card in Stripe's real test mode.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { StripeClient } from "../src/payments/stripe.js";
import { startServer } from "../src/serve.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";
import { fakeStripe } from "./stripe-fake.js";

const NOW = "2099-06-09T09:00:00";
const PASS = "frase segreta di prova";
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const ICAL = "https://cal.example.org/airbnb/casa-prova.ics";
const STRIPE = "https://stripe.example.invalid";
// Shaped like a test key, but not one: the fake checks only the prefix.
const TEST_KEY = "sk_test_xxx-0000-not-real".replace(/-/g, "");

const servers: Server[] = [];
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) if (d.open) d.close();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function ics(events: { uid: string; start: string; end: string }[]): string {
  const body = events.map((e) => `BEGIN:VEVENT\r\nDTEND;VALUE=DATE:${e.end}\r\nDTSTART;VALUE=DATE:${e.start}\r\nUID:${e.uid}\r\nSUMMARY:Reserved\r\nEND:VEVENT`).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

const PRICING = { name: "Casa di Prova", currency: "EUR", basePrice: 100, defaultMinStay: 1, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 } } };

async function ready(payments: unknown = { enabled: true, deposit: 200 }, touristTax: unknown = { place: "barcelona" }) {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const fairguest = { country: "ES-CT", establishment: "ZZ00000000", establishmentName: "Casa di Prova", touristTax, ...(payments ? { payments } : {}) };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ language: "it", listings: [{ name: "casa-prova", calendars: [{ source: "airbnb", url: ICAL }], pricing: PRICING, fairguest }] }, null, 2));
  const stripe = fakeStripe();
  const cal = fakeFetch({ [ICAL]: ics([{ uid: "prova-1@airbnb.example", start: "20990610", end: "20990613" }]) });
  const io = (extra: Partial<TestIo> = {}, key: string | null = TEST_KEY) =>
    Object.assign(testIo(dir, cal, NOW), { scryptCost: FAST, env: { FAIRGUEST_FRASE: PASS, ...(key ? { STRIPE_SECRET_KEY: key } : {}) }, stripeFetch: stripe.fetchFn, stripeBaseUrl: STRIPE, ...extra });
  expect(await main(["ospiti", "attiva"], io())).toBe(0);
  expect(await main(["sync"], io())).toBe(0);
  const db = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(db);
  const stay = db.prepare("SELECT id, code FROM guest_stays").get() as { id: string; code: string };
  return { dir, stripe, io, db, stay };
}

async function serve(io: TestIo): Promise<string> {
  const server = await startServer({ dir: io.cwd, io, days: 30, port: 0, lan: false, quiet: true });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const HOLDER = {
  givenName: "Ospite",
  surname1: "Prova",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  docType: "passport",
  docNumber: "ZZ0000000",
  docIssued: "2095-01-10",
  country: "ITA",
  street: "Via di Prova 1",
  postalCode: "00000",
  locality: "Città di Prova",
  email: "ospite.prova@example.com",
  payment: "platform",
};
const CHILD = { givenName: "Esempio", surname1: "Prova", birthDate: "2092-07-01", nationality: "ITA", country: "ITA", street: "Via di Prova 1", locality: "Città di Prova", phone: "+39 000 000 0000", kinship: "child" };

async function postGuest(base: string, code: string, fields: Record<string, string>) {
  const form = await fetch(`${base}/checkin/${code}?lang=it`);
  const t = /name="t" value="([^"]+)"/.exec(await form.text())?.[1] ?? "";
  const res = await fetch(`${base}/checkin/${code}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, lang: "it", ...fields }).toString() });
  expect(res.status).toBe(303);
}

const payLinks = (html: string) => [...html.matchAll(/href="(https:\/\/buy\.stripe\.com\/[^"]+)"/g)].map((m) => m[1] as string);

describe("check-in with the tourist tax and the deposit (Stripe test mode)", () => {
  it("the guest pays the tax and leaves the deposit; the class is kept, never the age", async () => {
    const { stripe, io, db, stay } = await ready();
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    await postGuest(base, stay.code, CHILD);
    // Only the class in clear: the adult pays, the 6-year-old does not (under 17 in Catalonia).
    expect(db.prepare("SELECT tax_class FROM guest_people ORDER BY added_at, rowid").all()).toEqual([{ tax_class: "pays" }, { tax_class: "exempt-age" }]);

    const page = await (await fetch(`${base}/checkin/${stay.code}?lang=it&saved=2`)).text();
    expect(page).toContain("Imposta di soggiorno · Barcelona");
    expect(page).toContain("1 persona × 3 notti");
    expect(page).toMatch(/Paga 28,50\s€ con carta/);
    const [taxUrl, depositUrl] = payLinks(page);
    expect(taxUrl).toBeTruthy();
    expect(depositUrl).toBeTruthy();
    // Stripe sees the random id of the stay, nothing about the guests.
    const link = [...stripe.links.values()].find((l) => l.url === taxUrl);
    expect(link?.metadata).toMatchObject({ fairguest_stay: stay.id, fairguest_kind: "tax" });
    expect(link?.manual).toBe(false);
    expect([...stripe.links.values()].find((l) => l.url === depositUrl)?.manual).toBe(true);
    expect([...stripe.prices.values()].map((p) => p.amount).sort((a, b) => a - b)).toEqual([2850, 20000]);

    stripe.pay(taxUrl as string);
    stripe.pay(depositUrl as string);
    const after = await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text();
    expect(after).toContain("Pagata. Grazie.");
    expect(after).toContain("Cauzione bloccata sulla carta.");
    expect(payLinks(after)).toEqual([]);
    expect(db.prepare("SELECT kind, status, amount, live FROM guest_payments ORDER BY kind").all()).toEqual([
      { kind: "deposit", status: "held", amount: 20000, live: 0 },
      { kind: "tax", status: "paid", amount: 2850, live: 0 },
    ]);
  });

  it("a guest added after paying: a new link for the difference only", async () => {
    const { stripe, io, stay } = await ready({ enabled: true });
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    const [first] = payLinks(await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text());
    stripe.pay(first as string);
    await postGuest(base, stay.code, { ...HOLDER, givenName: "Seconda", docNumber: "ZZ0000001" });
    const html = await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text();
    expect(html).toMatch(/Paga 28,50\s€ con carta/);
    expect([...stripe.prices.values()].map((p) => p.amount)).toEqual([2850, 2850]);
  });

  it("the deposit is released from the command line: nothing is charged", async () => {
    const { stripe, io, stay } = await ready();
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    const [, deposit] = payLinks(await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text());
    const pi = stripe.pay(deposit as string);
    const t = io();
    expect(await main(["pagamenti", "rilascia", stay.id], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/would release the 200.00 EUR deposit/);
    expect(stripe.intents.get(pi)?.status).toBe("requires_capture");
    expect(await main(["pagamenti", "rilascia", stay.id, "--applica"], t)).toBe(0);
    expect(stripe.intents.get(pi)?.status).toBe("canceled");
    expect(t.lines.join("\n")).toMatch(/deposit released\. \(Stripe test mode: no real money\.\)/);
  });

  it("the deposit is kept in part from the page /pagamenti, the rest goes back", async () => {
    const { stripe, io, db, stay } = await ready();
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    const [, deposit] = payLinks(await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text());
    const pi = stripe.pay(deposit as string);
    const panel = await (await fetch(`${base}/pagamenti`)).text();
    expect(panel).toContain("Stripe in modalità di prova");
    expect(panel).toContain("bloccata sulla carta");
    const t = /action="\/pagamenti\/trattieni"[^>]*><input type="hidden" name="t" value="([^"]+)"/.exec(panel)?.[1] as string;
    const res = await fetch(`${base}/pagamenti/trattieni`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, stay: stay.id, amount: "75,50" }).toString() });
    expect(res.status).toBe(303);
    expect(stripe.intents.get(pi)).toMatchObject({ status: "succeeded", amount_received: 7550 });
    expect(db.prepare("SELECT status, captured FROM guest_payments WHERE kind = 'deposit'").get()).toEqual({ status: "captured", captured: 7550 });
    // A forged form (wrong token) does nothing.
    const forged = await fetch(`${base}/pagamenti/rilascia`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: "x", stay: stay.id }).toString() });
    expect(forged.status).toBe(422);
  });

  it("without the host's key: no card for the guest, no call to Stripe, the panel says why", async () => {
    const { stripe, io, stay } = await ready();
    const t = io({}, null);
    const base = await serve(t);
    await postGuest(base, stay.code, HOLDER);
    const page = await (await fetch(`${base}/checkin/${stay.code}?lang=it&saved=1`)).text();
    expect(page).not.toContain("Imposta di soggiorno · Barcelona");
    expect(await (await fetch(`${base}/pagamenti`)).text()).toContain("Nessuna chiave Stripe");
    expect(await main(["pagamenti", "prepara"], t)).toBe(0);
    expect(await main(["pagamenti"], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/No Stripe key in this folder: nothing was sent to Stripe/);
    expect(stripe.calls).toEqual([]);
  });

  it("payments off by default: a tax rule alone asks no payment", async () => {
    const { stripe, io, stay } = await ready(null);
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    expect(payLinks(await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text())).toEqual([]);
    expect(stripe.calls).toEqual([]);
  });

  it("a publishable key is refused: it cannot create payments", async () => {
    const { io } = await ready();
    const t = io({ prompt: async () => "pk_test_abcdefghijklmnop" }, null);
    expect(await main(["pagamenti", "collega"], t)).toBe(1);
    expect(t.errors.join("\n")).toMatch(/publishable key/);
  });
});

describe("the declaration to the town", () => {
  it("monthly summary as CSV and PDF, with the guests who do not pay counted apart", async () => {
    const { dir, io, stay } = await ready(null);
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    await postGuest(base, stay.code, CHILD);
    const t = io();
    expect(await main(["tassa", "riepilogo", "--mese", "2099-06"], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/Barcelona, 2099-06: 1 stay, 3 taxed person-nights, tax 28\.50 EUR/);
    const csv = readFileSync(path.join(dir, "data", "tassa", "barcelona-2099-06.csv"), "utf8");
    expect(csv).toContain(`${stay.id};casa-prova;2099-06-10;2099-06-13;3;2;1;0;1;0;0;0;3;0;28,50;0,00`);
    expect(existsSync(path.join(dir, "data", "tassa", "barcelona-2099-06.pdf"))).toBe(true);
    // Erasing the guests keeps the counts for the declaration.
    expect(await main(["ospiti", "cancella", stay.id, "--applica"], t)).toBe(0);
    expect(await main(["tassa", "riepilogo", "--trimestre", "2099-Q2"], t)).toBe(0);
    expect(readFileSync(path.join(dir, "data", "tassa", "barcelona-2099-Q2.csv"), "utf8")).toContain(";28,50;");
    // The same summary from the page /pagamenti.
    const pdf = await fetch(`${base}/pagamenti/riepilogo?place=barcelona&periodo=2099-06&formato=pdf`);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).toString("latin1").startsWith("%PDF-")).toBe(true);
  });

  it("tassa esenta changes one guest's class", async () => {
    const { io, stay } = await ready(null);
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    const t = io();
    expect(await main(["tassa", "esenta", stay.id, "--persona", "1", "--motivo", "altro"], t)).toBe(0);
    expect(await main(["tassa", "soggiorno", stay.id], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/guest 1: exempt \(other\)[\s\S]*tax: 0\.00 EUR/);
  });

  it("tassa tariffe lists the starting values with the official source", async () => {
    const t = testIo(tempDir());
    expect(await main(["tassa", "tariffe"], t)).toBe(0);
    const out = t.lines.join("\n");
    expect(out).toMatch(/roma {7}Roma: 6\.00 EUR per person per night · first 10 nights · under 10 exempt · residents exempt/);
    expect(out).toMatch(/bologna .*rate: not found, write your own/);
    expect(out).toMatch(/canarias .*0\.00 EUR/);
    expect(out).toContain("read on 2026-10-15");
  });
});

describe("points to check with the town", () => {
  it("the page shows the words of the regulation and the source until the host presses «Ho verificato»", async () => {
    const { dir, io } = await ready(null, { place: "napoli" });
    const base = await serve(io());
    const page = await (await fetch(`${base}/pagamenti`)).text();
    expect(page).toContain("Da verificare: età esenti a Napoli");
    expect(page).toContain("i minori entro il quattordicesimo anno d&#39;età");
    expect(page).toContain('href="https://www.comune.napoli.it/articolo_tematico/tributi-locali/imposta-di-soggiorno/imposta-di-soggiorno-2026/"');
    expect(page).toContain("Fairguest ora esenta chi ha meno di 14 anni");
    // The summary says it too, until confirmed.
    const t = io();
    expect(await main(["tassa", "riepilogo", "--mese", "2099-06"], t)).toBe(0);
    expect(t.lines.join("\n")).toContain("! To check: exempt ages in Napoli");
    expect(readFileSync(path.join(dir, "data", "tassa", "napoli-2099-06.csv"), "utf8")).toContain("DA VERIFICARE: ETÀ ESENTI A NAPOLI");
    // A forged confirmation does nothing.
    const forged = await fetch(`${base}/pagamenti/conferma`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: "x", place: "napoli" }).toString() });
    expect(forged.status).toBe(422);
    const tok = /action="\/pagamenti\/conferma"><input type="hidden" name="t" value="([^"]+)"/.exec(page)?.[1] as string;
    const res = await fetch(`${base}/pagamenti/conferma`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: tok, place: "napoli" }).toString() });
    expect(res.status).toBe(303);
    const config = JSON.parse(readFileSync(path.join(dir, "fairnight.config.json"), "utf8"));
    expect(config.listings[0].fairguest.touristTax).toEqual({ place: "napoli", confirmed: true });
    expect(existsSync(path.join(dir, "fairnight.config.json.bak"))).toBe(true);
    expect(await (await fetch(`${base}/pagamenti`)).text()).not.toContain("Da verificare");
  });

  it("fairnight tassa conferma does the same from the terminal", async () => {
    const { dir, io } = await ready(null, { place: "catania" });
    const before = io();
    expect(await main(["tassa", "tariffe"], before)).toBe(0);
    expect(before.lines.join("\n")).toMatch(/catania .*under 16 exempt[\s\S]*! To check: exempt ages in Catania[\s\S]*I minori entro il sedicesimo anno/);
    const t = io();
    expect(await main(["tassa", "conferma", "catania"], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/Confirmed for casa-prova/);
    expect(JSON.parse(readFileSync(path.join(dir, "fairnight.config.json"), "utf8")).listings[0].fairguest.touristTax.confirmed).toBe(true);
    const after = io();
    await main(["tassa", "tariffe"], after);
    expect(after.lines.join("\n")).toMatch(/Your listings:\n {2}casa-prova: Catania, [^\n]*\n?$/);
  });

  it("a reduced guest is counted at the reduced rate in the check-in (Verona, a 75-year-old)", async () => {
    const { io, db, stay } = await ready({ enabled: true }, { place: "verona" });
    const base = await serve(io());
    await postGuest(base, stay.code, HOLDER);
    await postGuest(base, stay.code, { ...HOLDER, givenName: "Nonna", birthDate: "2024-01-01", docNumber: "ZZ0000002" });
    expect(db.prepare("SELECT tax_class FROM guest_people ORDER BY added_at, rowid").all()).toEqual([{ tax_class: "pays" }, { tax_class: "reduced:70-" }]);
    // 3 nights: 3 × 3.50 + 3 × 2.80.
    expect(await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text()).toMatch(/Paga 18,90\s€ con carta/);
  });
});

/**
 * A real Stripe test key: STRIPE_TEST_SECRET_KEY, from the environment or from
 * .env.local at the root of the repository (git ignores it). Only sk_test_
 * keys: a live key is never used by the tests, whatever is written there.
 */
function realTestKey(): string | null {
  let key = process.env.STRIPE_TEST_SECRET_KEY?.trim();
  if (!key) {
    const file = new URL("../../../.env.local", import.meta.url);
    if (existsSync(file)) {
      const line = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .find((l) => /^\s*STRIPE_TEST_SECRET_KEY\s*=/.test(l));
      key = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return key && /^sk_test_[A-Za-z0-9]{10,}$/.test(key) ? key : null;
}

const REAL = realTestKey();
describe.skipIf(!REAL)("Stripe's real test mode (STRIPE_TEST_SECRET_KEY)", { timeout: 60_000 }, () => {
  async function heldCard(): Promise<string> {
    const body = new URLSearchParams({ amount: "5000", currency: "eur", capture_method: "manual", confirm: "true", payment_method: "pm_card_visa", "payment_method_types[]": "card", description: "Fairguest test: a deposit held" });
    const res = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { authorization: `Bearer ${REAL}`, "content-type": "application/x-www-form-urlencoded" }, body });
    const pi = (await res.json()) as { id: string; status: string };
    expect(pi.status).toBe("requires_capture");
    return pi.id;
  }
  const client = () => new StripeClient({ key: REAL as string, live: false, source: "environment" }, testIo(tempDir(), fakeFetch({}), new Date().toISOString()));

  it("the key works and is a test key", async () => {
    await client().check();
  });

  it("makes the deposit link exactly as the check-in does: a hold, usable once; then turns it off", async () => {
    const c = client();
    const price = await c.createPrice({ currency: "EUR", unitAmount: 20000, name: "Fairguest test · Cauzione · 2099-06-10 → 2099-06-13" });
    const link = await c.createPaymentLink({ price, manual: true, metadata: { fairguest_stay: "fgtest", fairguest_kind: "deposit", fairguest_payment: "gptest" } });
    expect(link.url).toMatch(/^https:\/\/buy\.stripe\.com\//);
    const res = await fetch(`https://api.stripe.com/v1/payment_links/${link.id}`, { headers: { authorization: `Bearer ${REAL}` } });
    const seen = (await res.json()) as { active: boolean; payment_intent_data: { capture_method: string } | null; restrictions: { completed_sessions: { limit: number } } | null; metadata: Record<string, string> };
    expect(seen.payment_intent_data?.capture_method).toBe("manual");
    expect(seen.restrictions?.completed_sessions.limit).toBe(1);
    expect(seen.metadata.fairguest_stay).toBe("fgtest");
    // Nobody paid it: no finished checkout.
    expect(await c.completedSessions(link.id)).toEqual([]);
    await c.deactivateLink(link.id);
    const off = (await (await fetch(`https://api.stripe.com/v1/payment_links/${link.id}`, { headers: { authorization: `Bearer ${REAL}` } })).json()) as { active: boolean };
    expect(off.active).toBe(false);
  });

  it("keeps part of a held card (trattiene)", async () => {
    const c = client();
    const id = await heldCard();
    expect((await c.paymentIntent(id)).status).toBe("requires_capture");
    const pi = await c.capture(id, 1500);
    expect(pi.status).toBe("succeeded");
    expect(pi.amountReceived).toBe(1500);
  });

  it("releases a held card (rilascia)", async () => {
    expect((await client().cancel(await heldCard())).status).toBe("canceled");
  });
});
