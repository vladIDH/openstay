import { describe, expect, it } from "vitest";
import { classify, IcalError, parseIcal } from "../src/ical.js";
import { fixture } from "./helpers.js";

describe("iCal reader", () => {
  it("reads an Airbnb-style calendar: folded lines, all-day dates, stays and blocks", () => {
    const { events, skipped } = parseIcal(fixture("airbnb-esempio.ics"));
    expect(skipped).toEqual([]);
    expect(events).toEqual([
      { uid: "0f5a2b1c9d3e-1111aaaa2222bbbb@airbnb.example", start: "2026-11-04", end: "2026-11-08", summary: "Reserved" },
      { uid: "0f5a2b1c9d3e-3333cccc4444dddd@airbnb.example", start: "2026-12-01", end: "2026-12-05", summary: "Airbnb (Not available)" },
      { uid: "0f5a2b1c9d3e-5555eeee6666ffff@airbnb.example", start: "2026-12-25", end: "2026-12-30", summary: "Reserved" },
    ]);
    expect(events.map((e) => classify(e.summary, "airbnb"))).toEqual(["reservation", "blocked", "reservation"]);
  });

  it("reads a Booking-style calendar, where every event counts as a stay", () => {
    const { events } = parseIcal(fixture("booking-esempio.ics"));
    expect(events.map((e) => [e.start, e.end])).toEqual([
      ["2026-11-10", "2026-11-15"],
      ["2026-11-20", "2026-11-23"],
    ]);
    expect(events.map((e) => classify(e.summary, "booking"))).toEqual(["reservation", "reservation"]);
  });

  it("reads a Vrbo-style calendar: date-times, missing end, cancelled, missing UID, broken event", () => {
    const { events, skipped } = parseIcal(fixture("vrbo-esempio.ics"));
    expect(events.map((e) => [e.start, e.end, classify(e.summary, "vrbo")])).toEqual([
      ["2026-11-06", "2026-11-09", "reservation"],
      ["2026-11-14", "2026-11-15", "blocked"], // no DTEND: one night
      ["2026-11-28", "2026-11-30", "reservation"],
    ]);
    expect(events[2]?.uid).toMatch(/^gen-[0-9a-f]{16}$/);
    expect(skipped).toEqual(['event "Broken - no start" has no start date']);
  });

  it("gives the same generated UID to the same event every time", () => {
    const a = parseIcal(fixture("vrbo-esempio.ics")).events[2]?.uid;
    const b = parseIcal(fixture("vrbo-esempio.ics")).events[2]?.uid;
    expect(a).toBe(b);
  });

  it("handles LF line endings, a byte-order mark, DURATION and same-day events", () => {
    const text = [
      "﻿BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a",
      "DTSTART;VALUE=DATE:20261201",
      "DURATION:P3D",
      "SUMMARY:Owner stay\\, family",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "DTSTART;VALUE=DATE:20261210",
      "DTEND;VALUE=DATE:20261210",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:a",
      "DTSTART;VALUE=DATE:20261220",
      "DTEND;VALUE=DATE:20261221",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    expect(parseIcal(text).events).toEqual([
      { uid: "a", start: "2026-12-01", end: "2026-12-04", summary: "Owner stay, family" },
      { uid: "b", start: "2026-12-10", end: "2026-12-11", summary: "" },
    ]);
  });

  it("skips events with unreadable dates", () => {
    const text = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:2026-12-01\nSUMMARY:x\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261301\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261201\nDTEND:soon\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseIcal(text).skipped).toEqual([
      'event "x" has an unreadable start date "2026-12-01"',
      'event "?" has an unreadable start date "20261301"',
      'event "?" has an unreadable end date "soon"',
    ]);
  });

  it("refuses something that is not a calendar", () => {
    expect(() => parseIcal("<html>Login</html>")).toThrow(IcalError);
  });

  it("classifies other calendars by their summary, and obeys treatAs", () => {
    expect(classify("Closed", "other")).toBe("blocked");
    expect(classify("Unavailable", "other")).toBe("blocked");
    expect(classify("Guest stay", "other")).toBe("reservation");
    expect(classify("Reserved", "airbnb", "blocked")).toBe("blocked");
    expect(classify("CLOSED - Not available", "booking", "reservation")).toBe("reservation");
  });
});
