import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../../fairnight-cli/src/main.js";
import { buildServer, TOOLS } from "../src/server.js";

const FIXTURES = path.resolve(import.meta.dirname, "../../fairnight-cli/test/fixtures");
const LINKS: Record<string, string> = {
  "https://cal.example.org/airbnb/loft.ics": "airbnb-esempio.ics",
  "https://cal.example.org/booking/loft.ics": "booking-esempio.ics",
  "https://cal.example.org/vrbo/studio.ics": "vrbo-esempio.ics",
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
    fetch: async (url: string) => {
      const file = LINKS[url];
      if (!file) throw new Error(`unexpected request to ${url}`);
      const text = readFileSync(path.join(FIXTURES, file), "utf8");
      return { ok: true, status: 200, text: async () => text };
    },
  };
}

const dbHash = () => createHash("sha256").update(readFileSync(path.join(dir, "data", "fairnight.db"))).digest("hex");

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-"));
  await main(["init"], io(dir));
  const file = path.join(dir, "fairnight.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.listings[0].calendars = [
    { source: "airbnb", url: "https://cal.example.org/airbnb/loft.ics" },
    { source: "booking", url: "https://cal.example.org/booking/loft.ics" },
  ];
  config.listings[1].calendars = [{ source: "vrbo", url: "https://cal.example.org/vrbo/studio.ics" }];
  writeFileSync(file, JSON.stringify(config));
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
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  return { text: r.content.map((c) => c.text).join("\n"), data: r.structuredContent, isError: r.isError === true };
}

describe("fairnight MCP server", () => {
  it("offers the five tools, all read-only", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_listings", "get_prices", "explain_night", "occupancy", "next_gaps"]);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
    expect(TOOLS).toHaveLength(5);
  });

  it("lists the listings without ever showing the calendar links", async () => {
    const r = await call("list_listings");
    expect(r.text.split("\n")[0]).toBe("Today is 2026-11-01.");
    expect(r.text).toContain("- seaview-loft (Seaview Loft): base 100 EUR, minimum 3 nights, calendars: airbnb, booking, last read: ");
    expect(r.text).not.toContain("example.org");
    expect(JSON.stringify(r.data)).not.toContain("example.org");
  });

  it("gives the prices of a range of nights", async () => {
    const r = await call("get_prices", { listing: "seaview-loft", from: "2026-11-02", to: "2026-11-05" });
    expect(r.text).toBe(
      [
        "seaview-loft, 2026-11-02 → 2026-11-05:",
        "2026-11-02 mon: 85 EUR, minimum 1",
        "2026-11-03 tue: 85 EUR, minimum 1",
        "2026-11-04 wed: reserved",
        "2026-11-05 thu: reserved",
      ].join("\n"),
    );
    const def = await call("get_prices", { listing: "garden-studio" });
    expect((def.data?.nights as unknown[]).length).toBe(14);
  });

  it("explains one night", async () => {
    const r = await call("explain_night", { listing: "seaview-loft", date: "2026-11-09" });
    expect(r.text).toBe(
      "Mon 2026-11-09 · 88 EUR: base 100 → gap of 2 nights -12% = 88 → within floor 60 and ceiling 260. Min stay 2 (lowered to fill the gap).",
    );
    expect(r.data).toMatchObject({ price: 88, minStay: 2, minStaySource: "gap" });
  });

  it("measures the occupancy of a month", async () => {
    const r = await call("occupancy", { listing: "seaview-loft", month: "2026-11" });
    expect(r.data).toMatchObject({ nights: 30, reserved: 12, blocked: 0, free: 18, occupancyPercent: 40, stillForSale: 18 });
    expect(r.text).toMatch(/^seaview-loft, 2026-11: 12 of 30 nights reserved, 0 blocked, 18 free \(occupancy 40%\)\. 18 nights still for sale, average [\d.]+ EUR\.$/);
    const dec = await call("occupancy", { listing: "seaview-loft", month: "2026-12" });
    expect(dec.data).toMatchObject({ blocked: 4, reserved: 5 });
    const past = await call("occupancy", { listing: "seaview-loft", month: "2025-01" });
    expect(past.data).toMatchObject({ reserved: 0, stillForSale: 0, averagePriceForSale: null });
  });

  it("finds the next gaps between stays", async () => {
    const r = await call("next_gaps", { listing: "seaview-loft", days: 60 });
    // 15–19 November is free too, but 5 nights is longer than a gap.
    expect(r.data?.gaps).toEqual([{ from: "2026-11-08", to: "2026-11-09", nights: 2, prices: [84, 88], minStay: 2 }]);
    expect(r.text).toBe("seaview-loft: 1 gap of up to 3 nights between 2026-11-01 and 2026-12-30:\n- 2026-11-08 → 2026-11-09 (2 nights): 84, 88 EUR, minimum 2");
    const none = await call("next_gaps", { listing: "garden-studio", days: 3, maxNights: 1 });
    expect(none.text).toBe("garden-studio: no gaps of up to 1 nights between 2026-11-01 and 2026-11-03.");
  });

  it("answers mistakes with a message the model can act on", async () => {
    expect(await call("get_prices", { listing: "nope" })).toMatchObject({
      isError: true,
      text: 'No listing called "nope". Listings in the config: seaview-loft, garden-studio.',
    });
    expect((await call("get_prices", { listing: "seaview-loft", from: "2026-10-01" })).text).toBe(
      "Past nights have no price: start from today (2026-11-01) or later.",
    );
    expect((await call("get_prices", { listing: "seaview-loft", from: "2026-11-05", to: "2026-11-01" })).text).toBe('"to" (2026-11-01) is before "from" (2026-11-05).');
    expect((await call("get_prices", { listing: "seaview-loft", to: "2028-01-01" })).text).toBe("Ask for at most 366 days from today.");
    expect((await call("explain_night", { listing: "seaview-loft", date: "2026-02-30" })).text).toBe('date must be a date like 2026-11-03, got "2026-02-30"');
    expect((await call("explain_night", { listing: "seaview-loft", date: "2026-10-30" })).isError).toBe(true);
    expect((await call("explain_night", { listing: "seaview-loft", date: "2028-10-30" })).isError).toBe(true);
    expect((await call("occupancy", { listing: "seaview-loft", month: "2026-13" })).text).toBe('month must look like 2026-11, got "2026-13"');
    expect((await call("next_gaps", { listing: "seaview-loft", days: 0 })).text).toBe("days must be a whole number from 1 to 366");
    expect((await call("next_gaps", { listing: "seaview-loft", maxNights: 20 })).text).toBe("maxNights must be a whole number from 1 to 14");
  });

  it("never writes: the database is byte for byte the same after every tool", async () => {
    const before = dbHash();
    await call("list_listings");
    await call("get_prices", { listing: "seaview-loft", from: "2026-11-01", to: "2027-10-31" });
    await call("explain_night", { listing: "garden-studio", date: "2026-11-20" });
    await call("occupancy", { listing: "garden-studio", month: "2026-11" });
    await call("next_gaps", { listing: "garden-studio" });
    expect(dbHash()).toBe(before);
  });
});

describe("a folder that is not ready", () => {
  it("explains what to do", async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-empty-"));
    const [c, s] = InMemoryTransport.createLinkedPair();
    await buildServer({ dir: empty, now }).connect(s);
    const other = new Client({ name: "test", version: "1.0.0" });
    await other.connect(c);
    const r = (await other.callTool({ name: "list_listings", arguments: {} })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/Run "fairnight init" in this folder first\./);

    await main(["init"], io(empty));
    rmSync(path.join(empty, "data"), { recursive: true });
    const r2 = (await other.callTool({ name: "list_listings", arguments: {} })) as { content: { text: string }[] };
    expect(r2.content[0]?.text).toMatch(/^No database in .*: run "fairnight init" and "fairnight sync" there first\.$/);
    await other.close();
    rmSync(empty, { recursive: true, force: true });
  });
});
