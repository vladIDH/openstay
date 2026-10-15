import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { dbPath, type SmoobuFetchLike } from "../src/io.js";
import { main } from "../src/main.js";
import { loadComparables, loadMarket } from "../src/market-store.js";
import { INE_OFF } from "../src/mercato.js";
import { tempDir, testIo, type TestIo } from "./helpers.js";

const NL = String.fromCharCode(10);

const LOFT = {
  currency: "EUR",
  basePrice: 100,
  defaultMinStay: 2,
  factors: { market: { enabled: true }, rounding: { enabled: true, step: 1 } },
};

async function folder(market?: object, listing: object = {}): Promise<string> {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const config = { ...(market ? { market } : {}), listings: [{ name: "loft", calendars: [], pricing: LOFT, marketArea: "sur", guests: 4, ...listing }] };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(config, null, 2));
  return dir;
}

/** Invented ADR in ISTAC's CSV layout: 12 months, homes for 1–4 guests and all sizes; a quiet November. */
function istacCsv(): string {
  const lines = ["TERRITORIO#es,TERRITORIO_CODE,TIME_PERIOD#es,TIME_PERIOD_CODE,INTERVALOS_PLAZAS#es,INTERVALOS_PLAZAS_CODE,MEDIDAS#es,MEDIDAS_CODE,OBS_VALUE"];
  for (let i = 0; i < 12; i++) {
    const y = 2025 + Math.floor((8 + i) / 12);
    const m = String(((8 + i) % 12) + 1).padStart(2, "0");
    lines.push(`Municipio Inventado,38999,${m}/${y},${y}-M${m},De 1 a 4,1T4,Tarifa media diaria,ADR,${i === 2 ? 60 : 110 + i * 2},`);
    lines.push(`Municipio Inventado,38999,${m}/${y},${y}-M${m},Total,_T,Tarifa media diaria,ADR,${200 + i},`);
  }
  return lines.join(NL) + NL;
}

/** Invented occupancy in INE's table 2083 layout (tip=AM). */
function ineJson(): string {
  const meta = (concept: string) => [
    { T3_Variable: "Concepto turístico", Nombre: concept },
    { T3_Variable: "TIPO DE CATEGORIA", Nombre: "Total categorías" },
    { T3_Variable: "PUNTOS TURISTÍCOS", Nombre: "Punto Inventado" },
  ];
  const data = (v: (i: number) => number) => Array.from({ length: 12 }, (_, i) => ({ T3_Periodo: `M${String(i + 1).padStart(2, "0")}`, Anyo: 2026, Valor: v(i) }));
  return JSON.stringify([
    { COD: "X1", MetaData: meta("Grado de ocupación por apartamentos"), Data: data((i) => (i === 10 ? 90 : 60)) },
    { COD: "X2", MetaData: meta("Número de apartamentos estimados"), Data: data(() => 400) },
  ]);
}

function server(body: string, seen: string[]): SmoobuFetchLike {
  return async (url) => {
    seen.push(url);
    return { status: 200, headers: { get: () => null }, text: async () => body };
  };
}

async function run(dir: string, args: string[], fetch?: SmoobuFetchLike): Promise<{ code: number; io: TestIo }> {
  const io = Object.assign(testIo(dir), fetch ? { openDataFetch: fetch, istacBaseUrl: "http://istac.test", ineBaseUrl: "http://ine.test" } : {});
  const code = await main(args, io);
  return { code, io };
}

describe("fairnight mercato importa --fonte istac", () => {
  it("imports the ADR of the municipality for homes of the listing's size, with ISTAC's citation", async () => {
    const dir = await folder();
    const seen: string[] = [];
    const { code, io } = await run(dir, ["mercato", "importa", "--fonte", "istac", "--zona", "sur", "--comune", "38999", "--ospiti", "4"], server(istacCsv(), seen));
    expect(code).toBe(0);
    expect(seen).toEqual(["http://istac.test/C00065A_000062/~latest.csv?dim=TERRITORIO:38999"]);
    expect(io.lines[0]).toBe(
      'Zone "sur": imported the average daily rate of the holiday homes of Municipio Inventado (1 to 4 guests), 12 months 2025-09 → 2026-08, spread over the next 365 nights.',
    );
    expect(io.lines).toContain("  Fuente: Instituto Canario de Estadística (ISTAC), data up to 2026-08. Only whole homes; ISTAC's booked-homes rate is not used.");
    expect(io.lines.at(-1)).toBe("ISTAC calls: 1.");

    const db = openDb(dbPath(dir));
    const market = loadMarket(db, "sur", "2026-11-01");
    expect(market?.source).toBe("istac");
    expect(market?.days.find((d) => d.date === "2026-11-01")).toEqual({ date: "2026-11-01", averagePrice: 60 });
    expect(loadComparables(db, "sur")).toEqual({ roomType: "whole home", guestsFrom: 1, guestsTo: 4 });
    db.close();

    // The price explains the zone with ISTAC's citation.
    const price = await run(dir, ["price", "--today", "2026-11-01", "--days", "5", "--explain"]);
    expect(price.io.lines.join(NL)).toContain("Fuente: Instituto Canario de Estadística (ISTAC), data up to 2026-08");

    // The suggested base price says which months ISTAC measured.
    const base = await run(dir, ["mercato", "prezzo-base"]);
    expect(base.io.lines[1]).toContain("Suggested base price 121 EUR");
    expect(base.io.lines[1]).toContain("the homes with 1–4 guests, whole home");
    expect(base.io.lines).toContain("  Zone data: ISTAC monthly figures 2025-09 → 2026-08 for Municipio Inventado, each night uses the same month.");
    expect(base.io.lines.some((l) => l.startsWith("  Check:"))).toBe(false);
  });

  it("warns when the listing takes more guests than the ISTAC size band", async () => {
    const dir = await folder(undefined, { guests: 6 });
    await run(dir, ["mercato", "importa", "--fonte", "istac", "--zona", "sur", "--comune", "38999", "--ospiti", "4"], server(istacCsv(), []));
    const base = await run(dir, ["mercato", "prezzo-base"]);
    expect(base.io.lines).toContain("  Check: The zone's homes take 1–4 guests, this listing takes 6.");
  });

  it("writes nothing with --dry-run, and refuses a code outside the Canary Islands", async () => {
    const dir = await folder();
    const dry = await run(dir, ["mercato", "importa", "--fonte", "istac", "--zona", "sur", "--comune", "38999", "--dry-run"], server(istacCsv(), []));
    expect(dry.io.lines[0]).toContain("would import");
    const db = openDb(dbPath(dir));
    expect(loadMarket(db, "sur", "2026-11-01")).toBeNull();
    db.close();
    const seen: string[] = [];
    const bad = await run(dir, ["mercato", "importa", "--fonte", "istac", "--zona", "sur", "--comune", "28079"], server(istacCsv(), seen));
    expect(bad.code).not.toBe(0);
    expect(bad.io.errors.join(" ")).toContain("not a Canary Islands municipality");
    expect(seen).toEqual([]);
    const none = await run(dir, ["mercato", "importa", "--fonte", "istac", "--zona", "sur"], server(istacCsv(), []));
    expect(none.io.errors.join(" ")).toContain("--comune");
  });

  it("says when ISTAC has nothing for the municipality", async () => {
    const dir = await folder();
    const { code, io } = await run(dir, ["mercato", "importa", "--fonte", "istac", "--zona", "sur", "--comune", "38001"], server(istacCsv(), []));
    expect(code).toBe(1);
    expect(io.errors[0]).toContain("ISTAC has no average daily rate for municipality 38001");
  });
});

describe("fairnight mercato importa --fonte ine", () => {
  it("is off by default and asks nothing", async () => {
    const dir = await folder();
    const seen: string[] = [];
    const { code, io } = await run(dir, ["mercato", "importa", "--fonte", "ine", "--zona", "sur", "--punto", "Punto Inventado"], server(ineJson(), seen));
    expect(code).toBe(1);
    expect(io.errors).toEqual([INE_OFF]);
    expect(seen).toEqual([]);
  });

  it("when switched on, imports the season of the tourist point as zone occupancy", async () => {
    const dir = await folder({ ine: { enabled: true } });
    const seen: string[] = [];
    const { code, io } = await run(dir, ["mercato", "importa", "--fonte", "ine", "--zona", "sur", "--punto", "punto inventado"], server(ineJson(), seen));
    expect(code).toBe(0);
    expect(seen).toEqual(["http://ine.test/DATOS_TABLA/2083?nult=24&tip=AM"]);
    expect(io.lines[0]).toContain("tourist apartments of Punto Inventado, 12 months 2026-01 → 2026-12");
    expect(io.lines).toContain("  Elaboración propia con datos extraídos del sitio web del INE: www.ine.es (data up to 2026-12).");
    const price = await run(dir, ["price", "--today", "2026-11-01", "--days", "3", "--explain"]);
    expect(price.io.lines.join(NL)).toContain("Elaboración propia con datos extraídos del sitio web del INE");
    const status = await run(dir, ["mercato", "stato"]);
    expect(status.io.lines.find((l) => l.startsWith("- sur: ine"))).toBeDefined();
  });

  it("lists INE's names when the tourist point is unknown", async () => {
    const dir = await folder({ ine: { enabled: true } });
    const { code, io } = await run(dir, ["mercato", "importa", "--fonte", "ine", "--zona", "sur", "--punto", "Nowhere"], server(ineJson(), []));
    expect(code).toBe(1);
    expect(io.errors[0]).toBe('INE has no tourist point called "Nowhere". Some of its names: Punto Inventado.');
  });

  it("checks market.ine in the config", async () => {
    const dir = await folder({ ine: { enabled: "yes" } });
    const { code, io } = await run(dir, ["mercato", "stato"]);
    expect(code).not.toBe(0);
    expect(io.errors.join(" ")).toContain("config.market.ine.enabled");
    expect(readFileSync(path.join(dir, "fairnight.config.json"), "utf8")).toContain('"yes"');
  });
});
