import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeAirRoi, type FakeAirRoi } from "../../fairnight-market/test/fake-airroi.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { loadMarket } from "../src/market-store.js";
import { AIRROI_OFF } from "../src/mercato.js";
import { dbPath } from "../src/io.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

/** Invented key, only valid on the fake AirROI server. */
const KEY = "airroi-key-0000-not-real";

let fake: FakeAirRoi | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

const LOFT = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: { market: { enabled: true }, rounding: { enabled: true, step: 1 } },
};

async function folder(config: { market?: object; marketArea?: string; pricing?: object } = {}): Promise<string> {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const listing: Record<string, unknown> = { name: "loft", calendars: [], pricing: config.pricing ?? LOFT };
  if (config.marketArea !== undefined) listing.marketArea = config.marketArea;
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ ...(config.market ? { market: config.market } : {}), listings: [listing] }, null, 2));
  return dir;
}

/** November 2026, 60% booked every night except Saturday the 14th at 90%. Invented. */
function zoneCsv(): string {
  const lines = ["date,occupancy,average_price,comparables"];
  for (let d = 1; d <= 30; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    lines.push(`${date},${d === 14 ? 90 : 60},100,25`);
  }
  return lines.join("\n") + "\n";
}

async function run(dir: string, args: string[], extra: Partial<TestIo> = {}): Promise<{ code: number; io: TestIo }> {
  const io = Object.assign(testIo(dir), extra);
  const code = await main(args, io);
  return { code, io };
}

const all = (io: TestIo) => [...io.lines, ...io.errors].join("\n");

describe("fairnight mercato importa (CSV)", () => {
  it("imports the host's own zone file and the price explains the zone demand", async () => {
    const dir = await folder({ marketArea: "costa" });
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv());
    const imp = await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa"]);
    expect(imp.code).toBe(0);
    expect(imp.io.lines).toContain('Zone "costa": imported 30 nights from zona.csv (2026-11-01 → 2026-11-30).');
    expect(imp.io.lines).toContain('loft: uses zone "costa"; zone demand factor on.');

    const price = await run(dir, ["price", "--today", "2026-11-01", "--days", "20", "--explain"]);
    const sat = price.io.lines.find((l) => l.startsWith("Sat 2026-11-14")) as string;
    // 90% vs 61% average: +47.5%, half of it +23.8%, capped at +15%.
    expect(sat).toContain('zone demand "costa" +15% = 115 (zone 90% booked vs 61% average · capped at +15% · 25 comparable listings · your file "zona.csv"');
    expect(price.io.lines.find((l) => l.startsWith("Fri 2026-11-13"))).toContain("· 100 EUR: base 100.");
  });

  it("writes nothing with --dry-run", async () => {
    const dir = await folder({ marketArea: "costa" });
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv());
    const { io } = await run(dir, ["mercato", "importa", "zona.csv", "--zona", "costa", "--dry-run"]);
    expect(io.lines[0]).toBe('Zone "costa": would import 30 nights from zona.csv (2026-11-01 → 2026-11-30).');
    const db = openDb(dbPath(dir));
    expect(loadMarket(db, "costa", "2026-11-01")).toBeNull();
    db.close();
  });

  it("needs a valid zone name and a readable file", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv());
    expect((await run(dir, ["mercato", "importa", "zona.csv"])).io.errors[0]).toContain("Which zone?");
    expect((await run(dir, ["mercato", "importa", "zona.csv", "--zona", "Costa Sur"])).io.errors[0]).toContain("--zona must use lowercase");
    expect((await run(dir, ["mercato", "importa", "nope.csv", "--zona", "costa"])).io.errors[0]).toContain("no such file");
  });

  it("changes no price when the factor is on but the zone has no data", async () => {
    const dir = await folder({ marketArea: "costa" });
    const price = await run(dir, ["price", "--today", "2026-11-01", "--days", "3", "--explain"]);
    expect(price.io.lines.filter((l) => l.includes("zone demand"))).toEqual([]);
    const status = await run(dir, ["mercato", "stato"]);
    expect(status.io.lines).toContain("- loft: zone costa (NO DATA: nothing changes until you import it), zone demand on (weight 0.5, at most +15% / -10%).");
  });
});

describe("fairnight mercato importa (Inside Airbnb)", () => {
  const LISTINGS = [
    "id,name,description,neighbourhood_cleansed,room_type,bedrooms",
    '1,Invented A,"Two lines,\nof text",Playa Ficticia,Entire home/apt,2',
    "2,Invented B,x,Playa Ficticia,Entire home/apt,2",
    "3,Invented C,x,Playa Ficticia,Private room,1",
  ].join("\n");

  function calendar(): string {
    const lines = ["listing_id,date,available,price,adjusted_price,minimum_nights,maximum_nights"];
    for (const id of [1, 2, 3]) {
      for (let d = 1; d <= 30; d++) {
        const date = `2026-11-${String(d).padStart(2, "0")}`;
        // Both comparables closed on the 14th, one of two on the other nights.
        const closed = d === 14 ? id !== 3 : id === 1 && d % 2 === 0;
        lines.push(`${id},${date},${closed ? "f" : "t"},$100.00,,2,30`);
      }
    }
    return lines.join("\n") + "\n";
  }

  it("reads the downloaded .gz files, keeps comparables and says the occupancy is an estimate", async () => {
    const dir = await folder({ marketArea: "playa" });
    writeFileSync(path.join(dir, "calendar.csv.gz"), gzipSync(calendar()));
    writeFileSync(path.join(dir, "listings.csv.gz"), gzipSync(LISTINGS));
    const imp = await run(dir, ["mercato", "importa", "calendar.csv.gz", "--zona", "playa", "--annunci", "listings.csv.gz", "--tipo", "Entire home/apt", "--camere", "2"]);
    expect(imp.code).toBe(0);
    expect(imp.io.lines).toContain("2 comparable listings of 3 in listings.csv.gz.");
    expect(imp.io.lines).toContain('Zone "playa": imported 30 nights (2026-11-01 → 2026-11-30) from 2 listings of Inside Airbnb.');
    expect(all(imp.io)).toContain("Occupancy is an estimate");
    expect(all(imp.io)).toContain("Inside Airbnb (insideairbnb.com), CC BY 4.0");
    expect((await run(dir, ["mercato", "stato"])).io.lines).toContain("  Homes: 2 bedrooms, Entire home/apt.");

    // Only 2 comparables: below the default minimum of 5, the zone is not used.
    const strict = await run(dir, ["price", "--today", "2026-11-01", "--days", "20", "--explain"]);
    expect(strict.io.lines.filter((l) => l.includes("zone demand"))).toEqual([]);

    const config = JSON.parse(readFileSync(path.join(dir, "fairnight.config.json"), "utf8"));
    config.listings[0].pricing.factors.market.minComparables = 2;
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(config));
    const price = await run(dir, ["price", "--today", "2026-11-01", "--days", "20", "--explain"]);
    const sat = price.io.lines.find((l) => l.startsWith("Sat 2026-11-14")) as string;
    expect(sat).toContain("2 comparable listings · Inside Airbnb (insideairbnb.com), CC BY 4.0, occupancy estimated");
  });

  it("asks for the listings file before filtering", async () => {
    const dir = await folder();
    writeFileSync(path.join(dir, "calendar.csv"), calendar());
    const r = await run(dir, ["mercato", "importa", "calendar.csv", "--zona", "playa", "--camere", "2"]);
    expect(r.code).toBe(1);
    expect(r.io.errors[0]).toContain("need the listings file too");
  });
});

describe("fairnight mercato with AirROI", () => {
  const AREAS = { costa: { country: "Spain", region: "Isla Ficticia", locality: "Costa Inventada", roomType: "entire_home" } };

  it("is off by default: collega and importa refuse without asking or calling anything", async () => {
    fake = await startFakeAirRoi({ apiKey: KEY });
    const dir = await folder({ market: { airroi: { enabled: false, areas: AREAS } }, marketArea: "costa" });
    let asked = false;
    const prompt = async () => {
      asked = true;
      return KEY;
    };
    const c = await run(dir, ["mercato", "collega"], { prompt });
    expect(c.code).toBe(1);
    expect(c.io.errors).toEqual([AIRROI_OFF]);
    expect(AIRROI_OFF).toContain("in attesa di conferma scritta da AirROI sui termini d'uso");
    expect(asked).toBe(false);
    expect(existsSync(path.join(dir, "airroi-credentials.json"))).toBe(false);

    const i = await run(dir, ["mercato", "importa", "--fonte", "airroi"], { env: { AIRROI_API_KEY: KEY }, airroiBaseUrl: fake.url });
    expect(i.code).toBe(1);
    expect(fake.requests).toEqual([]);
    expect((await run(dir, ["mercato", "stato"])).io.lines.at(-1)).toBe("AirROI: off, in attesa di conferma scritta da AirROI sui termini d'uso.");
  });

  it("when switched on: saves the key, reads zone metrics, attributes them and keeps them 30 days", async () => {
    fake = await startFakeAirRoi({ apiKey: KEY });
    const dir = await folder({ market: { airroi: { enabled: true, areas: AREAS } }, marketArea: "costa" });
    const c = await run(dir, ["mercato", "collega"], { prompt: async () => KEY });
    expect(c.code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, "airroi-credentials.json"), "utf8"))).toEqual({ apiKey: KEY });
    expect(fake.requests).toEqual([]); // no billed call just to save the key

    const net = { airroiBaseUrl: fake.url, airroiFetch: (url: string, init: RequestInit) => fetch(url, init) } as Partial<TestIo>;
    const i = await run(dir, ["mercato", "importa", "--fonte", "airroi", "--zona", "costa"], net);
    expect(i.code).toBe(0);
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /markets/metrics/all"]);
    expect(fake.requests[0]?.key).toBe(KEY);
    expect(i.io.lines).toContain('Zone "costa": 12 months from AirROI, spread over the next 365 nights (powered by AirROI).');
    expect(all(i.io)).toContain("Kept until 2026-12-01, then deleted");
    expect(i.io.lines.at(-1)).toBe("AirROI calls: 1, billed to your AirROI account.");

    // August is the busiest invented month: 90% vs the 12-month average.
    const price = await run(dir, ["price", "--today", "2026-11-01", "--days", "300", "--explain"]);
    expect(price.io.lines.find((l) => l.startsWith("Sat 2027-08-14"))).toContain("· powered by AirROI · read 2026-11-01");
    for (const out of [c.io, i.io, price.io]) expect(all(out)).not.toContain(KEY);

    // After 30 days the data is no longer used, and it is deleted.
    const later = testIo(dir, undefined, "2026-12-01T09:00:00Z");
    expect(await main(["mercato", "stato"], later)).toBe(0);
    expect(later.lines[0]).toBe('Zone "costa": AirROI data older than 30 days, deleted.');
    const db = openDb(dbPath(dir));
    expect((db.prepare("SELECT COUNT(*) AS n FROM market_days").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("deletes AirROI data on request", async () => {
    fake = await startFakeAirRoi({ apiKey: KEY });
    const dir = await folder({ market: { airroi: { enabled: true, areas: AREAS } }, marketArea: "costa" });
    writeFileSync(path.join(dir, "zona.csv"), zoneCsv());
    await run(dir, ["mercato", "importa", "zona.csv", "--zona", "mia"]);
    await run(dir, ["mercato", "importa", "--fonte", "airroi"], { env: { AIRROI_API_KEY: KEY }, airroiBaseUrl: fake.url });
    const d = await run(dir, ["mercato", "cancella", "--fonte", "airroi"]);
    expect(d.io.lines[0]).toBe("Deleted the data of 1 zone: costa.");
    const db = openDb(dbPath(dir));
    expect(loadMarket(db, "costa", "2026-11-01")).toBeNull();
    expect(loadMarket(db, "mia", "2026-11-01")?.days).toHaveLength(30);
    db.close();
  });

  it("explains a refused key without printing it", async () => {
    fake = await startFakeAirRoi({ apiKey: "the-right-invented-key" });
    const dir = await folder({ market: { airroi: { enabled: true, areas: AREAS } } });
    const r = await run(dir, ["mercato", "importa", "--fonte", "airroi"], { env: { AIRROI_API_KEY: KEY }, airroiBaseUrl: fake.url });
    expect(r.code).toBe(1);
    expect(r.io.errors[0]).toContain("AirROI refused the API key (HTTP 401)");
    expect(all(r.io)).not.toContain(KEY);
  });
});
