import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeBeds24, TEST_INVITE, TEST_REFRESH, type FakeBeds24, type FakeBooking } from "../../fairnight-beds24/test/fake-beds24.js";
import { loadBeds24Credentials, saveBeds24Credentials } from "../src/beds24-credentials.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

const T0 = Date.parse("2026-11-01T09:00:00Z");
let fake: FakeBeds24 | null = null;
let clock = { now: T0 };
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) if (db.open) db.close();
  await fake?.close();
  fake = null;
});

function booking(id: number, roomId: number, arrival: string, departure: string, extra: Partial<FakeBooking> = {}): FakeBooking {
  return { id, propertyId: 10, roomId, status: "confirmed", arrival, departure, bookingTime: "2026-10-20T14:03:00Z", price: 400, firstName: "Invented", lastName: "Guest", ...extra };
}

const LOFT = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 }, dayOfWeek: { enabled: true, adjustments: { sat: 10 } }, rounding: { enabled: true, step: 1 } },
};

async function setUp(bookings: FakeBooking[], options: { rangeEnd?: "inclusive" | "exclusive"; pricing?: object; link?: object; refuseDates?: string[]; withFile?: boolean } = {}) {
  clock = { now: T0 };
  fake = await startFakeBeds24({
    inviteCode: TEST_INVITE,
    refreshToken: TEST_REFRESH,
    clock,
    properties: [
      { id: 10, name: "Seaside House", currency: "EUR", rooms: [{ id: 101, name: "Loft", qty: 1 }, { id: 102, name: "Dorm", qty: 4 }] },
      { id: 20, name: "Garden", currency: "EUR", rooms: [{ id: 201, name: "Studio", qty: 1, rackRate: 85, minPrice: 50 }] },
    ],
    bookings,
    ...(options.rangeEnd ? { rangeEnd: options.rangeEnd } : {}),
    ...(options.refuseDates ? { refuseDates: options.refuseDates } : {}),
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify({ listings: [{ name: "loft", calendars: [{ source: "beds24", roomId: 101, ...(options.link ?? {}) }], pricing: options.pricing ?? LOFT }] }, null, 2),
  );
  return { dir, fake };
}

function io(dir: string, extra: Partial<TestIo> = {}): TestIo {
  const base = testIo(dir, undefined, new Date(clock.now).toISOString());
  Object.assign(base, {
    now: () => new Date(clock.now),
    env: { BEDS24_REFRESH_TOKEN: TEST_REFRESH },
    beds24BaseUrl: (fake as FakeBeds24).baseUrl,
    beds24Fetch: (url: string, init: RequestInit) => fetch(url, init),
    sleep: async (ms: number) => {
      clock.now += ms;
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

/** No invite code, refresh token or short token ever shows up in what the user sees. */
function noSecrets(t: TestIo) {
  const all = [...t.lines, ...t.errors].join("\n");
  expect(all).not.toContain(TEST_INVITE);
  expect(all).not.toContain(TEST_REFRESH);
  for (const r of (fake as FakeBeds24).log) {
    const token = r.headers.token;
    if (typeof token === "string") expect(all).not.toContain(token);
  }
}

describe("fairnight beds24 collega", () => {
  it("exchanges the invite code (asked without echo) for a refresh token saved for this user only", async () => {
    const { dir } = await setUp([]);
    const asked: { q: string; hidden: boolean }[] = [];
    const t = io(dir, { env: {}, prompt: async (q, o) => (asked.push({ q, hidden: o.hidden }), TEST_INVITE) });
    expect(await main(["beds24", "collega"], t)).toBe(0);
    expect(asked).toEqual([{ q: "Beds24 invite code: ", hidden: true }]);
    expect(t.lines).toContain("Connected to Beds24: 3 rooms found.");
    expect(t.lines).toContain("Choose these permissions now, they cannot be changed later: read:bookings, all:inventory, read:properties.");
    expect(t.lines.at(-2)).toMatch(/^Beds24 credits: 2 used in this run · 98 left of 100 in this 5-minute window\.$/);
    const file = path.join(dir, "beds24-credentials.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.refreshToken).toBe(TEST_REFRESH);
    expect(saved.cachedToken.expiresAt).toBe("2026-11-01T10:00:00.000Z");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    noSecrets(t);
  });

  it("saves nothing for a refused or empty code, and never prints it", async () => {
    const { dir } = await setUp([]);
    const wrong = io(dir, { env: {}, prompt: async () => "wrong-invite-not-real" });
    expect(await main(["beds24", "collega"], wrong)).toBe(1);
    expect(wrong.errors[0]).toBe(
      'Beds24 did not accept the invite code (400): "Invalid code". Invite codes work once and only for 24 hours: create a new one in Beds24. Nothing was saved.',
    );
    expect(wrong.errors.join("\n")).not.toContain("wrong-invite-not-real");
    expect(existsSync(path.join(dir, "beds24-credentials.json"))).toBe(false);
    const empty = io(dir, { prompt: async () => " " });
    expect(await main(["beds24", "collega"], empty)).toBe(1);
    expect(empty.errors[0]).toBe("The invite code was empty: nothing was saved.");
  });
});

describe("Beds24 credentials", () => {
  it("prefers BEDS24_REFRESH_TOKEN, and reuses a saved short token only with its own refresh token", () => {
    const dir = tempDir();
    expect(() => loadBeds24Credentials(dir, {})).toThrow('No Beds24 credentials yet: run "fairnight beds24 collega" (or set BEDS24_REFRESH_TOKEN).');
    saveBeds24Credentials(dir, "file-refresh-not-real", { token: "t1", expiresAt: "2026-11-01T10:00:00.000Z" });
    expect(loadBeds24Credentials(dir, {})).toEqual({ refreshToken: "file-refresh-not-real", source: "file", cachedToken: { token: "t1", expiresAt: "2026-11-01T10:00:00.000Z" } });
    expect(loadBeds24Credentials(dir, { BEDS24_REFRESH_TOKEN: "env-refresh-not-real" })).toEqual({ refreshToken: "env-refresh-not-real", source: "environment", cachedToken: null });
    writeFileSync(path.join(dir, "beds24-credentials.json"), "{ broken");
    expect(() => loadBeds24Credentials(dir, {})).toThrow(/cannot be read/);
  });
});

describe("fairnight beds24 importa", () => {
  const BOOKINGS = [
    booking(1, 101, "2026-11-04", "2026-11-08", { bookingTime: "2026-09-01T10:00:00Z" }),
    booking(2, 101, "2026-11-10", "2026-11-12", { status: "new", price: 260 }),
    booking(3, 101, "2026-11-14", "2026-11-15", { status: "request", price: 120 }),
    booking(4, 101, "2026-12-01", "2026-12-05", { status: "black", price: 0 }),
    booking(5, 101, "2026-11-20", "2026-11-22", { status: "cancelled" }),
    booking(6, 101, "2026-11-24", "2026-11-26", { status: "inquiry" }),
    booking(7, 201, "2026-11-10", "2026-11-12", { price: 150 }),
  ];

  it("adds a listing for each new room, a room type with several units at one price, and imports bookings", async () => {
    const { dir } = await setUp(BOOKINGS);
    const t = io(dir);
    expect(await main(["beds24", "importa"], t)).toBe(0);
    expect(t.lines).toEqual([
      'Added listing "dorm" for Beds24 room 102 (Seaside House · Dorm, 4 identical units at one price): base price 100 EUR, from the prices set in Beds24. Check its rules in fairnight.config.json.',
      'Added listing "studio" for Beds24 room 201 (Garden · Studio): base price 85 EUR, from the prices set in Beds24. Check its rules in fairnight.config.json.',
      "The previous config is kept as fairnight.config.json.bak.",
      "loft · beds24: 4 bookings · 4 new · 0 changed · 0 removed · 0 back",
      "dorm · beds24: 0 bookings · 0 new · 0 changed · 0 removed · 0 back",
      "studio · beds24: 1 bookings · 1 new · 0 changed · 0 removed · 0 back",
      "Beds24 credits: 3 used in this run · 97 left of 100 in this 5-minute window.",
    ]);
    const d = db(dir);
    expect(d.prepare("SELECT listing, uid, kind, booked_at FROM calendar_events ORDER BY listing, check_in").all()).toEqual([
      { listing: "loft", uid: "1", kind: "reservation", booked_at: "2026-09-01" },
      { listing: "loft", uid: "2", kind: "reservation", booked_at: "2026-10-20" },
      { listing: "loft", uid: "3", kind: "reservation", booked_at: "2026-10-20" },
      { listing: "loft", uid: "4", kind: "blocked", booked_at: null },
      { listing: "studio", uid: "7", kind: "reservation", booked_at: "2026-10-20" },
    ]);
    expect(d.prepare("SELECT uid, nights, total, per_night FROM beds24_stays ORDER BY uid").all()).toEqual([
      { uid: "1", nights: 4, total: 400, per_night: 100 },
      { uid: "2", nights: 2, total: 260, per_night: 130 },
      { uid: "3", nights: 1, total: 120, per_night: 120 },
      { uid: "7", nights: 2, total: 150, per_night: 75 },
    ]);
    // The next command reuses the short token saved in the file: no new token, no credits spent on it.
    const before = (fake as FakeBeds24).tokensIssued();
    const again = io(dir);
    await main(["beds24", "importa"], again);
    expect((fake as FakeBeds24).tokensIssued()).toBe(before);
    expect((fake as FakeBeds24).log.filter((r) => r.path === "/authentication/token")).toHaveLength(1);
    expect(again.lines.at(-1)).toMatch(/^Beds24 credits: 2 used in this run/);
    noSecrets(t);
  });

  it("marks a booking cancelled later as removed on the next sync", async () => {
    const { dir } = await setUp(BOOKINGS);
    await main(["beds24", "importa"], io(dir));
    (BOOKINGS[0] as FakeBooking).status = "cancelled";
    try {
      const t = io(dir);
      expect(await main(["sync"], t)).toBe(0);
      expect(t.lines).toContain("loft · beds24: 3 bookings · 0 new · 0 changed · 1 removed · 0 back");
      expect(t.lines.at(-1)).toMatch(/^Beds24 credits: \d+ used in this run/);
      expect(db(dir).prepare("SELECT removed_at FROM calendar_events WHERE uid = '1'").get()).toEqual({ removed_at: "2026-11-01T09:00:00.000Z" });
    } finally {
      (BOOKINGS[0] as FakeBooking).status = "confirmed";
    }
  });

  it("sync explains missing credentials", async () => {
    const { dir } = await setUp([]);
    const t = io(dir, { env: {} });
    expect(await main(["sync"], t)).toBe(1);
    expect(t.lines).toEqual([
      'loft · beds24: NOT READ — No Beds24 credentials yet: run "fairnight beds24 collega" (or set BEDS24_REFRESH_TOKEN). Nothing was changed for Beds24.',
    ]);
  });
});

describe("prices from Beds24 data", () => {
  it("uses bookingTime for the stale-calendar discount, and stay prices only with --usa-storico-beds24", async () => {
    const pricing = {
      ...LOFT,
      factors: {
        ...LOFT.factors,
        dayOfWeek: { enabled: true, adjustments: { mon: -30 } },
        staleCalendar: { enabled: true, afterDays: 14, stepPercent: 5, maxPercent: 10 },
        historicalFloor: { enabled: true, percent: 90, minNights: 3 },
      },
    };
    const { dir } = await setUp([booking(9, 101, "2025-11-10", "2025-11-15", { price: 600, bookingTime: "2025-10-01T09:00:00Z" }), booking(10, 101, "2026-11-20", "2026-11-22", { bookingTime: "2026-10-01T10:00:00Z" })], { pricing });
    await main(["beds24", "importa"], io(dir));
    const plain = io(dir);
    await main(["price", "--listing", "loft", "--days", "1", "--today", "2026-11-02", "--explain"], plain);
    expect(plain.lines[1]).toContain("no new bookings -10% = 63 (32 days since the last new booking)");
    expect(plain.lines[1]).not.toContain("historical floor");
    const withHistory = io(dir);
    await main(["price", "--listing", "loft", "--days", "1", "--today", "2026-11-02", "--explain", "--usa-storico-beds24"], withHistory);
    expect(withHistory.lines[1]).toContain("historical floor = 108 (90% of the 2025-11 average of 120 over 5 sold nights)");
  });
});

describe("fairnight beds24 spingi", () => {
  const stay = [booking(1, 101, "2026-11-04", "2026-11-06")];

  it("shows the differences and the credits, and writes nothing without --applica", async () => {
    const { dir, fake } = await setUp(stay);
    await main(["beds24", "importa"], io(dir));
    fake.calendar[101] = {
      "2026-11-02": { price1: 120, minStay: 3 },
      "2026-11-03": { price1: 100, minStay: 2, numAvail: 0 },
      "2026-11-07": { price1: 110, minStay: 2 },
    };
    const t = io(dir);
    expect(await main(["beds24", "spingi", "--alloggio", "101", "--da", "2026-11-01", "--a", "2026-11-08"], t)).toBe(0);
    expect(t.lines).toEqual([
      "loft → Beds24 room 101 (price1) · 2026-11-01 → 2026-11-08 · prices in EUR",
      "date        day   on Beds24   Fairnight  min stay",
      "2026-11-01  sun           —         100  — → 2",
      "2026-11-02  mon         120         100  3 → 2",
      "2026-11-06  fri           —         100  — → 2",
      "2026-11-08  sun           —         100  — → 2",
      '4 nights to change · 1 already right · 1 free here but unavailable on Beds24, left alone (run "fairnight beds24 importa")',
      "",
      "Dry run: nothing was written to Beds24. Add --applica to write these 4 nights.",
      "Beds24 credits: 1 used in this run · 96 left of 100 in this 5-minute window.",
    ]);
    expect(fake.log.filter((r) => r.method === "POST")).toHaveLength(0);
    noSecrets(t);
  });

  it("with --applica: checks the range end once, sends one request per room, and reads back night by night", async () => {
    const { dir, fake } = await setUp(stay, { rangeEnd: "exclusive" });
    await main(["beds24", "importa"], io(dir));
    const t = io(dir);
    expect(await main(["beds24", "spingi", "--alloggio", "101", "--da", "2026-11-07", "--a", "2026-11-12", "--applica"], t)).toBe(0);
    expect(t.lines).toContain(
      "Checked once how Beds24 reads a date range (2026-11-08 to 2026-11-09): the last day is NOT written. Fairnight keeps writing one night per element.",
    );
    expect(t.lines).toContain("Sent to Beds24: 6 nights in 6 calendar writes.");
    expect(t.lines).toContain("Read back from Beds24: every night matches.");
    const posts = fake.log.filter((r) => r.method === "POST").map((r) => JSON.parse(r.body) as { roomId: number; calendar: Record<string, unknown>[] }[]);
    expect(posts.map((p) => p.map((i) => `${i.calendar[0]?.from}:${i.calendar[0]?.to}`))).toEqual([
      ["2026-11-08:2026-11-09"],
      ["2026-11-07:2026-11-07", "2026-11-09:2026-11-09", "2026-11-10:2026-11-10", "2026-11-11:2026-11-11", "2026-11-12:2026-11-12"],
    ]);
    // Only the managed fields are sent.
    expect(Object.keys(posts[1]?.[0]?.calendar[0] ?? {}).sort()).toEqual(["from", "minStay", "price1", "to"]);
    const d = db(dir);
    expect(d.prepare("SELECT value FROM meta WHERE key = 'beds24_range_end'").get()).toEqual({ value: "exclusive" });
    expect(d.prepare("SELECT nights, writes, refused, mismatches, error FROM beds24_pushes").all()).toEqual([{ nights: 6, writes: 6, refused: 0, mismatches: 0, error: null }]);
  });

  it("groups equal nights into ranges of at most 7 once the end is known to be included, in the chosen price field", async () => {
    const { dir, fake } = await setUp([], { rangeEnd: "inclusive", link: { priceField: "price2" } });
    await main(["beds24", "importa"], io(dir));
    fake.calendar[101] = { "2026-11-09": { price1: 333, numAvail: 1, override: "noCheckIn" } };
    const t = io(dir);
    expect(await main(["beds24", "spingi", "--alloggio", "101", "--da", "2026-11-09", "--a", "2026-11-27", "--applica"], t)).toBe(0);
    expect(t.lines[0]).toBe("loft → Beds24 room 101 (price2) · 2026-11-09 → 2026-11-27 · prices in EUR");
    const items = fake.log.filter((r) => r.method === "POST").flatMap((r) => JSON.parse(r.body) as { calendar: Record<string, unknown>[] }[]);
    expect(items.map((i) => `${i.calendar[0]?.from}:${i.calendar[0]?.to}`)).toEqual([
      "2026-11-09:2026-11-10",
      "2026-11-11:2026-11-13",
      "2026-11-14:2026-11-14",
      "2026-11-15:2026-11-20",
      "2026-11-21:2026-11-21",
      "2026-11-22:2026-11-27",
    ]);
    expect(items.every((i) => "price2" in (i.calendar[0] ?? {}) && !("price1" in (i.calendar[0] ?? {})))).toBe(true);
    // The other fields of the night are untouched.
    expect(fake.calendar[101]?.["2026-11-09"]).toMatchObject({ price1: 333, numAvail: 1, override: "noCheckIn", price2: 100, minStay: 2 });
    expect(t.lines).toContain("Read back from Beds24: every night matches.");
  });

  it("reports the nights Beds24 refused, element by element", async () => {
    const { dir } = await setUp([], { rangeEnd: "exclusive", refuseDates: ["2026-11-11"] });
    await main(["beds24", "importa"], io(dir));
    const t = io(dir);
    expect(await main(["beds24", "spingi", "--alloggio", "101", "--da", "2026-11-09", "--a", "2026-11-12", "--applica"], t)).toBe(1);
    expect(t.lines).toContain("  not written: 2026-11-11 — Beds24 says: price1: Price is below the minimum price of the room");
    expect(t.lines).toContain("Read back from Beds24: 1 night do not match: 2026-11-11.");
    expect(db(dir).prepare("SELECT refused, mismatches FROM beds24_pushes").get()).toEqual({ refused: 1, mismatches: 1 });
  });

  it("survives a token that expires in the middle of a run, and a 429", async () => {
    const { dir, fake } = await setUp([], { rangeEnd: "exclusive" });
    await main(["beds24", "importa"], io(dir));
    fake.expireTokens();
    fake.forceNext({ status: 429, body: { success: false, code: 429, error: "Usage limit exceeded in last 5 minutes" } });
    const t = io(dir);
    expect(await main(["beds24", "spingi", "--alloggio", "101", "--da", "2026-11-09", "--a", "2026-11-10", "--applica"], t)).toBe(0);
    expect(t.lines).toContain("Read back from Beds24: every night matches.");
    const statuses = fake.log.map((r) => `${r.method} ${r.path} ${r.status}`);
    expect(statuses).toContain("GET /inventory/rooms/calendar 401");
    expect(statuses).toContain("GET /inventory/rooms/calendar 429");
    noSecrets(t);
  });

  it("checks its options", async () => {
    const { dir } = await setUp([]);
    const cases: [string[], number, string][] = [
      [["beds24", "spingi", "--da", "2026-10-01"], 1, "--da 2026-10-01 is in the past: Fairnight prices nights from today (2026-11-01)."],
      [["beds24", "spingi", "--alloggio", "x"], 2, '--alloggio must be a Beds24 room number, got "x"'],
      [["beds24", "spingi", "--alloggio", "999"], 1, 'No listing is linked to Beds24 room 999. Run "fairnight beds24 importa" first.'],
      [["beds24", "nope"], 2, 'Unknown Beds24 command "nope". Use collega, importa or spingi.'],
      [["beds24"], 2, "Which Beds24 command? collega, importa or spingi."],
    ];
    for (const [args, code, message] of cases) {
      const t = io(dir);
      expect(await main(args, t)).toBe(code);
      expect(t.errors[0]).toBe(message);
    }
  });
});

describe("config", () => {
  it("accepts one channel manager per listing, a room never shared, and a valid price field", async () => {
    const { dir } = await setUp([]);
    const file = path.join(dir, "fairnight.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.listings.push({ name: "twin", calendars: [{ source: "beds24", roomId: 101, priceField: "price17" }, { source: "smoobu", apartmentId: 5 }], pricing: LOFT });
    writeFileSync(file, JSON.stringify(config));
    const t = io(dir);
    expect(await main(["price"], t)).toBe(1);
    expect(t.errors).toEqual([
      "Invalid fairnight.config.json:",
      '  - listings[1].calendars[0].priceField: must be one of price1 … price16, got "price17"',
      "  - listings[1].calendars[1]: a listing can be linked to one channel manager only (one Smoobu apartment or one Beds24 room)",
    ]);
    config.listings[1].calendars = [{ source: "beds24", roomId: 101 }];
    writeFileSync(file, JSON.stringify(config));
    const shared = io(dir);
    expect(await main(["price"], shared)).toBe(1);
    expect(shared.errors[1]).toBe('  - listings (twin): Beds24 room 101 is already linked to "loft"');
  });
});

describe("guest registration from Beds24 (Fairguest)", () => {
  it("seals holder, number of guests and reference; never in calendar_events or in the output", async () => {
    const { dir } = await setUp([booking(920, 101, "2099-06-10", "2099-06-13", { firstName: "Ospite", lastName: "Prova", numAdult: 2, numChild: 0, apiReference: "PROVA-0002" })]);
    await main(["beds24", "collega"], io(dir, { env: {}, prompt: async () => TEST_INVITE }));
    const file = path.join(dir, "fairnight.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.listings[0].fairguest = { country: "ES-CT", establishment: "ZZ00000000", establishmentName: "Casa di Prova" };
    writeFileSync(file, JSON.stringify(config));
    const env = { BEDS24_REFRESH_TOKEN: TEST_REFRESH, FAIRGUEST_FRASE: "frase segreta di prova" };
    expect(await main(["ospiti", "attiva"], io(dir, { env, scryptCost: { N: 2 ** 10, r: 8, p: 1 } }))).toBe(0);
    const t = io(dir, { env });
    expect(await main(["beds24", "importa"], t)).toBe(0);
    expect([...t.lines, ...t.errors].join("\n")).not.toMatch(/Ospite|PROVA-0002/);
    const d = db(dir);
    expect(JSON.stringify(d.prepare("SELECT * FROM calendar_events").all())).not.toMatch(/Ospite|Prova|PROVA-0002/);
    const row = d.prepare("SELECT id, channel_data FROM guest_stays").get() as { id: string; channel_data: string };
    expect(row.channel_data).not.toMatch(/Ospite|PROVA/);
    const shown = io(dir, { env });
    expect(await main(["ospiti", "mostra", row.id], shown)).toBe(0);
    expect(shown.lines[1]).toMatch(/reference PROVA-0002 · contract 2026-10-20 · 2 people/);
    expect(shown.lines[2]).toBe("  holder from beds24: Ospite Prova");
  });
});
