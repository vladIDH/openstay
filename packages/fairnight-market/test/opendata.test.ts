import { describe, expect, it } from "vitest";
import {
  IneClient,
  inePoints,
  ineToDays,
  istacBand,
  IstacClient,
  istacToDays,
  parseIneTable,
  parseIstacAdrCsv,
  type FetchLike,
} from "../src/index.js";

const NL = String.fromCharCode(10);

/** Invented figures in the layout of ISTAC's CSV (dataset C00065A_000062). */
function istacCsv(): string {
  const lines = [
    "TERRITORIO#es,TERRITORIO_CODE,TIME_PERIOD#es,TIME_PERIOD_CODE,INTERVALOS_PLAZAS#es,INTERVALOS_PLAZAS_CODE,MEDIDAS#es,MEDIDAS_CODE,OBS_VALUE,NOTAS_OBSERVACION#es,CONFIDENCIALIDAD_OBSERVACION#es,ESTADO_OBSERVACION#es",
  ];
  for (let i = 0; i < 14; i++) {
    const y = 2025 + Math.floor((6 + i) / 12);
    const m = String(((6 + i) % 12) + 1).padStart(2, "0");
    lines.push(`Municipio Inventado,38999,${m}/${y},${y}-M${m},De 1 a 4,1T4,Tarifa media diaria,ADR,${100 + i},,,`);
    lines.push(`Municipio Inventado,38999,${m}/${y},${y}-M${m},Total,_T,Tarifa media diaria,ADR,${200 + i},,,`);
  }
  lines.push('"Otro, Inventado",35999,01/2026,2026-M01,Total,_T,Tarifa media diaria,ADR,999,,,');
  lines.push("Municipio Inventado,38999,02/2026,2026-M02,De 5 a 8,5T8,Tarifa media diaria,ADR,,,,");
  return lines.join(NL) + NL;
}

function fakeFetch(body: string, status = 200, seen: string[] = []): FetchLike {
  return async (url) => {
    seen.push(url);
    return { status, headers: { get: () => null }, text: async () => body };
  };
}

describe("ISTAC holiday homes (ADR by municipality)", () => {
  it("keeps one municipality and one size band, oldest month first", () => {
    const r = parseIstacAdrCsv(istacCsv(), "38999", "1T4");
    expect(r.name).toBe("Municipio Inventado");
    expect(r.months).toHaveLength(14);
    expect(r.months[0]).toEqual({ month: "2025-07-01", adr: 100 });
    expect(r.months.at(-1)).toEqual({ month: "2026-08-01", adr: 113 });
    expect(parseIstacAdrCsv(istacCsv(), "38999", "5T8").months).toEqual([]);
    expect(parseIstacAdrCsv(istacCsv(), "35999", "_T").months).toEqual([{ month: "2026-01-01", adr: 999 }]);
  });

  it("chooses the size band from the listing's guests", () => {
    expect(istacBand(undefined)).toBe("_T");
    expect(istacBand(2)).toBe("1T4");
    expect(istacBand(4)).toBe("1T4");
    expect(istacBand(5)).toBe("5T8");
    expect(istacBand(9)).toBe("GT8");
  });

  it("spreads each month over the nights ahead (the latest same month wins)", () => {
    const r = parseIstacAdrCsv(istacCsv(), "38999", "_T");
    const days = istacToDays(r, "2026-11-01", 365);
    expect(days[0]).toEqual({ date: "2026-11-01", averagePrice: 204 });
    expect(days.find((d) => d.date === "2027-07-15")).toEqual({ date: "2027-07-15", averagePrice: 212 });
    expect(days.every((d) => d.occupancyPercent === undefined)).toBe(true);
  });

  it("makes one call to the dataset of the municipality, and refuses other codes", async () => {
    const seen: string[] = [];
    const client = new IstacClient({ fetch: fakeFetch(istacCsv(), 200, seen), baseUrl: "http://127.0.0.1:1" });
    const r = await client.adr("38999", "1T4");
    expect(r.months).toHaveLength(14);
    expect(client.calls).toBe(1);
    expect(seen).toEqual(["http://127.0.0.1:1/C00065A_000062/~latest.csv?dim=TERRITORIO:38999"]);
    await expect(client.adr("28079", "_T")).rejects.toThrow(/not a Canary Islands municipality/);
  });

  it("explains an error answer, after retrying a busy server", async () => {
    let n = 0;
    const busy: FetchLike = async () => ({ status: n++ < 1 ? 503 : 404, headers: { get: () => null }, text: async () => "" });
    const client = new IstacClient({ fetch: busy, sleep: async () => {} });
    await expect(client.adr("38999", "_T")).rejects.toThrow("ISTAC answered HTTP 404.");
    expect(n).toBe(2);
  });
});

/** Invented series in the layout of INE table 2083 with tip=AM. */
function ineTable(): unknown {
  const meta = (concept: string, point: string, category = "Total categorías") => [
    { T3_Variable: "Concepto turístico", Nombre: concept },
    { T3_Variable: "TIPO DE CATEGORIA", Nombre: category },
    { T3_Variable: "PUNTOS TURISTÍCOS", Nombre: point },
  ];
  const data = (values: number[]) =>
    values.map((Valor, i) => ({ T3_Periodo: `M${String(i + 1).padStart(2, "0")}`, Anyo: 2026, Valor, Secreto: false }));
  return [
    { COD: "X1", MetaData: meta("Grado de ocupación por apartamentos", "Punto Inventado"), Data: data([50, 55, 60, 70, 65, 72, 85, 90]) },
    { COD: "X2", MetaData: meta("Número de apartamentos estimados", "Punto Inventado"), Data: data([300, 300, 300, 310, 310, 310, 320, 320]) },
    { COD: "X3", MetaData: meta("Grado de ocupación por apartamentos", "Punto Inventado", "1 estrella"), Data: data([10, 10, 10, 10, 10, 10, 10, 10]) },
    { COD: "X4", MetaData: meta("Grado de ocupación por plazas", "Punto Inventado"), Data: data([1, 1, 1, 1, 1, 1, 1, 1]) },
    { COD: "X5", MetaData: meta("Grado de ocupación por apartamentos", "Otro Punto"), Data: data([40]) },
  ];
}

describe("INE tourist apartments (occupancy by tourist point)", () => {
  it("keeps the occupancy by apartments of all categories, with the apartments counted", () => {
    const r = parseIneTable(ineTable(), "punto inventado");
    expect(r?.point).toBe("Punto Inventado");
    expect(r?.months[0]).toEqual({ month: "2026-01-01", occupancyPercent: 50, apartments: 300 });
    expect(r?.months).toHaveLength(8);
    expect(parseIneTable(ineTable(), "Nowhere")).toBeNull();
    expect(inePoints(ineTable())).toEqual(["Otro Punto", "Punto Inventado"]);
  });

  it("spreads the season over the nights ahead", () => {
    const r = parseIneTable(ineTable(), "Punto Inventado");
    if (!r) throw new Error("no point");
    const days = ineToDays(r, "2026-11-01", 365);
    expect(days[0]?.date).toBe("2027-01-01");
    expect(days[0]).toEqual({ date: "2027-01-01", occupancyPercent: 50, comparables: 300 });
  });

  it("makes one call for the last 24 months", async () => {
    const seen: string[] = [];
    const client = new IneClient({ fetch: fakeFetch(JSON.stringify(ineTable()), 200, seen), baseUrl: "http://127.0.0.1:1" });
    expect(Array.isArray(await client.table())).toBe(true);
    expect(seen).toEqual(["http://127.0.0.1:1/DATOS_TABLA/2083?nult=24&tip=AM"]);
    const bad = new IneClient({ fetch: fakeFetch("<html>") });
    await expect(bad.table()).rejects.toThrow(/not JSON/);
  });
});
