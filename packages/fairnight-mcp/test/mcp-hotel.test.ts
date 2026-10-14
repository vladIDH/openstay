/**
 * The MCP tools on a room type of a small hotel (invented "Hotel Prova":
 * three identical doubles, one iCal calendar per room).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../../fairnight-cli/src/main.js";
import { buildServer } from "../src/server.js";

/** Whole-day "Reserved" events of an Airbnb calendar. */
function ics(stays: [string, string][]): string {
  const d = (iso: string) => iso.replaceAll("-", "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...stays.flatMap(([from, to], i) => ["BEGIN:VEVENT", `UID:r${i}-${from}`, `DTSTART;VALUE=DATE:${d(from)}`, `DTEND;VALUE=DATE:${d(to)}`, "SUMMARY:Reserved", "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const url = (room: string) => `https://cal.example.org/hotel-prova/${room}.ics`;
// 5 and 7 November sold out; 6 November only room 101 taken; 8–9 November rooms 102 and 103 taken.
const CALENDARS: Record<string, string> = {
  [url("101")]: ics([["2026-11-05", "2026-11-08"]]),
  [url("102")]: ics([["2026-11-05", "2026-11-06"], ["2026-11-07", "2026-11-10"]]),
  [url("103")]: ics([["2026-11-05", "2026-11-06"], ["2026-11-07", "2026-11-10"]]),
};

let dir = "";
let client: Client;
const now = () => new Date("2026-11-01T09:00:00");

function io(cwd: string) {
  return {
    cwd,
    out: () => {},
    err: () => {},
    now,
    fetch: async (u: string) => {
      const text = CALENDARS[u];
      if (text === undefined) throw new Error(`unexpected request to ${u}`);
      return { ok: true, status: 200, text: async () => text };
    },
  };
}

const dbHash = () => createHash("sha256").update(readFileSync(path.join(dir, "data", "fairnight.db"))).digest("hex");

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-hotel-"));
  await main(["init"], io(dir));
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify({
      listings: [
        {
          name: "doppia",
          calendars: ["101", "102", "103"].map((room) => ({ source: "airbnb", url: url(room), unit: room })),
          pricing: {
            name: "Hotel Prova · Doppia",
            currency: "EUR",
            basePrice: 90,
            defaultMinStay: 2,
            units: 3,
            factors: {
              gaps: { enabled: true, maxNights: 3, discountPercent: 10, lowerMinStay: true },
              scarcity: { enabled: true, steps: [{ takenPercent: 50, raisePercent: 10 }], maxRaisePercent: 20 },
            },
          },
        },
      ],
    }),
  );
  expect(await main(["sync"], io(dir))).toBe(0);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer({ dir, now }).connect(serverSide);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; structuredContent?: Record<string, unknown> };
  return { text: r.content.map((c) => c.text).join("\n"), data: r.structuredContent };
}

describe("MCP tools on a room type with several units", () => {
  it("list_listings and get_prices show the units and how many are free", async () => {
    expect((await call("list_listings")).text).toContain("- doppia (Hotel Prova · Doppia): room type of 3 identical units, base 90 EUR");
    const r = await call("get_prices", { listing: "doppia", from: "2026-11-05", to: "2026-11-08" });
    expect(r.data?.nights).toEqual([
      { date: "2026-11-05", weekday: "thu", status: "reserved", price: null, minStay: null, units: 3, unitsFree: 0 },
      { date: "2026-11-06", weekday: "fri", status: "available", price: 81, minStay: 1, units: 3, unitsFree: 2 },
      { date: "2026-11-07", weekday: "sat", status: "reserved", price: null, minStay: null, units: 3, unitsFree: 0 },
      { date: "2026-11-08", weekday: "sun", status: "available", price: 99, minStay: 2, units: 3, unitsFree: 1 },
    ]);
    expect(r.text).toBe(
      [
        "doppia, 2026-11-05 → 2026-11-08:",
        "2026-11-05 thu: reserved, 0 of 3 rooms free",
        "2026-11-06 fri: 81 EUR, minimum 1, 2 of 3 rooms free",
        "2026-11-07 sat: reserved, 0 of 3 rooms free",
        "2026-11-08 sun: 99 EUR, minimum 2, 1 of 3 rooms free",
      ].join("\n"),
    );
  });

  it("explain_night says how many rooms are free and which rule weighed most", async () => {
    const r = await call("explain_night", { listing: "doppia", date: "2026-11-08" });
    expect(r.text).toBe(
      'Sun 2026-11-08 · 99 EUR (1 of 3 rooms free): base 90 → few rooms left (≥50% taken) +10% = 99 (1 of 3 rooms free · 67% taken). Min stay 2 (default). Weighed most: few rooms left (≥50% taken) +10%.',
    );
    expect(r.data).toMatchObject({ units: 3, unitsFree: 1 });
  });

  it("occupancy counts room-nights", async () => {
    const r = await call("occupancy", { listing: "doppia", month: "2026-11" });
    // 3 + 1 + 3 + 2 + 2 = 11 of 90 room-nights.
    expect(r.data).toMatchObject({ nights: 30, reserved: 2, blocked: 0, units: 3, roomNights: { total: 90, reserved: 11, blocked: 0, free: 79 }, occupancyPercent: 12.2 });
    expect(r.text).toMatch(/^doppia, 2026-11, 3 rooms: 11 of 90 room-nights reserved, 0 blocked, 79 free; 2 nights sold out, 0 closed \(occupancy 12\.2%\)\./);
  });

  it("next_gaps finds the free rooms between two sold-out nights, with the engine's own rule", async () => {
    const r = await call("next_gaps", { listing: "doppia", days: 20 });
    expect(r.data?.gaps).toEqual([{ from: "2026-11-06", to: "2026-11-06", nights: 1, prices: [81], minStay: 1, unitsFree: [2] }]);
    expect(r.text).toContain("- 2026-11-06 → 2026-11-06 (1 night): 81 EUR, minimum 1, rooms free 2 of 3");
  });

  it("only reads: the database is the same after every call", async () => {
    const before = dbHash();
    await call("get_prices", { listing: "doppia" });
    await call("explain_night", { listing: "doppia", date: "2026-11-06" });
    await call("occupancy", { listing: "doppia", month: "2026-11" });
    await call("next_gaps", { listing: "doppia" });
    expect(dbHash()).toBe(before);
  });
});
