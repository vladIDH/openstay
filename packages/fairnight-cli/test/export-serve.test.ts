import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { Script } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { startServer } from "../src/serve.js";
import { fakeFetch, fixture, tempDir, testIo } from "./helpers.js";

const AIRBNB = "https://cal.example.org/airbnb/seaview-loft.ics";
const BOOKING = "https://cal.example.org/booking/seaview-loft.ics";
const VRBO = "https://cal.example.org/vrbo/garden-studio.ics";

async function setUp() {
  const dir = tempDir();
  const fetch = fakeFetch({
    [AIRBNB]: fixture("airbnb-esempio.ics"),
    [BOOKING]: fixture("booking-esempio.ics"),
    [VRBO]: fixture("vrbo-esempio.ics"),
  });
  await main(["init"], testIo(dir));
  const file = path.join(dir, "fairnight.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.listings[0].calendars[0].url = AIRBNB;
  config.listings[0].calendars[1].url = BOOKING;
  config.listings[1].calendars[0].url = VRBO;
  writeFileSync(file, JSON.stringify(config));
  await main(["sync"], testIo(dir, fetch));
  return { dir, fetch };
}

describe("fairnight export", () => {
  it("writes date, price and minimum stay of the nights for sale", async () => {
    const { dir } = await setUp();
    const io = testIo(dir);
    expect(await main(["export", "--listing", "seaview-loft", "--days", "10", "--today", "2026-11-01", "--format", "csv"], io)).toBe(0);
    const file = path.join(dir, "exports", "seaview-loft-2026-11-01.csv");
    expect(io.lines).toEqual([`seaview-loft: 5 nights for sale written to ${file}`]);
    expect(readFileSync(file, "utf8")).toBe(
      "date,price,min_stay\r\n2026-11-01,81,1\r\n2026-11-02,85,1\r\n2026-11-03,85,1\r\n2026-11-08,84,2\r\n2026-11-09,88,2\r\n",
    );
  });

  it("writes one file per listing, or one file where --out says", async () => {
    const { dir } = await setUp();
    expect(await main(["export", "--days", "3", "--today", "2026-11-01"], testIo(dir))).toBe(0);
    expect(readdirSync(path.join(dir, "exports")).sort()).toEqual(["garden-studio-2026-11-01.csv", "seaview-loft-2026-11-01.csv"]);
    expect(await main(["export", "--listing", "garden-studio", "--days", "3", "--today", "2026-11-01", "--out", "mine.csv"], testIo(dir))).toBe(0);
    expect(readFileSync(path.join(dir, "mine.csv"), "utf8").split("\r\n")[0]).toBe("date,price,min_stay");
  });

  it("explains why there is no Smoobu format, and rejects bad options", async () => {
    const { dir } = await setUp();
    const smoobu = testIo(dir);
    expect(await main(["export", "--format", "smoobu"], smoobu)).toBe(2);
    expect(smoobu.errors[0]).toMatch(/^Smoobu does not publish a CSV format for importing rates/);
    const other = testIo(dir);
    expect(await main(["export", "--format", "xlsx"], other)).toBe(2);
    expect(other.errors[0]).toBe('Unknown format "xlsx". Formats: csv.');
    const both = testIo(dir);
    expect(await main(["export", "--out", "x.csv"], both)).toBe(2);
    const badDay = testIo(dir);
    expect(await main(["export", "--today", "1/11/2026"], badDay)).toBe(2);
    expect(badDay.errors[0]).toBe('--today must be a date like 2026-11-01, got "1/11/2026"');
  });
});

describe("fairnight serve", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((ok) => s.close(ok));
  });

  async function serve() {
    const { dir, fetch } = await setUp();
    const io = testIo(dir, fetch);
    const server = await startServer({ dir, io, days: 60, today: "2026-11-01", port: 0, lan: false });
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { base, io, fetch };
  }

  it("serves a self-contained page with a strict content policy", async () => {
    const { base, io } = await serve();
    expect(io.lines[0]).toMatch(/^Fairnight calendar: http:\/\/localhost:\d+$/);
    const res = await fetch_(base + "/");
    const html = await res.text();
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/); // nothing loaded from outside
    const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(() => new Script(script)).not.toThrow(); // valid JavaScript
    expect(script).not.toContain("innerHTML");
  });

  it("gives the prices of every listing as data", async () => {
    const { base } = await serve();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await (await fetch_(base + "/api/data")).json();
    expect(data.today).toBe("2026-11-01");
    expect(data.listings.map((l: { name: string }) => l.name)).toEqual(["seaview-loft", "garden-studio"]);
    const loft = data.listings[0];
    expect(loft.nights).toHaveLength(60);
    expect(loft.nights[3]).toMatchObject({ date: "2026-11-04", status: "reserved", price: null });
    expect(loft.nights[0].explanation).toMatch(/^Sun 2026-11-01 · 81 EUR/);
    expect(loft.lastSync).not.toBeNull();
  });

  it("reads the calendars again on Recalculate, only from the page", async () => {
    const { base, fetch } = await serve();
    const before = fetch.calls.length;
    expect((await fetch_(base + "/api/refresh", { method: "POST" })).status).toBe(403);
    const ok = await fetch_(base + "/api/refresh", { method: "POST", headers: { "X-Fairnight": "1" } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { reports: { feed: string; ok: boolean }[] };
    expect(body.reports.map((r: { feed: string; ok: boolean }) => [r.feed, r.ok])).toEqual([
      ["airbnb", true],
      ["booking", true],
      ["vrbo", true],
    ]);
    expect(fetch.calls.length).toBe(before + 3);
    expect((await fetch_(base + "/nope")).status).toBe(404);
    expect((await fetch_(base + "/api/data", { method: "DELETE" })).status).toBe(404);
  });

  it("refuses to start on a broken folder", async () => {
    const dir = tempDir();
    await expect(startServer({ dir, io: testIo(dir), days: 10, port: 0, lan: false })).rejects.toThrow(/fairnight init/);
  });

  it("explains a busy port", async () => {
    const { dir } = await setUp();
    const first = await startServer({ dir, io: testIo(dir), days: 10, port: 0, lan: false });
    servers.push(first);
    const port = (first.address() as { port: number }).port;
    const io = testIo(dir);
    expect(await main(["serve", "--port", String(port)], io)).toBe(1);
    expect(io.errors[0]).toBe(`Port ${port} is already in use: try --port ${port + 1}.`);
    expect(await main(["serve", "--port", "99999"], testIo(dir))).toBe(2);
  });
});

/** The real network client, only ever pointed at the local test server. */
const fetch_ = globalThis.fetch;
