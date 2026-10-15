import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../../fairnight-cli/src/db.js";
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
  it("offers nine tools, all read-only", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["list_listings", "get_prices", "explain_night", "occupancy", "next_gaps", "get_sync_status", "get_market_area", "get_guest_deadlines", "get_guest_replies"]);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
    expect(TOOLS).toHaveLength(9);
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

  it("tells where the data comes from and when it was read, never the links", async () => {
    const r = await call("get_sync_status");
    expect(r.text.split("\n")).toEqual([
      expect.stringMatching(/^- seaview-loft \(data from ical\): airbnb iCal: last read 2026-11-01T\S+; booking iCal: last read 2026-11-01T\S+$/),
      expect.stringMatching(/^- garden-studio \(data from ical\): vrbo iCal: last read 2026-11-01T\S+$/),
    ]);
    expect(JSON.stringify(r.data)).not.toContain("example.org");
  });

  it("never writes: the database is byte for byte the same after every tool", async () => {
    const before = dbHash();
    await call("get_sync_status");
    await call("list_listings");
    await call("get_prices", { listing: "seaview-loft", from: "2026-11-01", to: "2027-10-31" });
    await call("explain_night", { listing: "garden-studio", date: "2026-11-20" });
    await call("occupancy", { listing: "garden-studio", month: "2026-11" });
    await call("next_gaps", { listing: "garden-studio" });
    expect(dbHash()).toBe(before);
  });
});

describe("zone data", () => {
  it("shows the zone data a listing uses, with its attribution, and never writes", async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-zone-"));
    await main(["init"], io(folder));
    const file = path.join(folder, "fairnight.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.listings[0].calendars = [];
    config.listings[0].marketArea = "costa";
    config.listings[0].pricing.factors.market.enabled = true;
    config.listings[1].calendars = [];
    writeFileSync(file, JSON.stringify(config));
    // Invented zone: 60% every night of November 2026, 90% on Saturday the 14th.
    const rows = ["date,occupancy,average_price,comparables"];
    for (let d = 1; d <= 30; d++) rows.push(`2026-11-${String(d).padStart(2, "0")},${d === 14 ? 90 : 60},100,25`);
    writeFileSync(path.join(folder, "zona.csv"), rows.join("\n"));
    expect(await main(["mercato", "importa", "zona.csv", "--zona", "costa"], io(folder))).toBe(0);

    const [c, s] = InMemoryTransport.createLinkedPair();
    await buildServer({ dir: folder, now }).connect(s);
    const other = new Client({ name: "test", version: "1.0.0" });
    await other.connect(c);
    const ask = async (name: string, args: Record<string, unknown>) =>
      ((await other.callTool({ name, arguments: args })) as { content: { text: string }[] }).content[0]?.text ?? "";
    const before = createHash("sha256").update(readFileSync(path.join(folder, "data", "fairnight.db"))).digest("hex");

    expect((await ask("get_market_area", { listing: "seaview-loft", from: "2026-11-13", to: "2026-11-14" })).split("\n")).toEqual([
      'seaview-loft: zone "costa", zone demand on (weight 0.5, at most +15% / -10%). Source: your file "zona.csv", read 2026-11-01. 30 nights 2026-11-01 → 2026-11-30, average occupancy 61%, average price 100.',
      "2026-11-13: 60% booked, price 100, 25 comparables",
      "2026-11-14: 90% booked, price 100, 25 comparables",
    ]);
    expect(await ask("explain_night", { listing: "seaview-loft", date: "2026-11-14" })).toContain('zone demand "costa" +15%');
    expect(await ask("get_market_area", { listing: "garden-studio" })).toBe("garden-studio: no zone set (marketArea), zone demand off. Prices use only the host's own data.");
    expect(createHash("sha256").update(readFileSync(path.join(folder, "data", "fairnight.db"))).digest("hex")).toBe(before);
    await other.close();
    rmSync(folder, { recursive: true, force: true });
  });
});

describe("sync status with Smoobu", () => {
  it("names the Smoobu apartment and the latest error", async () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-smoobu-"));
    await main(["init"], io(folder));
    const file = path.join(folder, "fairnight.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.listings = [
      { name: "loft", calendars: [{ source: "smoobu", apartmentId: 398 }], pricing: config.listings[0].pricing },
      { name: "studio", calendars: [], pricing: config.listings[1].pricing },
      { name: "room", calendars: [{ source: "beds24", roomId: 101, priceField: "price2" }], pricing: config.listings[1].pricing },
    ];
    writeFileSync(file, JSON.stringify(config));
    const db = openDb(path.join(folder, "data", "fairnight.db"));
    const run = db.prepare("INSERT INTO sync_runs (listing, feed, at, ok, error) VALUES (?, ?, ?, ?, ?)");
    run.run("loft", "smoobu", "2026-10-31T08:00:00.000Z", 1, null);
    run.run("loft", "smoobu", "2026-11-01T08:00:00.000Z", 0, "Smoobu refused the request (401).");
    run.run("room", "beds24", "2026-11-01T07:30:00.000Z", 1, null);
    db.close();
    const [c, s] = InMemoryTransport.createLinkedPair();
    await buildServer({ dir: folder, now }).connect(s);
    const other = new Client({ name: "test", version: "1.0.0" });
    await other.connect(c);
    const r = (await other.callTool({ name: "get_sync_status", arguments: {} })) as { content: { text: string }[]; structuredContent: { listings: { dataFrom: string }[] } };
    expect(r.content[0]?.text).toBe(
      [
        "- loft (data from smoobu): Smoobu apartment 398: last read 2026-10-31T08:00:00.000Z (latest attempt failed: Smoobu refused the request (401).)",
        "- studio (data from none): no sources",
        "- room (data from beds24): Beds24 room 101: last read 2026-11-01T07:30:00.000Z",
      ].join("\n"),
    );
    expect(r.structuredContent.listings.map((l) => l.dataFrom)).toEqual(["smoobu", "none", "beds24"]);
    await other.close();
    rmSync(folder, { recursive: true, force: true });
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

describe("guest registration deadlines (Fairguest)", () => {
  async function call(folderDir: string, args: Record<string, unknown> = {}) {
    const [c, srv] = InMemoryTransport.createLinkedPair();
    await buildServer({ dir: folderDir, now }).connect(srv);
    const cl = new Client({ name: "test", version: "1.0.0" });
    await cl.connect(c);
    const r = await cl.callTool({ name: "get_guest_deadlines", arguments: args });
    await cl.close();
    return { text: (r.content as { text: string }[])[0]?.text ?? "", data: r.structuredContent as Record<string, unknown> };
  }

  it("says when Fairguest is off", async () => {
    expect((await call(dir)).text).toBe('Guest registration (Fairguest) is not turned on in this folder ("fairnight ospiti attiva").');
  });

  it("lists the communications due, without any personal data and without writing", async () => {
    const own = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-guests-"));
    try {
      await main(["init"], io(own));
      const file = path.join(own, "fairnight.config.json");
      const config = JSON.parse(readFileSync(file, "utf8"));
      config.listings[0].calendars = [{ source: "airbnb", url: "https://cal.example.org/airbnb/loft.ics" }];
      config.listings[0].fairguest = { country: "ES-CT", establishment: "ZZ00000000", establishmentName: "Casa di Prova", checkInTime: "16:00" };
      config.listings[1].calendars = [];
      writeFileSync(file, JSON.stringify(config));
      const withKey = { ...io(own), env: { FAIRGUEST_FRASE: "frase segreta di prova" }, scryptCost: { N: 2 ** 10, r: 8, p: 1 } };
      expect(await main(["ospiti", "attiva"], withKey)).toBe(0);
      expect(await main(["sync"], io(own))).toBe(0);
      const before = createHash("sha256").update(readFileSync(path.join(own, "data", "fairnight.db"))).digest("hex");
      const r = await call(own);
      const lines = r.text.split("\n");
      expect(lines[0]).toBe("Now 2026-11-01 09:00. 0 late.");
      expect(lines).toContainEqual(expect.stringMatching(/^- open: guests at check-in for stay fg[0-9a-f]{10} \(seaview-loft, 2026-11-04 → 2026-11-08\) to Mossos d'Esquadra, due 2026-11-05 16:00, 0 guests registered$/));
      expect(r.data.enabled).toBe(true);
      expect(createHash("sha256").update(readFileSync(path.join(own, "data", "fairnight.db"))).digest("hex")).toBe(before);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });
});
