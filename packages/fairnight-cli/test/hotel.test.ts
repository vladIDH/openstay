/**
 * Small hotels: room types with several identical units, from iCal calendars
 * (one per room), Beds24 (qty > 1) and Smoobu (several apartments joined).
 * All data invented: "Hotel Prova", 14 rooms (6 doubles, 4 triples, 4 singles).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeBeds24, TEST_REFRESH, type FakeBeds24, type FakeBooking as Beds24Booking } from "../../fairnight-beds24/test/fake-beds24.js";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeBooking as SmoobuBooking, type FakeSmoobu } from "../../fairnight-smoobu/test/fake-smoobu.js";
import { loadHostConfig, validateHostConfig, type HostListing } from "../src/config.js";
import { renderPage } from "../src/page.js";
import { pricesPayload } from "../src/serve.js";
import { openDb, type Db } from "../src/db.js";
import { main } from "../src/main.js";
import { priceOne } from "../src/price.js";
import { syncListings } from "../src/sync.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

const PRICING = { currency: "EUR", basePrice: 95, defaultMinStay: 1, factors: {} };

const opened: Db[] = [];
let beds24: FakeBeds24 | null = null;
let smoobu: FakeSmoobu | null = null;
afterEach(async () => {
  for (const db of opened.splice(0)) if (db.open) db.close();
  await beds24?.close();
  await smoobu?.close();
  beds24 = null;
  smoobu = null;
});

function db(dir: string): Db {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

function issues(config: unknown): string[] {
  const r = validateHostConfig(config);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("config of a room type", () => {
  const ical = (unit?: string, source = "airbnb", n = 1) => ({ source, url: `https://cal.example.org/${source}/${unit ?? "x"}-${n}.ics`, ...(unit ? { unit } : {}) });

  it("each iCal calendar of a room type names its room; a home never does", () => {
    expect(issues({ listings: [{ name: "doppia", calendars: [ical("101"), ical(undefined, "booking")], pricing: { ...PRICING, units: 6 } }] })).toEqual([
      'listings[0].calendars[1].unit: missing: on a room type with 6 units each calendar belongs to one room, say which (like "101"). A calendar of the whole room type is not supported',
    ]);
    expect(issues({ listings: [{ name: "casa", calendars: [ical("101")], pricing: PRICING }] })).toEqual([
      "listings[0].calendars[0].unit: is only for a room type with more than one unit: set pricing.units, or remove it",
    ]);
    expect(issues({ listings: [{ name: "doppia", calendars: [ical(" ")], pricing: { ...PRICING, units: 2 } }] })[0]).toMatch(/^listings\[0\]\.calendars\[0\]\.unit: must be the name of a room/);
  });

  it("never more rooms than units; two calendars of the same room are fine", () => {
    const calendars = [ical("101"), ical("101", "booking"), ical("102"), ical("103")];
    expect(issues({ listings: [{ name: "doppia", calendars, pricing: { ...PRICING, units: 3 } }] })).toEqual([]);
    expect(issues({ listings: [{ name: "doppia", calendars, pricing: { ...PRICING, units: 2 } }] })).toEqual([
      "listings (doppia): the calendars name 3 different rooms, but pricing.units is 2",
    ]);
  });

  it("joins up to `units` Smoobu apartments, each only once, never with Beds24", () => {
    const apts = (...ids: number[]) => ids.map((apartmentId) => ({ source: "smoobu", apartmentId }));
    expect(issues({ listings: [{ name: "studio", calendars: apts(501, 502, 503), pricing: { ...PRICING, units: 3 } }] })).toEqual([]);
    expect(issues({ listings: [{ name: "studio", calendars: apts(501, 502, 503), pricing: { ...PRICING, units: 2 } }] })).toEqual([
      "listings[0].calendars[2]: a room type with 2 units can be linked to at most 2 Smoobu apartments",
    ]);
    expect(issues({ listings: [{ name: "studio", calendars: apts(501, 501), pricing: { ...PRICING, units: 2 } }] })).toEqual([
      "listings (studio): Smoobu apartment 501 is listed twice",
    ]);
    expect(issues({ listings: [{ name: "studio", calendars: [...apts(501), { source: "beds24", roomId: 7 }], pricing: { ...PRICING, units: 2 } }] })).toEqual([
      "listings[0].calendars[1]: a listing can be linked to one channel manager only (one Smoobu apartment or one Beds24 room)",
    ]);
  });
});

/** A tiny iCal calendar with whole-day events. */
function ics(events: { uid: string; from: string; to: string; summary: string }[]): string {
  const d = (iso: string) => iso.replaceAll("-", "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((e) => ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTART;VALUE=DATE:${d(e.from)}`, `DTEND;VALUE=DATE:${d(e.to)}`, `SUMMARY:${e.summary}`, "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

describe("iCal: one calendar per room", () => {
  const url = (s: string) => `https://cal.example.org/hotel-prova/${s}.ics`;

  it("counts each room once, even when Airbnb and Booking both show it, and prices the room type", async () => {
    const r = validateHostConfig({
      listings: [
        {
          name: "doppia",
          calendars: [
            { source: "airbnb", url: url("101-airbnb"), unit: "101" },
            { source: "booking", url: url("101-booking"), unit: "101" },
            { source: "airbnb", url: url("102-airbnb"), unit: "102" },
          ],
          pricing: { ...PRICING, units: 3 },
        },
      ],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const listing = r.value.listings[0] as HostListing;
    const fetch = fakeFetch({
      // Room 101 booked on Booking; Airbnb shows the same nights as "Not available".
      [url("101-airbnb")]: ics([{ uid: "a1", from: "2026-11-10", to: "2026-11-12", summary: "Airbnb (Not available)" }]),
      [url("101-booking")]: ics([{ uid: "b1", from: "2026-11-10", to: "2026-11-12", summary: "CLOSED - Not available" }]),
      [url("102-airbnb")]: ics([{ uid: "a2", from: "2026-11-11", to: "2026-11-12", summary: "Reserved" }]),
    });
    const database = db(tempDir());
    await syncListings(database, [listing], { fetch, now: new Date("2026-11-01T08:00:00Z") });
    const nights = priceOne(database, listing, "2026-11-09", 4).nights;
    expect(nights.map((n) => [n.date, n.status, n.units?.free])).toEqual([
      ["2026-11-09", "available", 3],
      ["2026-11-10", "available", 2],
      ["2026-11-11", "available", 1],
      ["2026-11-12", "available", 3],
    ]);
    expect(nights[2]?.explanation).toBe("Wed 2026-11-11 · 95 EUR (1 of 3 rooms free): base 95. Min stay 1 (default).");
  });
});

// ---------------------------------------------------------------- Beds24

const T0 = Date.parse("2026-11-01T09:00:00Z");

function beds24Booking(id: number, arrival: string, departure: string, extra: Partial<Beds24Booking> = {}): Beds24Booking {
  return { id, propertyId: 30, roomId: 301, status: "confirmed", arrival, departure, bookingTime: "2026-10-20T14:03:00Z", price: 200, firstName: "Invented", lastName: "Guest", ...extra };
}

async function hotelOnBeds24(bookings: Beds24Booking[], calendar: Record<number, Record<string, { numAvail?: number }>> = {}) {
  const clock = { now: T0 };
  beds24 = await startFakeBeds24({
    inviteCode: "invite-0000-not-real",
    refreshToken: TEST_REFRESH,
    clock,
    properties: [
      {
        id: 30,
        name: "Hotel Prova",
        currency: "EUR",
        rooms: [
          { id: 301, name: "Doppia", qty: 6, rackRate: 95, minPrice: 60 },
          { id: 302, name: "Tripla", qty: 4, rackRate: 120, minPrice: 80 },
          { id: 303, name: "Singola", qty: 4, rackRate: 70, minPrice: 45 },
        ],
      },
    ],
    bookings,
    calendar,
    rangeEnd: "inclusive",
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [{ name: "casa", calendars: [], pricing: PRICING }] }));
  const io = (): TestIo => {
    const t = testIo(dir, undefined, new Date(clock.now).toISOString());
    Object.assign(t, {
      now: () => new Date(clock.now),
      env: { BEDS24_REFRESH_TOKEN: TEST_REFRESH },
      beds24BaseUrl: (beds24 as FakeBeds24).baseUrl,
      beds24Fetch: (u: string, init: RequestInit) => fetch(u, init),
      sleep: async (ms: number) => {
        clock.now += ms;
      },
    });
    return t;
  };
  return { dir, io };
}

describe("Beds24: rooms with several units", () => {
  const BOOKINGS = [
    beds24Booking(1, "2026-11-03", "2026-11-05", { unitId: 1 }),
    beds24Booking(2, "2026-11-03", "2026-11-04", { unitId: 2 }),
    // Not assigned to a unit yet, two rooms in one booking.
    beds24Booking(3, "2026-11-04", "2026-11-05", { unitId: 0, roomQty: 2 }),
    beds24Booking(4, "2026-11-06", "2026-11-07", { roomId: 302, unitId: 3 }),
  ];

  it("imports each room type with its units and reads the bookings unit by unit", async () => {
    const { dir, io } = await hotelOnBeds24(BOOKINGS);
    const t = io();
    expect(await main(["beds24", "importa"], t)).toBe(0);
    expect(t.lines.slice(0, 3)).toEqual([
      'Added listing "doppia" for Beds24 room 301 (Hotel Prova · Doppia, 6 identical units at one price): base price 95 EUR, from the prices set in Beds24. Check its rules in fairnight.config.json.',
      'Added listing "tripla" for Beds24 room 302 (Hotel Prova · Tripla, 4 identical units at one price): base price 120 EUR, from the prices set in Beds24. Check its rules in fairnight.config.json.',
      'Added listing "singola" for Beds24 room 303 (Hotel Prova · Singola, 4 identical units at one price): base price 70 EUR, from the prices set in Beds24. Check its rules in fairnight.config.json.',
    ]);
    expect(db(dir).prepare("SELECT listing, uid, unit, units FROM calendar_events ORDER BY uid").all()).toEqual([
      { listing: "doppia", uid: "1", unit: "1", units: null },
      { listing: "doppia", uid: "2", unit: "2", units: null },
      { listing: "doppia", uid: "3", unit: null, units: 2 },
      { listing: "tripla", uid: "4", unit: "3", units: null },
    ]);
    const p = io();
    expect(await main(["price", "--listing", "doppia", "--days", "3", "--today", "2026-11-03"], p)).toBe(0);
    expect(p.lines).toEqual([
      "doppia · 6 units at one price · 3 nights from 2026-11-03 · prices in EUR",
      "date        day    price  min  why",
      "2026-11-03  tue       95    2  4/6 free",
      "2026-11-04  wed       95    2  3/6 free",
      "2026-11-05  thu       95    2  6/6 free",
      "3 for sale · 0 reserved · 0 blocked · average 95, from 95 to 95",
    ]);
    // The local page gets the rooms of each night, and says them in Italian.
    const doppia = pricesPayload(dir, loadHostConfig(dir), "2026-11-03", 2).listings.find((l) => l.name === "doppia");
    expect(doppia?.nights.map((n) => n.units)).toEqual([
      { total: 6, free: 4, reserved: 2, blocked: 0 },
      { total: 6, free: 3, reserved: 3, blocked: 0 },
    ]);
    expect(renderPage("nonce-0000")).toContain('"{n} camere libere su {total}"');
  });

  it("warns when the number of units changes on Beds24", async () => {
    const { dir, io } = await hotelOnBeds24([]);
    await main(["beds24", "importa"], io());
    const config = path.join(dir, "fairnight.config.json");
    const raw = JSON.parse(readFileSync(config, "utf8"));
    raw.listings[1].pricing.units = 5;
    writeFileSync(config, JSON.stringify(raw));
    const t = io();
    await main(["beds24", "importa"], t);
    expect(t.lines[0]).toBe('Beds24 room 301 (Doppia) now has 6 units, listing "doppia" says 5: change pricing.units in fairnight.config.json.');
  });

  it("pushes one price per room type, and leaves alone the nights where Beds24 has a different number of units free", async () => {
    // Beds24 says 3 doubles free on 4 November, Fairnight sees 3 (1 + 2 rooms booked): it agrees.
    // On 5 November Beds24 says 5 free, Fairnight 6: that night is not written.
    const { io } = await hotelOnBeds24(BOOKINGS, { 301: { "2026-11-03": { numAvail: 4 }, "2026-11-04": { numAvail: 3 }, "2026-11-05": { numAvail: 5 } } });
    await main(["beds24", "importa"], io());
    const dry = io();
    expect(await main(["beds24", "spingi", "--alloggio", "301", "--da", "2026-11-03", "--a", "2026-11-06"], dry)).toBe(0);
    expect(dry.lines).toContain("doppia → Beds24 room 301 (price1, 6 units, one price) · 2026-11-03 → 2026-11-06 · prices in EUR");
    expect(dry.lines).toContain(
      '3 nights to change · 0 already right · 1 with a different number of units free on Beds24, left alone (run "fairnight beds24 importa")',
    );
    expect(dry.lines).toContain("  2026-11-05: 6 free here, 5 free on Beds24");
    expect((beds24 as FakeBeds24).log.filter((r) => r.method === "POST" && r.path === "/inventory/rooms/calendar")).toHaveLength(0);

    const t = io();
    expect(await main(["beds24", "spingi", "--alloggio", "301", "--da", "2026-11-03", "--a", "2026-11-06", "--applica"], t)).toBe(0);
    const posted = (beds24 as FakeBeds24).log
      .filter((r) => r.method === "POST" && r.path === "/inventory/rooms/calendar")
      .flatMap((r) => (JSON.parse(r.body) as { roomId: number; calendar: { from: string; to: string }[] }[]).map((w) => `${w.roomId} ${w.calendar[0]?.from}:${w.calendar[0]?.to}`));
    expect(posted).toEqual(["301 2026-11-03:2026-11-04", "301 2026-11-06:2026-11-06"]);
    expect(t.lines).toContain("Read back from Beds24: every night matches.");
  });
});

// ---------------------------------------------------------------- Smoobu

const NOW = "2026-11-01T09:00:00Z";

function smoobuBooking(id: number, apartment: number, arrival: string, departure: string): SmoobuBooking {
  return {
    id,
    type: "reservation",
    arrival,
    departure,
    "created-at": "2026-10-20 14:03",
    apartment: { id: apartment, name: "x" },
    channel: { id: 1, name: "Booking.com" },
    "guest-name": "Invented Guest",
    price: 200,
    "is-blocked-booking": false,
  };
}

type Rates = NonNullable<Parameters<typeof startFakeSmoobu>[0]["rates"]>;

async function aparthotelOnSmoobu(bookings: SmoobuBooking[], rates: Rates = {}) {
  smoobu = await startFakeSmoobu({
    ...TEST_CREDENTIALS,
    now: () => new Date(NOW),
    apartments: [501, 502, 503].map((id) => ({ id, name: `Studio ${id}`, currency: "EUR", minimal: "60.00", maximal: "120.00" })),
    bookings,
    rates,
    rangeEnd: "inclusive",
  });
  const dir = tempDir();
  await main(["init"], testIo(dir));
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify({
      listings: [{ name: "studio", calendars: [501, 502, 503].map((apartmentId) => ({ source: "smoobu", apartmentId })), pricing: { ...PRICING, basePrice: 80, units: 3 } }],
    }),
  );
  const io = (): TestIo => {
    const t = testIo(dir, undefined, NOW);
    Object.assign(t, {
      env: { SMOOBU_API_KEY: TEST_CREDENTIALS.apiKey, SMOOBU_API_SECRET: TEST_CREDENTIALS.apiSecret },
      smoobuBaseUrl: (smoobu as FakeSmoobu).baseUrl,
      smoobuFetch: (u: string, init: RequestInit) => fetch(u, init),
      sleep: async () => {},
    });
    return t;
  };
  return { dir, io };
}

describe("Smoobu: several apartments joined into one room type", () => {
  it("reads every apartment as a room, and writes one price to the free ones, one request per set of free apartments", async () => {
    // Smoobu marks booked nights unavailable on the apartment that has the booking.
    const booked = { price: 70, min_length_of_stay: 1, available: 0 };
    const { dir, io } = await aparthotelOnSmoobu([smoobuBooking(1, 501, "2026-11-04", "2026-11-06"), smoobuBooking(2, 502, "2026-11-05", "2026-11-06")], {
      501: { "2026-11-04": booked, "2026-11-05": booked },
      502: { "2026-11-05": booked },
    });
    const imp = io();
    expect(await main(["smoobu", "importa"], imp)).toBe(0);
    expect(imp.lines.some((l) => l.startsWith("Added listing"))).toBe(false);
    expect(db(dir).prepare("SELECT uid, unit FROM calendar_events ORDER BY uid").all()).toEqual([
      { uid: "1", unit: "501" },
      { uid: "2", unit: "502" },
    ]);

    const t = io();
    expect(await main(["smoobu", "spingi", "--da", "2026-11-03", "--a", "2026-11-06", "--applica"], t)).toBe(0);
    expect(t.lines[0]).toBe("studio → Smoobu apartments 501, 502, 503 (one room type, one price) · 2026-11-03 → 2026-11-06 · prices in EUR");
    const posts = (smoobu as FakeSmoobu).log
      .filter((r) => r.method === "POST")
      .map((r) => JSON.parse(r.body) as { apartments: number[]; operations: { dates: string[] }[] })
      .map((b) => `${b.apartments.join(",")} ${b.operations.map((o) => o.dates[0]).join(" ")}`);
    // The first POST checks once, on one apartment, how Smoobu reads a range; then one POST per set of free apartments.
    // Free: 3rd all three, 4th 502 and 503, 5th 503 only, 6th all three again.
    expect(posts).toEqual(["502 2026-11-03:2026-11-04", "501,503 2026-11-03", "503 2026-11-04:2026-11-05", "501,502,503 2026-11-06"]);
    const again = io();
    await main(["smoobu", "spingi", "--da", "2026-11-03", "--a", "2026-11-06"], again);
    expect(again.lines).toContain("0 nights to change · 4 already right");
    expect(t.lines).toContain("Read back from Smoobu: every night matches.");
    for (const apt of [501, 502, 503]) {
      for (const [date, rate] of Object.entries((smoobu as FakeSmoobu).rates[apt] ?? {})) {
        if (date >= "2026-11-03" && date <= "2026-11-06" && rate.available !== 0) expect(rate.price).toBe(80);
      }
    }
  });
});
