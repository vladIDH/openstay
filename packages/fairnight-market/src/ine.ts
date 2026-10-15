/**
 * Tourist apartments of Spain from INE (Instituto Nacional de Estadística),
 * "Encuesta de Ocupación en Apartamentos Turísticos": the occupancy of the
 * registered tourist apartments of each tourist point (Adeje, Arona, Benidorm…),
 * month by month. Only as the zone's SEASON: these are registered apartment
 * complexes, not holiday homes, and there are no prices.
 *
 * Table 2083, "Plazas, apartamentos, grados de ocupación y personal empleado
 * por puntos turísticos", read as JSON from the INE API (servicios.ine.es,
 * wstempus). One call per import, no key.
 *
 * SWITCHED OFF in Fairnight (market.ine.enabled) while the licence is unclear:
 * INE's legal notice gives "Creative Commons Reconocimiento 4.0 (CC BY 4.0)" for
 * the statistical information, while the footer of the same site says
 * "Este sitio web y su contenido están bajo licencia CC BY-SA 4.0" (read on
 * 15 October 2026). The citation INE asks for, with our own processing, is
 * "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es".
 */
import type { MarketDay } from "fairnight";
import type { FetchLike } from "./airroi.js";
import { monthlyToDays } from "./airroi.js";
import { getText, OpenDataError, plainName, type OpenDataOptions } from "./http.js";

export const INE_BASE_URL = "https://servicios.ine.es/wstempus/js/es";
export const INE_TABLE = 2083;
export const INE_ATTRIBUTION = "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es";

const OCCUPANCY = "grado de ocupacion por apartamentos";
const APARTMENTS = "numero de apartamentos estimados";
const ALL_CATEGORIES = "total categorias";

export interface IneMonth {
  /** YYYY-MM-01. */
  month: string;
  occupancyPercent: number;
  apartments: number | null;
}

export interface IneTouristPoint {
  point: string;
  months: IneMonth[];
}

interface Series {
  COD?: unknown;
  MetaData?: { T3_Variable?: unknown; Nombre?: unknown }[];
  Data?: { Anyo?: unknown; T3_Periodo?: unknown; Valor?: unknown; Secreto?: unknown }[];
}

function meta(s: Series, variable: string): string | null {
  const m = s.MetaData?.find((x) => typeof x.T3_Variable === "string" && plainName(x.T3_Variable).startsWith(variable));
  return typeof m?.Nombre === "string" ? m.Nombre : null;
}

function monthly(s: Series): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of s.Data ?? []) {
    const p = /^M(\d{2})$/.exec(String(d.T3_Periodo ?? ""));
    if (!p || typeof d.Anyo !== "number" || typeof d.Valor !== "number" || d.Secreto === true) continue;
    out.set(`${d.Anyo}-${p[1]}-01`, d.Valor);
  }
  return out;
}

/** Every tourist point of the table (for "which name?" messages). */
export function inePoints(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  const names = new Set<string>();
  for (const s of json as Series[]) {
    const p = meta(s, "puntos turist");
    if (p) names.add(p);
  }
  return [...names].sort();
}

/** Read table 2083 (with tip=AM) and keep one tourist point, all categories. */
export function parseIneTable(json: unknown, point: string): IneTouristPoint | null {
  if (!Array.isArray(json)) throw new OpenDataError("INE sent something that is not the expected table.", null);
  const wanted = plainName(point);
  let occupancy: Map<string, number> | null = null;
  let apartments: Map<string, number> | null = null;
  let name = point;
  for (const s of json as Series[]) {
    const p = meta(s, "puntos turist");
    if (p === null || plainName(p) !== wanted) continue;
    const category = meta(s, "tipo de categoria");
    if (category !== null && plainName(category) !== ALL_CATEGORIES) continue;
    const concept = plainName(meta(s, "concepto turistico") ?? "");
    if (concept === OCCUPANCY) {
      occupancy = monthly(s);
      name = p;
    } else if (concept === APARTMENTS) apartments = monthly(s);
  }
  if (occupancy === null) return null;
  const months = [...occupancy.entries()]
    .filter(([, v]) => v >= 0 && v <= 100)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, occupancyPercent]) => ({ month, occupancyPercent, apartments: apartments?.get(month) ?? null }));
  return { point: name, months };
}

/** Spread the monthly occupancy over the nights to price: each night takes the latest same month. */
export function ineToDays(point: IneTouristPoint, today: string, days: number): MarketDay[] {
  return monthlyToDays(
    point.months.map((m) => ({ month: m.month, occupancyPercent: m.occupancyPercent, averageDailyRate: null, activeListings: m.apartments })),
    today,
    days,
  );
}

export interface IneClientOptions extends OpenDataOptions {
  fetch: FetchLike;
  baseUrl?: string;
}

export class IneClient {
  calls = 0;
  constructor(private readonly options: IneClientOptions) {}

  /** The last 24 months of every tourist point: one call. */
  async table(): Promise<unknown> {
    const url = `${this.options.baseUrl ?? INE_BASE_URL}/DATOS_TABLA/${INE_TABLE}?nult=24&tip=AM`;
    this.calls++;
    const text = await getText(url, "application/json", "INE", this.options);
    try {
      return JSON.parse(text);
    } catch {
      throw new OpenDataError("INE answered with something that is not JSON.", null);
    }
  }
}
