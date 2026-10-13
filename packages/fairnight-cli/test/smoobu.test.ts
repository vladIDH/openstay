import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeBooking, type FakeSmoobu } from "../../fairnight-smoobu/test/fake-smoobu.js";
import { loadCredentials, saveCredentials } from "../src/credentials.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

const NOW = "2026-11-01T09:00:00Z";
const ENV = { SMOOBU_API_KEY: TEST_CREDENTIALS.apiKey, SMOOBU_API_SECRET: TEST_CREDENTIALS.apiSecret };

let fake: FakeSmoobu | null = null;
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) if (db.open) db.close();
  await fake?.close();
  fake = null;
});

function booking(id: number, apartment: number, arrival: string, departure: string, extra: Partial<FakeBooking> = {}): FakeBooking {
  return {
    id,
    type: "reservation",
    arrival,
    departure,
    "created-at": "2026-10-20 14:03",
    apartment: { id: apartment, name: "x" },
    channel: { id: 465614, name: "Booking.com" },
    "guest-name": "Invented Guest",
    price: 400,
    "is-blocked-booking": false,
    ...extra,
  };
}

const LOFT_PRICING = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: {
    limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 },
    dayOfWeek: { enabled: true, adjustments: { sat: 10 } },
    rounding: { enabled: true, step: 1 },
  },
};

async function setUp(bookings: FakeBooking[], options: { rangeEnd?: "inclusive" | "exclusive"; pricing?: object } = {}) {
  fake = await startFakeSmoobu({
    ...TEST_CREDENTIALS,
    now: () => new Date(NOW),
    apartments: [
      { id: 398, name: "Seaside Loft", currency: "EUR", minimal: "80.00", maximal: "180.00" },
      { id: 401, name: "Garden Studio", currency: "EUR", minimal: "50.00", maximal: "120.00" },
    ],
    bookings,
    ...(options.rangeEnd ? { rangeEnd: options.rangeEnd } : {}),
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const configFile = path.join(dir, "fairnight.config.json");
  writeFileSync(
    configFile,
    JSON.stringify({ listings: [{ name: "loft", calendars: [{ source: "smoobu", apartmentId: 398 }], pricing: options.pricing ?? LOFT_PRICING }] }, null, 2),
  );
  return { dir, configFile, fake };
}

function io(dir: string, extra: Partial<TestIo> = {}): TestIo {
  const base = testIo(dir, undefined, NOW);
  Object.assign(base, {
    env: ENV,
    smoobuBaseUrl: (fake as FakeSmoobu).baseUrl,
    smoobuFetch: (url: string, init: RequestInit) => fetch(url, init),
    sleep: async () => {},
    ...extra,
  });
  return base;
}

function db(dir: string) {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

const noSecrets = (t: TestIo) => {
  const all = [...t.lines, ...t.errors].join("\n");
  expect(all).not.toContain(TEST_CREDENTIALS.apiKey);
  expect(all).not.toContain(TEST_CREDENTIALS.apiSecret);
};

describe("fairnight smoobu collega", () => {
  it("asks for key and secret without echo, checks them on Smoobu, and saves them for this user only", async () => {
    const { dir } = await setUp([]);
    const asked: { q: string; hidden: boolean }[] = [];
    const answers = [TEST_CREDENTIALS.apiKey, TEST_CREDENTIALS.apiSecret];
    const t = io(dir, { env: {}, prompt: async (q, o) => (asked.push({ q, hidden: o.hidden }), answers.shift() as string) });
    expect(await main(["smoobu", "collega"], t)).toBe(0);
    expect(asked).toEqual([
      { q: "Smoobu API key: ", hidden: true },
      { q: "Smoobu API secret: ", hidden: true },
    ]);
    expect(t.lines).toContain("Connected to Smoobu: 2 apartments found.");
    const file = path.join(dir, "smoobu-credentials.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(TEST_CREDENTIALS);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    noSecrets(t);
  });

  it("saves nothing when Smoobu refuses the key, and never prints it", async () => {
    const { dir } = await setUp([]);
    const answers = [TEST_CREDENTIALS.apiKey, "wrong-secret-not-real"];
    const t = io(dir, { env: {}, prompt: async () => answers.shift() as string });
    expect(await main(["smoobu", "collega"], t)).toBe(1);
    expect(t.errors[0]).toMatch(/^Smoobu refused the request \(401\).*Nothing was saved\.$/);
    expect(existsSync(path.join(dir, "smoobu-credentials.json"))).toBe(false);
    expect(t.errors.join("\n")).not.toContain("wrong-secret-not-real");
    noSecrets(t);
  });

  it("refuses empty answers, cancellation and a folder without config", async () => {
    const { dir } = await setUp([]);
    const empty = io(dir, { prompt: async () => "  " });
    expect(await main(["smoobu", "collega"], empty)).toBe(1);
    expect(empty.errors[0]).toBe("The key or the secret was empty: nothing was saved.");
    const cancelled = io(dir, {
      prompt: async () => {
        throw new Error("Ctrl+C");
      },
    });
    expect(await main(["smoobu", "collega"], cancelled)).toBe(1);
    expect(cancelled.errors[0]).toBe("Cancelled: nothing was saved.");
    const bare = tempDir();
    expect(await main(["smoobu", "collega"], io(bare, { prompt: async () => "x" }))).toBe(1);
  });
});

describe("credentials", () => {
  it("prefers SMOOBU_API_KEY and SMOOBU_API_SECRET, then the saved file", () => {
    const dir = tempDir();
    saveCredentials(dir, { apiKey: "file-key-not-real", apiSecret: "file-secret-not-real" });
    expect(loadCredentials(dir, ENV)).toEqual({ credentials: TEST_CREDENTIALS, source: "environment" });
    expect(loadCredentials(dir, {})).toEqual({ credentials: { apiKey: "file-key-not-real", apiSecret: "file-secret-not-real" }, source: "file" });
    expect(() => loadCredentials(dir, { SMOOBU_API_KEY: "only-one" })).toThrow("Only one of SMOOBU_API_KEY and SMOOBU_API_SECRET is set");
  });

  it("explains a missing, broken or incomplete file without showing its content", () => {
    const dir = tempDir();
    expect(() => loadCredentials(dir, {})).toThrow('No Smoobu credentials yet: run "fairnight smoobu collega"');
    writeFileSync(path.join(dir, "smoobu-credentials.json"), "{ not json secret-value-x");
    expect(() => loadCredentials(dir, {})).toThrow(/cannot be read/);
    expect(() => loadCredentials(dir, {})).not.toThrow(/secret-value-x/);
    writeFileSync(path.join(dir, "smoobu-credentials.json"), JSON.stringify({ apiKey: "k" }));
    expect(() => loadCredentials(dir, {})).toThrow(/is incomplete/);
  });
});

describe("fairnight smoobu importa", () => {
  const BOOKINGS = [
    booking(1, 398, "2026-11-04", "2026-11-08", { "created-at": "2026-09-01 10:00", price: 400 }),
    booking(2, 398, "2026-12-01", "2026-12-05", { "is-blocked-booking": true, price: 0, "created-at": "2026-10-30 10:00" }),
    booking(3, 398, "2026-11-20", "2026-11-22", { type: "cancellation" }),
    booking(4, 401, "2026-11-10", "2026-11-12", { price: 150 }),
    booking(5, 398, "2025-11-10", "2025-11-15", { price: 600, "created-at": "2025-10-01 09:00" }),
  ];

  it("adds a listing for each new Smoobu apartment and imports the bookings", async () => {
    const { dir, configFile } = await setUp(BOOKINGS);
    const t = io(dir);
    expect(await main(["smoobu", "importa"], t)).toBe(0);
    expect(t.lines).toEqual([
      'Added listing "garden-studio" for Smoobu apartment 401 (Garden Studio): base price 85 EUR, from the prices set in Smoobu. Check its rules in fairnight.config.json.',
      "The previous config is kept as fairnight.config.json.bak.",
      "loft · smoobu: 3 bookings · 3 new · 0 changed · 0 removed · 0 back",
      "garden-studio · smoobu: 1 bookings · 1 new · 0 changed · 0 removed · 0 back",
    ]);
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    expect(config.listings[1]).toEqual({
      name: "garden-studio",
      calendars: [{ source: "smoobu", apartmentId: 401 }],
      pricing: {
        name: "Garden Studio",
        currency: "EUR",
        basePrice: 85,
        defaultMinStay: 2,
        factors: { limits: { enabled: true, floorPrice: 50, ceilingPrice: 120 }, rounding: { enabled: true, step: 1 } },
      },
    });
    expect(existsSync(`${configFile}.bak`)).toBe(true);

    const d = db(dir);
    expect(d.prepare("SELECT listing, uid, check_in, check_out, kind, booked_at FROM calendar_events ORDER BY listing, check_in").all()).toEqual([
      { listing: "garden-studio", uid: "4", check_in: "2026-11-10", check_out: "2026-11-12", kind: "reservation", booked_at: "2026-10-20" },
      { listing: "loft", uid: "5", check_in: "2025-11-10", check_out: "2025-11-15", kind: "reservation", booked_at: "2025-10-01" },
      { listing: "loft", uid: "1", check_in: "2026-11-04", check_out: "2026-11-08", kind: "reservation", booked_at: "2026-09-01" },
      { listing: "loft", uid: "2", check_in: "2026-12-01", check_out: "2026-12-05", kind: "blocked", booked_at: null },
    ]);
    // Blocked dates and cancellations never get a stay price.
    expect(d.prepare("SELECT listing, uid, nights, total, per_night FROM smoobu_stays ORDER BY uid").all()).toEqual([
      { listing: "loft", uid: "1", nights: 4, total: 400, per_night: 100 },
      { listing: "garden-studio", uid: "4", nights: 2, total: 150, per_night: 75 },
      { listing: "loft", uid: "5", nights: 5, total: 600, per_night: 120 },
    ]);
    noSecrets(t);

    const again = io(dir);
    expect(await main(["smoobu", "importa"], again)).toBe(0);
    expect(again.lines).toEqual([
      "loft · smoobu: 3 bookings · 0 new · 0 changed · 0 removed · 0 back",
      "garden-studio · smoobu: 1 bookings · 0 new · 0 changed · 0 removed · 0 back",
    ]);
  });

  it("is read by fairnight sync too: a cancelled booking is marked removed, not deleted", async () => {
    const { dir, fake } = await setUp(BOOKINGS);
    await main(["smoobu", "importa"], io(dir));
    const first = fake.log.length;
    (BOOKINGS[0] as FakeBooking).type = "cancellation";
    try {
      const t = io(dir);
      expect(await main(["sync"], t)).toBe(0);
      expect(t.lines).toContain("loft · smoobu: 2 bookings · 0 new · 0 changed · 1 removed · 0 back");
      expect(fake.log.length).toBeGreaterThan(first);
      const row = db(dir).prepare("SELECT removed_at FROM calendar_events WHERE uid = '1'").get() as { removed_at: string | null };
      expect(row.removed_at).toBe("2026-11-01T09:00:00.000Z");
      expect(db(dir).prepare("SELECT COUNT(*) AS n FROM smoobu_stays WHERE uid = '1'").get()).toEqual({ n: 0 });
    } finally {
      (BOOKINGS[0] as FakeBooking).type = "reservation";
    }
  });

  it("sync explains missing credentials and keeps going with the iCal calendars", async () => {
    const { dir } = await setUp(BOOKINGS);
    const t = io(dir, { env: {} });
    expect(await main(["sync"], t)).toBe(1);
    expect(t.lines).toEqual([
      'loft · smoobu: NOT READ — No Smoobu credentials yet: run "fairnight smoobu collega" (or set SMOOBU_API_KEY and SMOOBU_API_SECRET). Nothing was changed for Smoobu.',
    ]);
  });

  it("changes nothing when Smoobu cannot be read", async () => {
    const { dir, fake } = await setUp(BOOKINGS);
    await main(["smoobu", "importa"], io(dir));
    fake.forceNext({ status: 401, body: { status: 401, title: "Unauthorized", detail: "Authentication required" } });
    const t = io(dir);
    expect(await main(["sync"], t)).toBe(1);
    expect(t.lines[0]).toMatch(/^loft · smoobu: NOT READ — Smoobu refused the request \(401\)/);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE removed_at IS NOT NULL").get()).toEqual({ n: 0 });
  });
});

describe("prices from Smoobu data", () => {
  it("uses the real booking day for the stale-calendar discount", async () => {
    const pricing = { ...LOFT_PRICING, factors: { ...LOFT_PRICING.factors, staleCalendar: { enabled: true, afterDays: 14, stepPercent: 5, maxPercent: 10 } } };
    const { dir } = await setUp([booking(1, 398, "2026-11-20", "2026-11-23", { "created-at": "2026-10-01 10:00" })], { pricing });
    await main(["smoobu", "importa"], io(dir));
    const t = io(dir);
    await main(["price", "--listing", "loft", "--days", "1", "--today", "2026-11-02", "--explain"], t);
    // Imported today, but booked on 1 October: 32 days without new bookings.
    expect(t.lines[1]).toContain("no new bookings -10% = 90 (32 days since the last new booking)");
  });

  it("feeds Smoobu stay prices to the historical floor only with --usa-storico-smoobu", async () => {
    const pricing = {
      ...LOFT_PRICING,
      factors: { ...LOFT_PRICING.factors, dayOfWeek: { enabled: true, adjustments: { mon: -30 } }, historicalFloor: { enabled: true, percent: 90, minNights: 3 } },
    };
    const { dir } = await setUp([booking(5, 398, "2025-11-10", "2025-11-15", { price: 600, "created-at": "2025-10-01 09:00" })], { pricing });
    await main(["smoobu", "importa"], io(dir));
    const without = io(dir);
    await main(["price", "--listing", "loft", "--days", "1", "--today", "2026-11-02"], without);
    expect(without.lines[2]?.startsWith("2026-11-02  mon       70")).toBe(true);
    const withHistory = io(dir);
    await main(["price", "--listing", "loft", "--days", "1", "--today", "2026-11-02", "--explain", "--usa-storico-smoobu"], withHistory);
    // 600 over 5 nights = 120 per night, an average per STAY; 90% = 108.
    expect(withHistory.lines[1]).toContain("historical floor = 108 (90% of the 2025-11 average of 120 over 5 sold nights)");
  });

  it("keeps Smoobu blocked dates out of occupancy and out of the booking dates", async () => {
    const pricing = {
      ...LOFT_PRICING,
      factors: {
        ...LOFT_PRICING.factors,
        occupancy: { enabled: true, highThresholdPercent: 50, raisePercent: 10, lowThresholdPercent: 10, lowerPercent: 5 },
        staleCalendar: { enabled: true, afterDays: 10, stepPercent: 5, maxPercent: 5 },
      },
    };
    const { dir } = await setUp(
      [
        booking(1, 398, "2026-11-02", "2026-11-28", { "is-blocked-booking": true, "created-at": "2026-10-31 10:00" }),
        booking(2, 398, "2026-11-28", "2026-11-29", { "created-at": "2026-10-01 10:00" }),
      ],
      { pricing },
    );
    await main(["smoobu", "importa"], io(dir));
    const t = io(dir);
    await main(["price", "--listing", "loft", "--days", "30", "--today", "2026-11-01", "--json"], t);
    const nights = JSON.parse(t.lines.join("\n"))[0].nights as { date: string; status: string; steps: { factor: string; note?: string }[] }[];
    expect(nights.find((n) => n.date === "2026-11-10")?.status).toBe("blocked");
    const free = nights.find((n) => n.date === "2026-11-29");
    // Sellable from today: 1, 28, 29, 30 November; 1 reserved → 25%, not 96%.
    expect(free?.steps.some((s) => s.factor === "occupancy")).toBe(false);
    // The block "created" on 31 October does not count as a booking: last booking 1 October.
    expect(free?.steps.find((s) => s.factor === "staleCalendar")?.note).toBe("31 days since the last new booking");
  });
});

describe("fairnight smoobu spingi", () => {
  const today = [booking(1, 398, "2026-11-04", "2026-11-06")];

  it("shows the differences and writes nothing without --applica", async () => {
    const { dir, fake } = await setUp(today);
    await main(["smoobu", "importa"], io(dir));
    fake.rates[398] = {
      "2026-11-01": { price: 100, min_length_of_stay: 2, available: 1 },
      "2026-11-02": { price: 120, min_length_of_stay: 3, available: 1 },
      "2026-11-03": { price: 100, min_length_of_stay: 2, available: 0 },
    };
    const before = fake.log.filter((r) => r.method === "POST").length;
    const t = io(dir);
    expect(await main(["smoobu", "spingi", "--alloggio", "398", "--da", "2026-11-01", "--a", "2026-11-08"], t)).toBe(0);
    expect(t.lines).toEqual([
      "loft → Smoobu apartment 398 · 2026-11-01 → 2026-11-08 · prices in EUR",
      "date        day   on Smoobu   Fairnight  min stay",
      "2026-11-02  mon         120         100  3 → 2",
      "2026-11-06  fri           —         100  — → 2",
      "2026-11-07  sat           —         110  — → 2",
      "2026-11-08  sun           —         100  — → 2",
      '4 nights to change · 1 already right · 1 free here but unavailable on Smoobu, left alone (run "fairnight smoobu importa")',
      "",
      "Dry run: nothing was written to Smoobu. Add --applica to write these 4 nights.",
    ]);
    expect(fake.log.filter((r) => r.method === "POST").length).toBe(before);
    noSecrets(t);
  });

  it("with --applica, checks once how Smoobu reads a range, then writes and reads back", async () => {
    const { dir, fake } = await setUp(today, { rangeEnd: "exclusive" });
    await main(["smoobu", "importa"], io(dir));
    const t = io(dir);
    expect(await main(["smoobu", "spingi", "--alloggio", "398", "--da", "2026-11-07", "--a", "2026-11-12", "--applica"], t)).toBe(0);
    expect(t.lines).toContain(
      "Checked once how Smoobu reads a date range (2026-11-08:2026-11-09): the last day is NOT written. Fairnight keeps writing one night per operation.",
    );
    expect(t.lines).toContain("Written to Smoobu: 6 nights in 6 operations.");
    expect(t.lines).toContain("Read back from Smoobu: every night matches.");
    const posts = fake.log.filter((r) => r.method === "POST").map((r) => JSON.parse(r.body).operations.map((o: { dates: string[] }) => o.dates[0]));
    // The check wrote 8 November only (the range end is excluded), so 9 November is written again on its own.
    expect(posts).toEqual([["2026-11-08:2026-11-09"], ["2026-11-07", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]]);
    expect(fake.rates[398]?.["2026-11-07"]).toEqual({ price: 110, min_length_of_stay: 2, available: 1 });

    // Next time the check is not repeated, and nothing is left to write.
    const again = io(dir);
    await main(["smoobu", "spingi", "--alloggio", "398", "--da", "2026-11-07", "--a", "2026-11-12", "--applica"], again);
    expect(again.lines.some((l) => l.startsWith("Checked once"))).toBe(false);
    expect(again.lines).toContain("0 nights to change · 6 already right");
    const d = db(dir);
    expect(d.prepare("SELECT value FROM meta WHERE key = 'smoobu_range_end'").get()).toEqual({ value: "exclusive" });
    expect(d.prepare("SELECT nights, operations, mismatches, error FROM smoobu_pushes").all()).toEqual([{ nights: 6, operations: 6, mismatches: 0, error: null }]);
  });

  it("groups equal nights into ranges of at most 7 once Smoobu is known to include the last day", async () => {
    const { dir, fake } = await setUp([], { rangeEnd: "inclusive" });
    await main(["smoobu", "importa"], io(dir));
    const t = io(dir);
    expect(await main(["smoobu", "spingi", "--alloggio", "398", "--da", "2026-11-09", "--a", "2026-11-27", "--applica"], t)).toBe(0);
    expect(t.lines).toContain(
      "Checked once how Smoobu reads a date range (2026-11-09:2026-11-10): the last day IS written. From now on, runs of equal nights go in ranges of up to 7.",
    );
    const ops = fake.log.filter((r) => r.method === "POST").flatMap((r) => JSON.parse(r.body).operations.map((o: { dates: string[] }) => o.dates[0]));
    expect(ops).toEqual([
      "2026-11-09:2026-11-10",
      "2026-11-11:2026-11-13",
      "2026-11-14",
      "2026-11-15:2026-11-20",
      "2026-11-21",
      "2026-11-22:2026-11-27",
    ]);
    expect(t.lines).toContain("Read back from Smoobu: every night matches.");
  });

  it("stops and explains when Smoobu refuses a write, and records it", async () => {
    const { dir, fake } = await setUp([], { rangeEnd: "inclusive" });
    await main(["smoobu", "importa"], io(dir));
    fake.forceNext({ status: 200, body: { data: {} } }, { status: 500, body: { title: "Error occurred", detail: "Price is required" } });
    const t = io(dir);
    expect(await main(["smoobu", "spingi", "--alloggio", "398", "--da", "2026-11-09", "--a", "2026-11-10", "--applica"], t)).toBe(1);
    expect(t.lines).toContain('Stopped: Smoobu answered 500 for /api/rates. Smoobu says: "Price is required".');
    expect(db(dir).prepare("SELECT error FROM smoobu_pushes").get()).toEqual({ error: 'Smoobu answered 500 for /api/rates. Smoobu says: "Price is required".' });
  });

  it("checks its options and the links to Smoobu", async () => {
    const { dir } = await setUp([]);
    const cases: [string[], number, string][] = [
      [["smoobu", "spingi", "--da", "2026-10-01"], 1, "--da 2026-10-01 is in the past: Fairnight prices nights from today (2026-11-01)."],
      [["smoobu", "spingi", "--da", "2026-11-05", "--a", "2026-11-01"], 1, "--a 2026-11-01 is before --da 2026-11-05."],
      [["smoobu", "spingi", "--a", "2028-01-01"], 1, "Push at most 366 days from today."],
      [["smoobu", "spingi", "--da", "5/11/2026"], 2, '--da must be a date like 2026-11-01, got "5/11/2026"'],
      [["smoobu", "spingi", "--alloggio", "abc"], 2, '--alloggio must be a Smoobu apartment number, got "abc"'],
      [["smoobu", "spingi", "--alloggio", "999"], 1, 'No listing is linked to Smoobu apartment 999. Run "fairnight smoobu importa" first.'],
      [["smoobu", "rubbish"], 2, 'Unknown Smoobu command "rubbish". Use collega, importa or spingi.'],
      [["smoobu"], 2, "Which Smoobu command? collega, importa or spingi."],
    ];
    for (const [args, code, message] of cases) {
      const t = io(dir);
      expect(await main(args, t)).toBe(code);
      expect(t.errors[0]).toBe(message);
    }
  });
});

describe("config", () => {
  it("accepts one Smoobu apartment per listing, never shared", async () => {
    const { dir, configFile } = await setUp([]);
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    config.listings.push({ name: "twin", calendars: [{ source: "smoobu", apartmentId: 398 }, { source: "smoobu", apartmentId: 0, url: "x" }], pricing: LOFT_PRICING });
    writeFileSync(configFile, JSON.stringify(config));
    const t = io(dir);
    expect(await main(["price"], t)).toBe(1);
    expect(t.errors).toEqual([
      "Invalid fairnight.config.json:",
      "  - listings[1].calendars[1].url: unknown field (allowed: source, apartmentId)",
      "  - listings[1].calendars[1].apartmentId: must be the number of the Smoobu apartment, got 0",
      "  - listings[1].calendars[1]: a listing can be linked to one channel manager only (one Smoobu apartment or one Beds24 room)",
    ]);
  });
});
