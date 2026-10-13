import type { NightQuote } from "fairnight";
import { describe, expect, it } from "vitest";
import { mapBookings } from "../src/mapping.js";
import { buildOperations, chunks, planPush, probePair, type DiffRow } from "../src/plan.js";

function night(date: string, price: number | null, minStay: number | null, status: NightQuote["status"] = "available"): NightQuote {
  return { date, weekday: "mon", status, price, minStay, minStaySource: minStay === null ? null : "default", steps: [], explanation: "" };
}

describe("push plan", () => {
  it("lists only the nights that change, and leaves reserved and unavailable nights alone", () => {
    const plan = planPush(
      [
        night("2026-11-03", 95, 2),
        night("2026-11-04", 100, 3),
        night("2026-11-05", null, null, "reserved"),
        night("2026-11-06", 110, 3),
        night("2026-11-07", 120, 3),
      ],
      {
        "2026-11-03": { price: 100, min_length_of_stay: 3, available: 1 },
        "2026-11-04": { price: 100, min_length_of_stay: 3, available: 1 },
        "2026-11-06": { price: null, min_length_of_stay: null, available: 1 },
        "2026-11-07": { price: 90, min_length_of_stay: 2, available: 0 },
      },
    );
    expect(plan).toEqual({
      changes: [
        { date: "2026-11-03", currentPrice: 100, currentMinStay: 3, newPrice: 95, newMinStay: 2 },
        { date: "2026-11-06", currentPrice: null, currentMinStay: null, newPrice: 110, newMinStay: 3 },
      ],
      unchanged: 1,
      unavailableOnSmoobu: ["2026-11-07"],
    });
  });
});

const row = (date: string, newPrice: number, newMinStay = 2): DiffRow => ({ date, currentPrice: null, currentMinStay: null, newPrice, newMinStay });

describe("operations", () => {
  const rows = [
    row("2026-11-03", 90),
    row("2026-11-04", 90),
    row("2026-11-05", 90),
    row("2026-11-06", 95),
    row("2026-11-08", 95),
    ...Array.from({ length: 9 }, (_, i) => row(`2026-11-${String(10 + i).padStart(2, "0")}`, 100, 3)),
  ];

  it("writes single days, price and minimum together, until the range end is known", () => {
    for (const end of ["unknown", "exclusive"] as const) {
      const ops = buildOperations(rows, end);
      expect(ops).toHaveLength(rows.length);
      expect(ops[0]).toEqual({ dates: ["2026-11-03"], daily_price: 90, min_length_of_stay: 2 });
      expect(ops.every((o) => o.dates.length === 1 && !o.dates[0]?.includes(":"))).toBe(true);
    }
  });

  it("groups runs of equal nights into ranges of at most 7 nights once the end is known to be included", () => {
    expect(buildOperations(rows, "inclusive")).toEqual([
      { dates: ["2026-11-03:2026-11-05"], daily_price: 90, min_length_of_stay: 2 },
      { dates: ["2026-11-06"], daily_price: 95, min_length_of_stay: 2 },
      { dates: ["2026-11-08"], daily_price: 95, min_length_of_stay: 2 },
      { dates: ["2026-11-10:2026-11-16"], daily_price: 100, min_length_of_stay: 3 },
      { dates: ["2026-11-17:2026-11-18"], daily_price: 100, min_length_of_stay: 3 },
    ]);
  });

  it("finds two consecutive equal nights to check how Smoobu reads a range", () => {
    expect(probePair(rows)?.map((r) => r.date)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(probePair([row("2026-11-03", 90), row("2026-11-04", 91)])).toBeNull();
  });

  it("splits a list into chunks", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("mapping Smoobu bookings", () => {
  const base = { channel: { id: 1, name: "Airbnb" }, "guest-name": "x" };
  it("turns reservations into stays with their booking day and price per night", () => {
    const r = mapBookings([
      { ...base, id: 1, type: "reservation", arrival: "2026-11-04", departure: "2026-11-08", "created-at": "2026-10-20 14:03", apartment: { id: 398 }, price: 410, "is-blocked-booking": false },
      { ...base, id: 2, type: "modification of booking", arrival: "2026-11-10", departure: "2026-11-11", "created-at": "2026-10-22T08:00:00+02:00", apartment: { id: 398 }, price: "95.50" },
    ]);
    expect(r.stays).toEqual([
      { uid: "1", apartmentId: 398, checkIn: "2026-11-04", checkOut: "2026-11-08", kind: "reservation", bookedAt: "2026-10-20", stayPrice: { total: 410, nights: 4, perNight: 102.5 }, guests: { firstName: "x", lastName: null, guests: null, reference: null } },
      { uid: "2", apartmentId: 398, checkIn: "2026-11-10", checkOut: "2026-11-11", kind: "reservation", bookedAt: "2026-10-22", stayPrice: { total: 95.5, nights: 1, perNight: 95.5 }, guests: { firstName: "x", lastName: null, guests: null, reference: null } },
    ]);
  });

  it("keeps blocked dates as unavailable, without booking day or price", () => {
    const r = mapBookings([{ ...base, id: 3, type: "reservation", arrival: "2026-12-01", departure: "2026-12-05", "created-at": "2026-10-01 10:00", apartment: { id: 398 }, price: 0, "is-blocked-booking": true }]);
    expect(r.stays[0]).toMatchObject({ kind: "blocked", bookedAt: null, stayPrice: null, guests: null });
  });

  it("reads holder, number of guests and reference for guest registration", () => {
    const r = mapBookings([
      { ...base, id: 6, type: "reservation", arrival: "2099-06-10", departure: "2099-06-13", apartment: { id: 398 }, firstname: " Ospite ", lastname: "Prova", adults: 2, children: "1", "reference-id": "PROVA-0001" },
      { ...base, id: 7, type: "reservation", arrival: "2099-07-10", departure: "2099-07-13", apartment: { id: 398 }, "guest-name": "Ospite Prova", adults: null },
    ]);
    expect(r.stays.map((s) => s.guests)).toEqual([
      { firstName: "Ospite", lastName: "Prova", guests: 3, reference: "PROVA-0001" },
      { firstName: "Ospite Prova", lastName: null, guests: null, reference: null },
    ]);
  });

  it("drops cancellations, duplicates and unreadable bookings", () => {
    const r = mapBookings([
      { ...base, id: 4, type: "reservation", arrival: "2026-11-04", departure: "2026-11-08", apartment: { id: 398 }, price: null },
      { ...base, id: 4, type: "reservation", arrival: "2026-11-04", departure: "2026-11-08", apartment: { id: 398 } },
      { ...base, id: 4, type: "cancellation", arrival: "2026-11-04", departure: "2026-11-08", apartment: { id: 398 } },
      { ...base, id: 5, type: "reservation", arrival: "2026-11-08", departure: "2026-11-08", apartment: { id: 398 } },
    ]);
    expect(r.stays).toEqual([]);
    expect(r.cancelled).toEqual(["4"]);
    expect(r.skipped).toEqual(["booking 5 has unreadable dates (2026-11-08 → 2026-11-08)"]);
  });
});
