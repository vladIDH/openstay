import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { loadComparables } from "../src/market-store.js";
import { fromThisComputer, startServer } from "../src/serve.js";
import { dbPath } from "../src/io.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

const LOFT = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 250 } },
};

async function folder(listing: Record<string, unknown> = {}): Promise<string> {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const config = { listings: [{ name: "loft", calendars: [], pricing: LOFT, marketArea: "costa", ...listing }] };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(config, null, 2));
  return dir;
}

/** Invented zone figures: one line per month, November 2025 → October 2026. */
function zoneCsv(prices: number[], comparables = 30): string {
  const lines = ["date,average_price,comparables"];
  prices.forEach((p, i) => {
    const y = 2025 + Math.floor((10 + i) / 12);
    const m = ((10 + i) % 12) + 1;
    lines.push(`${y}-${String(m).padStart(2, "0")}-01,${p},${comparables}`);
  });
  return lines.join("\n") + "\n";
}

const YEAR = [90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145];

async function run(dir: string, args: string[]): Promise<{ code: number; io: TestIo }> {
  const io = testIo(dir);
  const code = await main(args, io);
  return { code, io };
}

const basePrice = (dir: string) =>
  (JSON.parse(readFileSync(path.join(dir, "fairnight.config.json"), "utf8")) as { listings: { pricing: { basePrice: number } }[] }).listings[0]?.pricing.basePrice;

describe("fairnight mercato prezzo-base", () => {
  it("suggests a base price with its explanation and changes nothing", async () => {
    const dir = await folder({ guests: 4 });
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv(YEAR));
    expect((await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--camere", "2", "--ospiti", "4"])).code).toBe(0);

    const { code, io } = await run(dir, ["mercato", "prezzo-base"]);
    expect(code).toBe(0);
    expect(io.lines[0]).toBe("loft (loft):");
    expect(io.lines[1]).toContain(
      'Suggested base price 118 EUR: median of the monthly average price of 30 homes with 2 bedrooms, 4 guests in zone "costa", 2025-11 → 2026-10 (12 months, from 90 EUR to 145 EUR).',
    );
    expect(io.lines[1]).toContain("Your base price is 100 EUR: +18%.");
    expect(io.lines[1]).toContain('Source: your file "zona.csv", read 2026-11-01. Nothing changes until you confirm it.');
    expect(io.lines.some((l) => l.startsWith("  Check:"))).toBe(false);
    expect(io.lines.at(-1)).toBe("To use it: fairnight mercato prezzo-base --listing loft --applica");
    expect(basePrice(dir)).toBe(100);
  });

  it("writes the suggestion only with --applica, for one listing, and keeps a copy", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv(YEAR));
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--camere", "2"]);

    const refused = await run(dir, ["mercato", "prezzo-base", "--applica"]);
    expect(refused.code).not.toBe(0);
    expect(refused.io.errors.join(" ")).toContain("add --listing <name>");
    expect(basePrice(dir)).toBe(100);

    const { code, io } = await run(dir, ["mercato", "prezzo-base", "--listing", "loft", "--applica"]);
    expect(code).toBe(0);
    expect(io.lines.at(-1)).toBe("Base price of loft: 100 → 118 EUR. The previous settings are in fairnight.config.json.bak.");
    expect(basePrice(dir)).toBe(118);
    expect(readFileSync(path.join(dir, "fairnight.config.json.bak"), "utf8")).toContain('"basePrice": 100');

    const again = await run(dir, ["mercato", "prezzo-base", "--listing", "loft", "--applica"]);
    expect(again.io.lines.at(-1)).toBe("Nothing changed: the base price is already the suggested one.");
  });

  it("says when the zone's homes are not like the listing", async () => {
    const dir = await folder({ guests: 6 });
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv(YEAR));
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--ospiti", "4"]);
    const { io } = await run(dir, ["mercato", "prezzo-base"]);
    expect(io.lines).toContain("  Check: The zone's homes take 4 guests, this listing takes 6.");

    const whole = await folder({ guests: 4 });
    writeFileSync(path.join(whole, "zona.csv"), zoneCsv([300, 300, 300, 300, 300, 300]));
    await run(whole, ["mercato", "importa", "zona.csv", "--zona", "costa"]);
    const w = await run(whole, ["mercato", "prezzo-base"]);
    expect(w.io.lines.find((l) => l.includes("for every home of the zone"))).toBeDefined();
    expect(w.io.lines).toContain("  Check: The suggestion is above your ceiling price (250): the ceiling would still apply.");
    expect(w.io.lines[1]).toContain("Very different from yours");
  });

  it("gives no suggestion without enough months, and --applica changes nothing", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv([100, 110, 120]));
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa"]);
    const { code, io } = await run(dir, ["mercato", "prezzo-base", "--listing", "loft", "--applica"]);
    expect(code).toBe(1);
    expect(io.lines[1]).toContain("No base price suggestion");
    expect(io.errors).toContain("Nothing changed: there is no suggestion for this listing.");
    expect(basePrice(dir)).toBe(100);
  });

  it("explains what is missing: no zone, no data", async () => {
    const dir = await folder({ marketArea: undefined });
    const { io } = await run(dir, ["mercato", "prezzo-base"]);
    expect(io.lines[1]).toContain('no zone: add "marketArea"');
    const other = await folder();
    const o = await run(other, ["mercato", "prezzo-base"]);
    expect(o.io.lines[1]).toContain('no data for zone "costa"');
  });

  it("keeps which homes the figures describe, and forgets it with the zone", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv(YEAR));
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--camere", "2", "--ospiti", "4", "--tipo", "entire home"]);
    let db = openDb(dbPath(dir));
    expect(loadComparables(db, "costa")).toEqual({ roomType: "entire home", bedrooms: 2, guests: 4 });
    db.close();
    const status = await run(dir, ["mercato", "stato"]);
    expect(status.io.lines).toContain("  Homes: 2 bedrooms, 4 guests, entire home.");

    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa"]);
    db = openDb(dbPath(dir));
    expect(loadComparables(db, "costa")).toBeNull();
    db.close();
    expect((await run(dir, ["mercato", "stato"])).io.lines).toContain("  Homes: the whole zone.");

    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--camere", "2"]);
    await run(dir, ["mercato", "cancella", "--zona", "costa"]);
    db = openDb(dbPath(dir));
    expect(loadComparables(db, "costa")).toBeNull();
    db.close();
  });

  it("refuses a bad number of guests in the config and on the command line", async () => {
    const dir = await folder({ guests: 0 });
    const bad = await run(dir, ["mercato", "prezzo-base"]);
    expect(bad.code).not.toBe(0);
    expect(bad.io.errors.join(" ")).toContain("guests from 1 to 50");
    const ok = await folder();
    const flag = await run(ok, ["mercato", "importa", "x.csv", "--zona", "costa", "--ospiti", "due"]);
    expect(flag.code).not.toBe(0);
    expect(flag.io.errors.join(" ")).toContain("--ospiti must be a whole number");
  });
});

describe("suggested base price on the calendar page", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((ok) => s.close(ok));
  });

  async function serve(dir: string) {
    const server = await startServer({ dir, io: testIo(dir), days: 30, today: "2026-11-01", port: 0, lan: false, quiet: true });
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  it("sends the facts of the suggestion with the prices", async () => {
    const dir = await folder({ guests: 4 });
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv(YEAR));
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--camere", "2", "--ospiti", "4"]);
    const base = await serve(dir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await (await fetch(base + "/api/data")).json();
    expect(data.local).toBe(true);
    expect(data.listings[0].suggestion).toMatchObject({
      suggested: 118,
      current: 100,
      differencePercent: 18,
      farOff: false,
      months: 12,
      from: "2025-11",
      to: "2026-10",
      comparables: 30,
      homes: { bedrooms: 2, guests: 4 },
      area: "costa",
      warnings: [],
    });
  });

  it("changes the base price only with the header, from this computer, for the figure shown", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv(YEAR));
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--camere", "2"]);
    const base = await serve(dir);
    const post = (body: unknown, headers: Record<string, string> = { "X-Fairnight": "1" }) =>
      fetch(base + "/api/base-price", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

    expect((await post({ listing: "loft", price: 118 }, {})).status).toBe(403);
    expect((await post({ listing: "loft", price: 150 })).status).toBe(409);
    expect((await post({ listing: "nope", price: 118 })).status).toBe(404);
    expect((await post({ listing: "loft" })).status).toBe(400);
    expect(basePrice(dir)).toBe(100);

    const ok = await post({ listing: "loft", price: 118 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ listing: "loft", before: 100, basePrice: 118 });
    expect(basePrice(dir)).toBe(118);
    expect(readFileSync(path.join(dir, "fairnight.config.json.bak"), "utf8")).toContain('"basePrice": 100');
  });

  it("tells requests from this computer from the network", () => {
    const req = (remoteAddress: string) => ({ socket: { remoteAddress } }) as unknown as IncomingMessage;
    expect(fromThisComputer(req("127.0.0.1"))).toBe(true);
    expect(fromThisComputer(req("::1"))).toBe(true);
    expect(fromThisComputer(req("::ffff:127.0.0.1"))).toBe(true);
    expect(fromThisComputer(req("192.168.1.20"))).toBe(false);
  });
});
