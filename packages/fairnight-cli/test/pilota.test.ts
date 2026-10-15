import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeBeds24, TEST_REFRESH, type FakeBeds24 } from "../../fairnight-beds24/test/fake-beds24.js";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeSmoobu } from "../../fairnight-smoobu/test/fake-smoobu.js";
import { addDays } from "../src/channel.js";
import { validateHostConfig } from "../src/config.js";
import { openDb, setMeta } from "../src/db.js";
import { main } from "../src/main.js";
import { guardPrice, runPilot } from "../src/pilota.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

// 2026-11-01 is a Sunday. Everything here is invented: no real account is ever called.
const NOW = "2026-11-01T09:00:00Z";
const TODAY = "2026-11-01";
const ENV = { SMOOBU_API_KEY: TEST_CREDENTIALS.apiKey, SMOOBU_API_SECRET: TEST_CREDENTIALS.apiSecret };

/** One clock for the fake Smoobu (it checks request times) and the commands. */
let clock = new Date(NOW);
let smoobu: FakeSmoobu | null = null;
let beds24: FakeBeds24 | null = null;
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) if (d.open) d.close();
  await smoobu?.close();
  await beds24?.close();
  smoobu = null;
  beds24 = null;
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

/** The same price and minimum stay on every night of the next 120, as if the host set them by hand. */
function ratesAt(price: number) {
  const days: Record<string, { price: number | null; min_length_of_stay: number | null; available: number }> = {};
  for (let i = 0; i < 120; i++) days[addDays(TODAY, i)] = { price, min_length_of_stay: 2, available: 1 };
  return days;
}

interface ListingOptions {
  pilot?: object;
  pricing?: object;
  extraCalendars?: object[];
}

async function setUp(price: number, listing: ListingOptions = { pilot: { enabled: true } }, extra: object = {}) {
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
  const entry = {
    name: "loft",
    calendars: [{ source: "smoobu", apartmentId: 398 }, ...(listing.extraCalendars ?? [])],
    pricing: listing.pricing ?? LOFT,
    ...(listing.pilot ? { pilot: listing.pilot } : {}),
  };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [entry], ...extra }, null, 2));
  return dir;
}

function io(dir: string, extra: Partial<TestIo> = {}): TestIo {
  const base = testIo(dir, undefined, NOW);
  Object.assign(base, {
    env: ENV,
    smoobuBaseUrl: (smoobu as FakeSmoobu).baseUrl,
    smoobuFetch: (url: string, init: RequestInit) => fetch(url, init),
    sleep: async () => {},
    now: () => clock,
    setNow: (iso: string) => {
      clock = new Date(iso);
    },
    ...extra,
  });
  return base;
}

function db(dir: string) {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

const posts = () => (smoobu as FakeSmoobu).log.filter((r) => r.method === "POST");
const priceOn = (date: string) => (smoobu as FakeSmoobu).rates[398]?.[date]?.price;

describe("the safety rules of one night", () => {
  const limits = { floor: 60, ceiling: 260 };
  it("writes the engine's price when it is within 15% of the price on the channel", () => {
    expect(guardPrice(110, 100, limits, 15)).toEqual({ price: 110, limited: null });
    expect(guardPrice(86, 100, limits, 15)).toEqual({ price: 86, limited: null });
  });
  it("moves at most 15% a day, in whole amounts that never pass the cap", () => {
    expect(guardPrice(150, 100, limits, 15)).toEqual({ price: 115, limited: "cap" });
    expect(guardPrice(70, 100, limits, 15)).toEqual({ price: 85, limited: "cap" });
    expect(guardPrice(150, 99, limits, 15)).toEqual({ price: 113, limited: "cap" }); // 99 × 1.15 = 113.85
    expect(guardPrice(150, 100, limits, 20)).toEqual({ price: 120, limited: "cap" });
  });
  it("never goes under the lowest or over the highest price, even when the channel is far outside them", () => {
    expect(guardPrice(100, 30, limits, 15)).toEqual({ price: 60, limited: "floor" });
    expect(guardPrice(200, 400, limits, 15)).toEqual({ price: 260, limited: "ceiling" });
    expect(guardPrice(300, 260, limits, 15)).toEqual({ price: 260, limited: "ceiling" });
  });
  it("writes the engine's price directly when the channel has none, still inside the limits", () => {
    expect(guardPrice(130, null, limits, 15)).toEqual({ price: 130, limited: null });
    expect(guardPrice(20, null, limits, 15)).toEqual({ price: 60, limited: "floor" });
  });
  it("skips a price that is not a number", () => {
    expect(guardPrice(Number.NaN, 100, limits, 15)).toHaveProperty("skip");
    expect(guardPrice(0, 100, limits, 15)).toHaveProperty("skip");
  });
});

describe("a run of the autopilot (fake Smoobu)", () => {
  it("writes the nights that changed, reads them back and keeps each one with its reason", async () => {
    const dir = await setUp(100);
    const t = io(dir);
    expect(await main(["pilota", "giro"], t)).toBe(0);

    // Base 100, Saturdays +10%: only the Saturdays of the next 90 days change.
    const saturdays = Array.from({ length: 90 }, (_, i) => addDays(TODAY, i)).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6);
    expect(priceOn("2026-11-07")).toBe(110);
    expect(priceOn("2026-11-08")).toBe(100);
    expect(t.lines[0]).toBe(`loft: ${saturdays.length} nights written to Smoobu, read back: every night matches.`);
    expect(t.lines).toContain("  2026-11-07 sat      100 →     110  min 2 → 2  sat +10%");

    const d = db(dir);
    const run = d.prepare("SELECT trigger, outcome, written FROM pilot_runs").get();
    expect(run).toEqual({ trigger: "manual", outcome: "ok", written: saturdays.length });
    const rows = d.prepare("SELECT date, old_price, new_price, target_price, limited, verified, steps FROM pilot_changes ORDER BY date").all() as {
      date: string;
      steps: string;
    }[];
    expect(rows.map((r) => r.date)).toEqual(saturdays);
    expect(rows[0]).toMatchObject({ date: "2026-11-07", old_price: 100, new_price: 110, target_price: 110, limited: null, verified: 1 });
    expect(JSON.parse(rows[0]?.steps as string).map((s: { factor: string }) => s.factor)).toContain("dayOfWeek");
    // Nothing beyond the 90 nights.
    expect(priceOn(addDays(TODAY, 96))).toBe(100);
  });

  it("is off by default: it reads and prices, and writes nothing", async () => {
    const dir = await setUp(100, {});
    const t = io(dir);
    expect(await main(["pilota", "giro"], t)).toBe(0);
    expect(posts()).toEqual([]);
    expect(t.lines).toContain('loft: autopilot off (turn it on with "fairnight pilota accendi").');
  });

  it("gets to a far price over several days, 15% a day, and says so", async () => {
    const dir = await setUp(80);
    const t = io(dir);
    await main(["pilota", "giro"], t);
    expect(priceOn("2026-11-02")).toBe(92); // wants 100, 80 + 15% = 92
    expect(priceOn("2026-11-07")).toBe(92); // wants 110
    expect(t.lines).toContain("  2026-11-07 sat       80 →      92  min 2 → 2  sat +10% (held to 15% a day, the engine wants 110)");

    t.setNow("2026-11-02T09:00:00Z");
    await main(["pilota", "giro"], t);
    expect(priceOn("2026-11-03")).toBe(100); // 92 → 100 is within 15%
    expect(priceOn("2026-11-07")).toBe(105); // 92 × 1.15 = 105.8 → 105, still on its way to 110
  });

  it("uses the listing's own daily cap and number of nights", async () => {
    const dir = await setUp(80, { pilot: { enabled: true, maxDailyChangePercent: 5, days: 10 } });
    await main(["pilota", "giro"], io(dir));
    expect(priceOn("2026-11-02")).toBe(84);
    expect(priceOn("2026-11-10")).toBe(84);
    expect(priceOn("2026-11-11")).toBe(80); // the 11th night is not looked after
  });

  it("raises a price under the lowest one to the lowest, even past the daily cap", async () => {
    const dir = await setUp(40);
    await main(["pilota", "giro"], io(dir));
    expect(priceOn("2026-11-02")).toBe(60);
    expect(db(dir).prepare("SELECT limited FROM pilot_changes WHERE date = '2026-11-02'").get()).toEqual({ limited: "floor" });
  });

  it("writes nothing for a listing whose calendar could not be read today", async () => {
    const ical = "https://example.invalid/loft.ics";
    const dir = await setUp(100, { pilot: { enabled: true }, extraCalendars: [{ source: "airbnb", url: ical }] });
    const t = io(dir, { fetch: fakeFetch({ [ical]: new Error("network down") }) });
    expect(await main(["pilota", "giro"], t)).toBe(1);
    expect(posts()).toEqual([]);
    expect(t.lines.some((l) => l.startsWith("loft: NOT WRITTEN: a calendar could not be read today (airbnb:"))).toBe(true);
  });

  it("does not run without a lowest and a highest price", async () => {
    const dir = await setUp(100, { pilot: { enabled: true }, pricing: { ...LOFT, factors: { ...LOFT.factors, limits: { enabled: false, floorPrice: 60, ceilingPrice: 260 } } } });
    const t = io(dir);
    await main(["pilota", "giro"], t);
    expect(posts()).toEqual([]);
    expect(t.lines).toContain("loft: NOT WRITTEN: the autopilot needs a lowest and a highest price (factors.limits).");
  });

  it("the scheduled run happens once a day, and logs to data/pilota.log", async () => {
    const dir = await setUp(100);
    const t = io(dir);
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(0);
    const first = posts().length;
    expect(first).toBeGreaterThan(0);
    expect(await main(["pilota", "giro", "--pianificato"], t)).toBe(0);
    expect(t.lines.at(-1)).toBe("Today's autopilot run is already done.");
    expect(posts().length).toBe(first);
    const log = readFileSync(path.join(dir, "data", "pilota.log"), "utf8");
    expect(log).toContain("2026-11-01T09:00:00.000Z loft: 12 nights written to Smoobu");
    expect(log).toContain("Today's autopilot run is already done.");

    t.setNow("2026-11-02T06:00:00Z");
    await main(["pilota", "giro", "--pianificato"], t);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_runs").get()).toEqual({ n: 2 });
  });

  it("does not start while another run holds the lock, and takes it over once it expired", async () => {
    const dir = await setUp(100);
    setMeta(db(dir), "pilot_lock_until", "2026-11-01T09:20:00.000Z");
    const t = io(dir);
    await main(["pilota", "giro"], t);
    expect(t.lines).toEqual(["Another autopilot run is going on: nothing done."]);
    expect(posts()).toEqual([]);
    t.setNow("2026-11-01T09:21:00Z");
    await main(["pilota", "giro"], t);
    expect(posts().length).toBeGreaterThan(0);
    expect(db(dir).prepare("SELECT value FROM meta WHERE key = 'pilot_lock_until'").get()).toBeUndefined();
  });

  it("pauses after 3 failed runs in a row, and starts again only with riprendi", async () => {
    const dir = await setUp(100);
    // Smoobu refuses every price update.
    const refuse = (url: string, init: RequestInit) =>
      init.method === "POST" ? Promise.resolve(new Response(JSON.stringify({ title: "Error occurred", detail: "invented outage" }), { status: 500 })) : fetch(url, init);
    for (let day = 1; day <= 3; day++) {
      const t = io(dir, { smoobuFetch: refuse });
      t.setNow(`2026-11-0${day}T09:00:00Z`);
      expect(await main(["pilota", "giro"], t)).toBe(1);
      if (day === 3) expect(t.lines.some((l) => l.startsWith("  PAUSED now: 3 failed runs in a row"))).toBe(true);
    }
    const t = io(dir);
    t.setNow("2026-11-04T09:00:00Z");
    await main(["pilota", "giro"], t);
    expect(t.lines[0]).toMatch(/^loft: PAUSED: 3 failed runs in a row/);
    expect(posts().filter((r) => r.status === 200)).toEqual([]);

    await main(["pilota", "riprendi", "loft"], t);
    expect(t.lines.at(-1)).toBe("Autopilot of loft resumed: it runs again from the next run.");
    await main(["pilota", "giro"], t);
    expect(priceOn("2026-11-07")).toBe(110);
  });

  it("pauses at once when more than 5 nights do not match when read back", async () => {
    const dir = await setUp(100);
    // Smoobu says yes but keeps the old prices.
    const lie = (url: string, init: RequestInit) => (init.method === "POST" ? Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })) : fetch(url, init));
    const t = io(dir, { smoobuFetch: lie });
    expect(await main(["pilota", "giro"], t)).toBe(1);
    expect(t.lines[0]).toBe("loft: 12 nights written to Smoobu, 12 do not match, 0 refused.");
    expect(t.lines.some((l) => l.includes("✗ does not match on the channel"))).toBe(true);
    expect(t.lines.at(-1)).toBe('  PAUSED now: 12 nights did not match when read back. "fairnight pilota riprendi loft" starts it again.');
    expect(db(dir).prepare("SELECT outcome FROM pilot_runs").get()).toEqual({ outcome: "errors" });
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_changes WHERE verified = 0").get()).toEqual({ n: 12 });
  });

  it("a preview shows what it would write, also for a listing that is off, and writes and keeps nothing", async () => {
    const dir = await setUp(100, {});
    const t = io(dir);
    expect(await main(["pilota", "prova"], t)).toBe(0);
    expect(t.lines[0]).toBe("loft: would write 12 nights to Smoobu (preview: nothing written).");
    expect(t.lines.at(-1)).toBe("Preview: nothing was written.");
    expect(posts()).toEqual([]);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM pilot_runs").get()).toEqual({ n: 0 });
  });

  it("accendi shows the preview and asks; spegni turns it off; both keep the previous file", async () => {
    const dir = await setUp(100, {});
    const config = path.join(dir, "fairnight.config.json");
    const asked: string[] = [];
    let answer = "n";
    const t = io(dir, { prompt: async (q) => (asked.push(q), answer) });
    await main(["pilota", "accendi", "loft"], t);
    expect(t.lines).toContain("Every day Fairnight would write loft's next 90 nights to Smoobu, moving a price at most 15% a day, never under 60 or over 260.");
    expect(t.lines.at(-1)).toBe("Left off.");
    expect(JSON.parse(readFileSync(config, "utf8")).listings[0].pilot).toBeUndefined();

    answer = "s";
    await main(["pilota", "accendi", "loft"], t);
    expect(JSON.parse(readFileSync(config, "utf8")).listings[0].pilot).toEqual({ enabled: true });
    expect(existsSync(`${config}.bak`)).toBe(true);
    expect(posts()).toEqual([]);

    await main(["pilota", "spegni", "loft"], t);
    expect(JSON.parse(readFileSync(config, "utf8")).listings[0].pilot).toEqual({ enabled: false });
  });

  it("stato and registro tell what the autopilot did", async () => {
    const dir = await setUp(100);
    const t = io(dir);
    await main(["pilota", "giro"], t);
    t.lines.length = 0;
    await main(["pilota", "stato"], t);
    expect(t.lines[0]).toBe("loft → Smoobu: on · at most 15% a day · next 90 nights · between 60 and 260");
    expect(t.lines[1]).toMatch(/^Last run: 2026-11-01T09:00/);

    t.lines.length = 0;
    await main(["pilota", "registro"], t);
    expect(t.lines[0]).toBe("Run of 2026-11-01T09:00:00.000Z:");
    expect(t.lines[1]).toBe("  loft 2026-11-07  100 → 110  sat +10%");

    await main(["pilota", "registro", "--out", "registro.csv"], t);
    const csv = readFileSync(path.join(dir, "registro.csv"), "utf8").split("\n");
    expect(csv[0]).toBe("run,listing,channel,date,old_price,new_price,engine_price,old_min_stay,new_min_stay,held_back,read_back,reason");
    expect(csv[1]).toBe("2026-11-01T09:00:00.000Z,loft,smoobu,2026-11-07,100,110,110,2,2,,ok,sat +10%");
  });

  it("a listing with no channel manager is only priced", async () => {
    const dir = tempDir();
    await main(["init"], testIo(dir));
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [{ name: "flat", calendars: [], pricing: LOFT, pilot: { enabled: true } }] }));
    const t = testIo(dir, undefined, NOW);
    const r = await runPilot(dir, t, { trigger: "manual", dryRun: false });
    expect(r.listings[0]?.status).toBe("no-channel");
  });
});

describe("a run of the autopilot (fake Beds24)", () => {
  it("writes the price field of the room and reads it back", async () => {
    const clock = { now: Date.parse(NOW) };
    const calendar: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 120; i++) calendar[addDays(TODAY, i)] = { price1: 100, minStay: 2, numAvail: 1 };
    beds24 = await startFakeBeds24({
      inviteCode: "invite-code-0000-not-real",
      refreshToken: TEST_REFRESH,
      clock,
      properties: [{ id: 10, name: "Seaside House", currency: "EUR", rooms: [{ id: 101, name: "Loft", qty: 1 }] }],
      bookings: [],
      calendar: { 101: calendar },
      rangeEnd: "exclusive",
    });
    const dir = tempDir();
    await main(["init"], testIo(dir));
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [{ name: "loft", calendars: [{ source: "beds24", roomId: 101 }], pricing: LOFT, pilot: { enabled: true } }] }));
    const t = testIo(dir, undefined, NOW);
    Object.assign(t, {
      now: () => new Date(clock.now),
      env: { BEDS24_REFRESH_TOKEN: TEST_REFRESH },
      beds24BaseUrl: beds24.baseUrl,
      beds24Fetch: (url: string, init: RequestInit) => fetch(url, init),
      sleep: async (ms: number) => {
        clock.now += ms;
      },
    });
    expect(await main(["pilota", "giro"], t)).toBe(0);
    expect(t.lines[0]).toBe("loft: 12 nights written to Beds24, read back: every night matches.");
    expect(beds24.calendar[101]?.["2026-11-07"]?.price1).toBe(110);
    expect(beds24.calendar[101]?.["2026-11-08"]?.price1).toBe(100);
  });
});

describe("the autopilot in fairnight.config.json", () => {
  const listing = (pilot: unknown) => ({ name: "loft", calendars: [], pricing: LOFT, pilot });
  it("accepts the switch, the daily cap, the nights and the time", () => {
    const r = validateHostConfig({ listings: [listing({ enabled: true, maxDailyChangePercent: 20, days: 120 })], pilot: { time: "07:30" } });
    expect(r.ok && r.value.listings[0]?.pilot).toEqual({ enabled: true, maxDailyChangePercent: 20, days: 120 });
    expect(r.ok && r.value.pilot).toEqual({ time: "07:30" });
  });
  it("says what is wrong", () => {
    const r = validateHostConfig({ listings: [listing({ enabled: "yes", maxDailyChangePercent: 80, days: 3, speed: 1 })], pilot: { time: "25:00" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.path)).toEqual([
      "config.pilot.time",
      "listings[0].pilot.speed",
      "listings[0].pilot.enabled",
      "listings[0].pilot.maxDailyChangePercent",
      "listings[0].pilot.days",
    ]);
  });
});
