import type { NightQuote } from "fairnight";
import { describe, expect, it } from "vitest";
import type { Beds24Booking } from "../src/client.js";
import { mapBookings } from "../src/mapping.js";
import { buildWrites, nightsOf, planPush, probePair, type DiffRow } from "../src/plan.js";

const night = (date: string, price: number | null, minStay: number | null): NightQuote => ({
  date,
  weekday: "mon",
  status: price === null ? "reserved" : "available",
  price,
  minStay,
  minStaySource: minStay === null ? null : "default",
  steps: [],
  explanation: "",
});

describe("push plan", () => {
  it("lists the nights that change and leaves unavailable ones alone", () => {
    expect(
      planPush([night("2026-11-03", 95, 2), night("2026-11-04", 100, 3), night("2026-11-05", null, null), night("2026-11-06", 90, 2)], {
        "2026-11-03": { price: 100, minStay: 3, available: true },
        "2026-11-04": { price: 100, minStay: 3, available: true },
        "2026-11-06": { price: 90, minStay: 2, available: false },
      }),
    ).toEqual({
      changes: [{ date: "2026-11-03", currentPrice: 100, currentMinStay: 3, newPrice: 95, newMinStay: 2 }],
      unchanged: 1,
      unavailableOnBeds24: ["2026-11-06"],
    });
  });
});

const row = (date: string, newPrice: number, newMinStay = 2): DiffRow => ({ date, currentPrice: null, currentMinStay: null, newPrice, newMinStay });

describe("writes", () => {
  const rows = [row("2026-11-03", 90), row("2026-11-04", 90), row("2026-11-05", 95), ...Array.from({ length: 9 }, (_, i) => row(`2026-11-${String(10 + i).padStart(2, "0")}`, 100, 3))];

  it("writes single days (from = to) until Beds24's range end is known", () => {
    for (const end of ["unknown", "exclusive"] as const) {
      const w = buildWrites(101, rows, end);
      expect(w).toHaveLength(rows.length);
      expect(w.every((x) => x.from === x.to && x.roomId === 101)).toBe(true);
    }
  });

  it("groups equal nights into ranges of at most 7 once 'to' is known to be included", () => {
    expect(buildWrites(101, rows, "inclusive").map((w) => `${w.from}:${w.to} ${w.price}/${w.minStay}`)).toEqual([
      "2026-11-03:2026-11-04 90/2",
      "2026-11-05:2026-11-05 95/2",
      "2026-11-10:2026-11-16 100/3",
      "2026-11-17:2026-11-18 100/3",
    ]);
    expect(nightsOf({ roomId: 1, from: "2026-11-10", to: "2026-11-12", price: 1, minStay: 1 })).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  });

  it("finds two consecutive equal nights for the one-time check", () => {
    expect(probePair(rows)?.map((r) => r.date)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(probePair([row("2026-11-03", 90), row("2026-11-04", 91)])).toBeNull();
  });
});

describe("mapping Beds24 bookings", () => {
  const b = (over: Partial<Beds24Booking> & { id: number }): Beds24Booking => ({
    roomId: 101,
    status: "confirmed",
    arrival: "2026-11-04",
    departure: "2026-11-08",
    bookingTime: "2026-10-20T14:03:00Z",
    price: 400,
    ...over,
  });

  it("confirmed, new and request are bookings with their booking day and price per night", () => {
    const r = mapBookings([b({ id: 1 }), b({ id: 2, status: "new", price: "150.50", arrival: "2026-11-10", departure: "2026-11-11" }), b({ id: 3, status: "request" })]);
    expect(r.stays.map((s) => [s.uid, s.kind, s.bookedAt, s.stayPrice])).toEqual([
      ["1", "reservation", "2026-10-20", { total: 400, nights: 4, perNight: 100 }],
      ["2", "reservation", "2026-10-20", { total: 150.5, nights: 1, perNight: 150.5 }],
      ["3", "reservation", "2026-10-20", { total: 400, nights: 4, perNight: 100 }],
    ]);
  });

  it("black is a blocked date, inquiry is ignored, cancelled is dropped", () => {
    const r = mapBookings([b({ id: 4, status: "black", price: 0 }), b({ id: 5, status: "inquiry" }), b({ id: 6, status: "cancelled" }), b({ id: 7, departure: "2026-11-04" })]);
    expect(r.stays).toEqual([{ uid: "4", roomId: 101, checkIn: "2026-11-04", checkOut: "2026-11-08", kind: "blocked", bookedAt: null, stayPrice: null, guests: null }]);
    expect(r.cancelled).toEqual(["6"]);
    expect(r.skipped).toEqual(["booking 7 has unreadable dates (2026-11-04 → 2026-11-04)"]);
  });

  it("reads holder, number of guests and reference for guest registration", () => {
    const r = mapBookings([b({ id: 11, firstName: "Ospite", lastName: "Prova", numAdult: 2, numChild: 0, apiReference: "PROVA-0001" }), b({ id: 12, firstName: "", lastName: null })]);
    expect(r.stays.map((s) => s.guests)).toEqual([
      { firstName: "Ospite", lastName: "Prova", guests: 2, reference: "PROVA-0001" },
      { firstName: null, lastName: null, guests: null, reference: null },
    ]);
  });

  it("drops duplicates, and a booking that is also listed as cancelled", () => {
    const r = mapBookings([b({ id: 8 }), b({ id: 8 }), b({ id: 9 }), b({ id: 9, status: "cancelled" }), b({ id: 10, price: null })]);
    expect(r.stays.map((s) => s.uid)).toEqual(["8", "10"]);
    expect(r.stays[1]?.stayPrice).toBeNull();
  });
});
