/**
 * The daily cap on the calendar: nights held back say so with the three numbers,
 * and the host can let one through. The cap itself stays as it was for every
 * night the host did not confirm.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeSmoobu } from "../../fairnight-smoobu/test/fake-smoobu.js";
import { addDays } from "../src/channel.js";
import { loadHostConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { activeConfirmations, confirmNights, nightMarks } from "../src/pilota-conferme.js";
import { guardPlan, runPilot } from "../src/pilota.js";
import { handlePilot } from "../src/pilota-pagina.js";
import { pricesPayload } from "../src/serve.js";
import { startServer } from "../src/serve.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

// 2026-11-01 is a Sunday; the 7th and the 14th are Saturdays, 110 against 100 on the other nights.
const NOW = "2026-11-01T09:00:00Z";
const TODAY = "2026-11-01";
const SATURDAY = "2026-11-07";
const NEXT_SATURDAY = "2026-11-14";
const ENV = { SMOOBU_API_KEY: TEST_CREDENTIALS.apiKey, SMOOBU_API_SECRET: TEST_CREDENTIALS.apiSecret };
const SYSTEM = { platform: "win32" as const, home: "C:/Users/anna", user: "anna", uid: null, node: "C:/node.exe", script: "C:/fairnight.js" };

let clock = new Date(NOW);
let smoobu: FakeSmoobu | null = null;
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) if (d.open) d.close();
  await smoobu?.close();
  smoobu = null;
});

const LOFT = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: {
    limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 },
    dayOfWeek: { enabled: true, adjustments: { sat: 10 } },
    rounding: { enabled: true, step: 1 },
  },
};

function ratesAt(price: number) {
  const days: Record<string, { price: number | null; min_length_of_stay: number | null; available: number }> = {};
  for (let i = 0; i < 120; i++) days[addDays(TODAY, i)] = { price, min_length_of_stay: 2, available: 1 };
  return days;
}

async function setUp(price: number, pilot: object = { enabled: true }, language?: string) {
  clock = new Date(NOW);
  smoobu = await startFakeSmoobu({
    ...TEST_CREDENTIALS,
    now: () => clock,
    apartments: [{ id: 398, name: "Seaside Loft", currency: "EUR", minimal: "80.00", maximal: "180.00" }],
    bookings: [],
    rates: { 398: ratesAt(price) },
    rangeEnd: "exclusive",
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const entry = { name: "loft", calendars: [{ source: "smoobu", apartmentId: 398 }], pricing: LOFT, pilot };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ ...(language ? { language } : {}), listings: [entry] }, null, 2));
  return dir;
}

function io(dir: string): TestIo {
  const base = testIo(dir, undefined, NOW);
  Object.assign(base, {
    env: ENV,
    system: SYSTEM,
    smoobuBaseUrl: smoobu?.baseUrl,
    smoobuFetch: (url: string, init: RequestInit) => fetch(url, init),
    sleep: async () => {},
    now: () => clock,
    setNow: (iso: string) => {
      clock = new Date(iso);
    },
  });
  return base;
}

function db(dir: string) {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

const priceOn = (date: string) => (smoobu as FakeSmoobu).rates[398]?.[date]?.price;
const posts = () => (smoobu as FakeSmoobu).log.filter((r) => r.method === "POST");
const plain = (s: string) => s.replace(/\u00a0/g, " ");

/** The night as the calendar page gets it. */
function night(dir: string, date: string, today = TODAY) {
  return pricesPayload(dir, loadHostConfig(dir), today, 30).listings[0]?.nights.find((n) => n.date === date) as unknown as {
    price: number;
    held?: { calculated: number; sent: number; difference: number; maxChange: number };
    confirmation?: { by: string; via: string; at: string };
  };
}

async function priceLines(dir: string, ...args: string[]) {
  const t = io(dir);
  expect(await main(["price", "--days", "14", "--today", TODAY, ...args], t)).toBe(0);
  return t.lines.map(plain);
}

describe("a night under the cap", () => {
  it("has no mark", async () => {
    const dir = await setUp(100);
    await main(["pilota", "giro"], io(dir));
    expect(priceOn(SATURDAY)).toBe(110);
    expect(night(dir, SATURDAY).held).toBeUndefined();
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_held").get()).toEqual({ n: 0 });
    expect((await priceLines(dir)).some((l) => l.includes("Held back"))).toBe(false);
  });
});

describe("a night held back by the cap", () => {
  it("shows the calculated price, the price sent and the difference", async () => {
    const dir = await setUp(80);
    await main(["pilota", "giro"], io(dir));
    expect(priceOn(SATURDAY)).toBe(92);
    expect(night(dir, SATURDAY).held).toMatchObject({ calculated: 110, sent: 92, difference: -18, maxChange: 15 });
  });

  it("says it in the night's explanation and in the command, in the folder's language", async () => {
    const dir = await setUp(80, { enabled: true }, "it");
    await main(["pilota", "giro"], io(dir));
    const lines = await priceLines(dir, "--explain");
    expect(lines).toContain("  Trattenuta dal tetto: 92 € invece di 110 €");
    expect(lines).toContain("  Prezzo calcolato 110 €, prezzo mandato al canale 92 €, differenza 18 €. Il tetto lo muove del 15% al giorno.");
    expect(await priceLines(dir)).toContain("  Trattenuta dal tetto: 92 € invece di 110 €");
  });

  it("speaks Spanish and English too", async () => {
    const es = await setUp(80, { enabled: true }, "es");
    await main(["pilota", "giro"], io(es));
    expect(await priceLines(es)).toContain("  Frenada por el tope: 92 € en lugar de 110 €");
    await smoobu?.close();
    const en = await setUp(80);
    await main(["pilota", "giro"], io(en));
    expect(await priceLines(en)).toContain("  Held back by the cap: €92 instead of €110");
  });

  it("the --json of the command carries the same numbers", async () => {
    const dir = await setUp(80);
    await main(["pilota", "giro"], io(dir));
    const t = io(dir);
    await main(["price", "--days", "14", "--today", TODAY, "--json"], t);
    const nights = JSON.parse(t.lines.join("\n"))[0].nights as { date: string; held?: object }[];
    expect(nights.find((n) => n.date === SATURDAY)?.held).toMatchObject({ calculated: 110, sent: 92 });
  });

  it("works on the way down too: the cap holds a fall, the difference is positive", async () => {
    const dir = await setUp(200);
    await main(["pilota", "giro"], io(dir));
    expect(night(dir, "2026-11-02").held).toMatchObject({ calculated: 100, sent: 170, difference: 70 });
  });

  it("keeps a night the cap could not move at all, which the log of written nights never sees", async () => {
    const dir = await setUp(61, { enabled: true, maxDailyChangePercent: 1 }); // 61 × 1.01 = 61.61: still 61
    await main(["pilota", "giro"], io(dir));
    expect(posts()).toEqual([]);
    expect(night(dir, "2026-11-02").held).toMatchObject({ calculated: 100, sent: 61, difference: -39 });
  });

  it("goes away when the channel catches up", async () => {
    const dir = await setUp(90);
    const t = io(dir);
    await main(["pilota", "giro"], t);
    expect(night(dir, SATURDAY).held).toMatchObject({ sent: 103 });
    t.setNow("2026-11-02T09:00:00Z");
    await main(["pilota", "giro"], t);
    expect(priceOn(SATURDAY)).toBe(110);
    expect(night(dir, SATURDAY, "2026-11-02").held).toBeUndefined();
  });

  it("a preview changes nothing the calendar shows", async () => {
    const dir = await setUp(80);
    await main(["pilota", "prova"], io(dir));
    expect(night(dir, SATURDAY).held).toBeUndefined();
  });

  it("says nothing with the autopilot off: nothing is being held back", async () => {
    const dir = await setUp(80);
    await main(["pilota", "giro"], io(dir));
    await main(["pilota", "spegni", "loft"], io(dir));
    expect(night(dir, SATURDAY).held).toBeUndefined();
  });

  it("with a cap other than 15 the numbers and the sentence follow it", async () => {
    const dir = await setUp(80, { enabled: true, maxDailyChangePercent: 5 }, "it");
    await main(["pilota", "giro"], io(dir));
    expect(priceOn(SATURDAY)).toBe(84);
    expect(night(dir, SATURDAY).held).toMatchObject({ calculated: 110, sent: 84, difference: -26, maxChange: 5 });
    expect(await priceLines(dir)).toContain("  Prezzo calcolato 110 €, prezzo mandato al canale 84 €, differenza 26 €. Il tetto lo muove del 5% al giorno.");
  });
});

describe("a night the host confirmed", () => {
  it("passes at its full price; the others stay under the cap", async () => {
    const dir = await setUp(80);
    await main(["pilota", "giro"], io(dir));
    const t = io(dir);
    expect(await main(["pilota", "conferma", "loft", "--da", SATURDAY], t)).toBe(0);
    expect(t.lines).toEqual(["1 night confirmed for loft: at the next run the calculated price passes in full."]);
    // Saved and visible before the run; the price has not moved yet.
    expect(night(dir, SATURDAY).confirmation).toMatchObject({ by: "anna", via: "command" });
    expect(night(dir, SATURDAY).held).toMatchObject({ sent: 92 });

    await main(["pilota", "giro"], io(dir));
    expect(priceOn(SATURDAY)).toBe(110);
    expect(priceOn(NEXT_SATURDAY)).toBe(105); // 92 × 1.15 = 105.8: the cap, as always
    expect(night(dir, SATURDAY).held).toBeUndefined();
    expect(night(dir, SATURDAY).confirmation).toBeDefined();
    expect(night(dir, NEXT_SATURDAY).held).toMatchObject({ calculated: 110, sent: 105 });
  });

  it("confirms a range of dates, both ends included", async () => {
    const dir = await setUp(80);
    const t = io(dir);
    await main(["pilota", "conferma", "loft", "--da", "2026-11-06", "--a", "2026-11-07"], t);
    expect(t.lines).toEqual(["2 nights confirmed for loft: at the next run the calculated prices pass in full."]);
    await main(["pilota", "giro"], io(dir));
    expect(priceOn("2026-11-05")).toBe(92);
    expect(priceOn("2026-11-06")).toBe(100);
    expect(priceOn("2026-11-07")).toBe(110);
    expect(priceOn("2026-11-08")).toBe(92);
  });

  it("is never automatic: runs and previews write no confirmation", async () => {
    const dir = await setUp(80);
    await main(["pilota", "giro"], io(dir));
    await main(["pilota", "prova"], io(dir));
    await main(["pilota", "giro"], io(dir));
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_confirmations").get()).toEqual({ n: 0 });
  });

  it("the log keeps who confirmed and when, also after the run", async () => {
    const dir = await setUp(80);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    const t = io(dir);
    await main(["pilota", "giro"], t);
    expect(t.lines).toContain("  2026-11-07 sat       80 →     110  min 2 → 2  sat +10% (full price, confirmed by anna)");

    expect(db(dir).prepare("SELECT new_price, target_price, limited, confirmed_by, confirmed_at FROM pilot_changes WHERE date = ?").get(SATURDAY)).toEqual({
      new_price: 110,
      target_price: 110,
      limited: null,
      confirmed_by: "anna",
      confirmed_at: NOW.replace("Z", ".000Z"),
    });
    const log = io(dir);
    await main(["pilota", "registro"], log);
    expect(log.lines).toContain("loft 2026-11-07: confirmed by anna on 2026-11-01 09:00");
    expect(log.lines.some((l) => l.includes("2026-11-07") && l.includes("(confirmed by anna, 2026-11-01 09:00)"))).toBe(true);
  });

  it("still stays inside the lowest and highest price", () => {
    const row = { date: SATURDAY, currentPrice: 100, currentMinStay: 2, newPrice: 300, newMinStay: 2 };
    const confirmed = new Map([[SATURDAY, { listing: "loft", date: SATURDAY, calculated: 300, by: "anna", via: "page", at: NOW, removedBy: null, removedAt: null }]]);
    const r = guardPlan([row], [], { floor: 60, ceiling: 260 }, 15, confirmed);
    expect(r.rows[0]?.newPrice).toBe(260);
    expect(r.nights[0]).toMatchObject({ limited: "ceiling", confirmation: { by: "anna" } });
    expect(r.held).toEqual([]);
  });

  it("only counts where it changes something: a night inside the cap is not marked as passed", async () => {
    const dir = await setUp(100);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    await main(["pilota", "giro"], io(dir));
    expect(db(dir).prepare("SELECT confirmed_by FROM pilot_changes WHERE date = ?").get(SATURDAY)).toEqual({ confirmed_by: null });
  });

  it("a second confirmation keeps the first one, in the log too", async () => {
    const dir = await setUp(80);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    const t = io(dir);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], t);
    expect(t.lines).toEqual(["No change: those nights were already confirmed."]);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_confirmations").get()).toEqual({ n: 1 });
  });

  it("refuses a night in the past, a backward range and a date that does not exist", async () => {
    const dir = await setUp(80);
    const t = io(dir);
    expect(await main(["pilota", "conferma", "loft", "--da", "2026-10-31"], t)).not.toBe(0);
    expect(await main(["pilota", "conferma", "loft", "--da", SATURDAY, "--a", "2026-11-06"], t)).not.toBe(0);
    expect(await main(["pilota", "conferma", "loft", "--da", "2026-02-30"], t)).not.toBe(0);
    expect(await main(["pilota", "conferma", "loft"], t)).not.toBe(0);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_confirmations").get()).toEqual({ n: 0 });
  });
});

describe("a confirmation that has ended", () => {
  it("expires by itself after the date of the night, and the cap is back", async () => {
    const dir = await setUp(80);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    const d = db(dir);
    expect(activeConfirmations(d, "loft", SATURDAY).has(SATURDAY)).toBe(true); // the night itself still counts
    const after = activeConfirmations(d, "loft", "2026-11-08");
    expect(after.has(SATURDAY)).toBe(false);

    // The same night with what is left of the confirmations: under the cap.
    const row = { date: SATURDAY, currentPrice: 80, currentMinStay: 2, newPrice: 110, newMinStay: 2 };
    expect(guardPlan([row], [], { floor: 60, ceiling: 260 }, 15, after).rows[0]?.newPrice).toBe(92);
    expect(guardPlan([row], [], { floor: 60, ceiling: 260 }, 15, activeConfirmations(d, "loft", SATURDAY)).rows[0]?.newPrice).toBe(110);

    const t = io(dir);
    t.setNow("2026-11-08T09:00:00Z");
    await main(["pilota", "conferme"], t);
    expect(t.lines).toEqual(["loft 2026-11-07: confirmed by anna on 2026-11-01 09:00 · ended"]);
  });

  it("a confirmation made for a later night does not leak to a run after it has passed", async () => {
    const dir = await setUp(80);
    confirmNights(db(dir), "loft", ["2026-11-02"], { by: "anna", via: "command" }, NOW, () => 100);
    const t = io(dir);
    t.setNow("2026-11-03T09:00:00Z");
    await runPilot(dir, t, { trigger: "manual", dryRun: false });
    expect(priceOn("2026-11-03")).toBe(92);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_changes WHERE confirmed_by IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("taken back by the host: the cap is back, the log keeps both", async () => {
    const dir = await setUp(80);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    const t = io(dir);
    await main(["pilota", "revoca", "loft", "--da", SATURDAY], t);
    expect(t.lines).toEqual(["1 confirmation removed for loft: the daily cap applies again."]);
    expect(night(dir, SATURDAY).confirmation).toBeUndefined();

    await main(["pilota", "giro"], io(dir));
    expect(priceOn(SATURDAY)).toBe(92);
    const history = io(dir);
    await main(["pilota", "conferme"], history);
    expect(history.lines).toEqual(["loft 2026-11-07: confirmed by anna on 2026-11-01 09:00 · removed by anna on 2026-11-01 09:00"]);
    // It can be confirmed again.
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    expect(night(dir, SATURDAY).confirmation).toBeDefined();
  });

  it("nightMarks shows a confirmation with the autopilot off too: it is saved, whatever the switch", async () => {
    const dir = await setUp(80);
    await main(["pilota", "conferma", "loft", "--da", SATURDAY], io(dir));
    await main(["pilota", "spegni", "loft"], io(dir));
    const listing = loadHostConfig(dir).listings[0];
    expect(nightMarks(db(dir), listing as never, TODAY, [{ date: SATURDAY, price: 110 }]).get(SATURDAY)?.confirmation).toMatchObject({ by: "anna" });
  });
});

describe("the page", () => {
  it("confirms and takes back from this computer, with the same header as the other switches", async () => {
    const dir = await setUp(80);
    const server = await startServer({ dir, io: io(dir), days: 30, port: 0, lan: false, quiet: true });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (what: string, body: object, headers: Record<string, string> = { "X-Fairnight": "1" }) =>
      fetch(`${base}/api/pilot/${what}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    try {
      expect((await post("confirm", { listing: "loft", from: SATURDAY }, {})).status).toBe(403);
      expect(await (await post("confirm", { listing: "loft", from: "2026-10-01" })).json()).toEqual({ error: "confirm_err_past" });
      expect(await (await post("confirm", { listing: "loft", from: SATURDAY, to: "nonsense" })).json()).toEqual({ error: "confirm_err_dates" });
      expect(await (await post("confirm", { listing: "loft", from: "2026-11-06", to: SATURDAY })).json()).toEqual({ ok: true, nights: 2 });
      expect(night(dir, SATURDAY).confirmation).toMatchObject({ by: "anna", via: "page" });
      expect(await (await post("unconfirm", { listing: "loft", from: "2026-11-06", to: SATURDAY })).json()).toEqual({ ok: true, nights: 2 });
      expect(night(dir, SATURDAY).confirmation).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("refuses a confirmation from another device of the network", async () => {
    const dir = await setUp(80);
    const sent: { status?: number; body?: string } = {};
    const res = { writeHead: (status: number) => (sent.status = status), end: (body: string) => (sent.body = body) } as unknown as ServerResponse;
    const req = { method: "POST", headers: { "x-fairnight": "1" }, socket: { remoteAddress: "192.168.1.20" } } as unknown as IncomingMessage;
    await handlePilot(req, res, new URL("http://x/api/pilot/confirm"), { dir, io: io(dir), previews: new Map(), busy: false });
    expect(sent.status).toBe(403);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_confirmations").get()).toEqual({ n: 0 });
  });
});
