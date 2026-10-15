/**
 * Holiday homes of the Canary Islands from ISTAC (Instituto Canario de
 * Estadística), open data: the average daily rate (ADR) of the holiday homes of
 * each municipality, month by month, by size (1–4, 5–8, more than 8 guests).
 *
 * Dataset C00065A_000062, "Tarifa media diaria según intervalos de plazas
 * alojativas", read as CSV from the ISTAC API (datos.canarias.es). One call per
 * import, no key.
 *
 * Terms (gobiernodecanarias.org/istac/aviso_legal.html, read 15 October 2026):
 * commercial and non-commercial reuse allowed; cite "Fuente: Instituto Canario
 * de Estadística (ISTAC)" and the date of the last update; never suggest that
 * ISTAC supports the reuse; the API data is shown as it is (our own figures,
 * like the suggested base price, are said to be ours); no repeated requests for
 * the same data in a short time (the figures change once a month).
 *
 * ADR here is ISTAC's "ingresos medios diarios obtenidos por vivienda vacacional
 * ocupada", only for whole homes. ISTAC's booked-homes rate is not used: by its
 * definition (a home counts only if it was booked in the month or the one
 * before) it stays around 95% and says little about demand.
 */
import type { MarketDay } from "fairnight";
import type { FetchLike } from "./airroi.js";
import { monthlyToDays } from "./airroi.js";
import { readCsv } from "./csv-records.js";
import { getText, OpenDataError, type OpenDataOptions } from "./http.js";

export const ISTAC_BASE_URL = "https://datos.canarias.es/api/estadisticas/statistical-resources/v1.0/datasets/ISTAC";
export const ISTAC_DATASET = "C00065A_000062";
export const ISTAC_ATTRIBUTION = "Fuente: Instituto Canario de Estadística (ISTAC)";

/** ISTAC's size bands of a holiday home, by guests ("plazas"). */
export const ISTAC_BANDS = ["_T", "1T4", "5T8", "GT8"] as const;
export type IstacBand = (typeof ISTAC_BANDS)[number];

/** The band of a home for this many guests; every home when unknown. */
export function istacBand(guests: number | undefined): IstacBand {
  if (guests === undefined) return "_T";
  if (guests <= 4) return "1T4";
  if (guests <= 8) return "5T8";
  return "GT8";
}

/** The band as a range of guests: 1–4, 5–8, 9 or more; null for every size. */
export function istacBandGuests(band: IstacBand): { guestsFrom: number; guestsTo?: number } | null {
  if (band === "1T4") return { guestsFrom: 1, guestsTo: 4 };
  if (band === "5T8") return { guestsFrom: 5, guestsTo: 8 };
  if (band === "GT8") return { guestsFrom: 9 };
  return null;
}

export function describeIstacBand(band: IstacBand): string {
  return { _T: "every size", "1T4": "1 to 4 guests", "5T8": "5 to 8 guests", GT8: "more than 8 guests" }[band];
}

/** ISTAC municipality codes are the INE ones: 5 digits, 35… Las Palmas, 38… Santa Cruz de Tenerife. */
export const isIstacMunicipality = (code: string): boolean => /^(35|38)\d{3}$/.test(code);

export interface IstacMonth {
  /** First day of the month, YYYY-MM-01. */
  month: string;
  adr: number;
}

export interface IstacAdr {
  municipality: string;
  /** The municipality's name, as ISTAC writes it. */
  name: string | null;
  band: IstacBand;
  /** Oldest first. */
  months: IstacMonth[];
}

/** Read the CSV of dataset C00065A_000062: keeps one municipality and one band. */
export function parseIstacAdrCsv(text: string, municipality: string, band: IstacBand): IstacAdr {
  const records = readCsv(text, ",");
  const header = records.shift();
  if (!header) throw new OpenDataError("ISTAC sent an empty file.", null);
  const col = (name: string) => header.cells.findIndex((c) => c.trim().toUpperCase() === name);
  const territory = col("TERRITORIO_CODE");
  const time = col("TIME_PERIOD_CODE");
  const bands = col("INTERVALOS_PLAZAS_CODE");
  const measure = col("MEDIDAS_CODE");
  const value = col("OBS_VALUE");
  const nameCol = header.cells.findIndex((c) => /^TERRITORIO(#|$)/i.test(c.trim()));
  if ([territory, time, bands, measure, value].some((i) => i < 0)) {
    throw new OpenDataError("ISTAC sent a file without the expected columns (TERRITORIO_CODE, TIME_PERIOD_CODE, INTERVALOS_PLAZAS_CODE, MEDIDAS_CODE, OBS_VALUE).", null);
  }
  let name: string | null = null;
  const byMonth = new Map<string, number>();
  for (const { cells } of records) {
    if (cells[territory] !== municipality || cells[bands] !== band || cells[measure] !== "ADR") continue;
    const m = /^(\d{4})-M(\d{2})$/.exec(cells[time] ?? "");
    const v = Number(cells[value]);
    if (!m || (cells[value] ?? "") === "" || !Number.isFinite(v) || v <= 0) continue;
    if (nameCol >= 0 && name === null) name = cells[nameCol] ?? null;
    byMonth.set(`${m[1]}-${m[2]}-01`, v);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, adr]) => ({ month, adr }));
  return { municipality, name, band, months };
}

/** Spread the monthly ADR over the nights to price: each night takes the latest same month. */
export function istacToDays(adr: IstacAdr, today: string, days: number): MarketDay[] {
  return monthlyToDays(
    adr.months.map((m) => ({ month: m.month, occupancyPercent: null, averageDailyRate: m.adr, activeListings: null })),
    today,
    days,
  );
}

export interface IstacClientOptions extends OpenDataOptions {
  fetch: FetchLike;
  baseUrl?: string;
}

export class IstacClient {
  calls = 0;
  constructor(private readonly options: IstacClientOptions) {}

  /** Every month of one municipality (all bands): a few hundred lines, one call. */
  async adr(municipality: string, band: IstacBand): Promise<IstacAdr> {
    if (!isIstacMunicipality(municipality)) throw new OpenDataError(`"${municipality}" is not a Canary Islands municipality code (5 digits, like 38001 for Adeje).`, null);
    const url = `${this.options.baseUrl ?? ISTAC_BASE_URL}/${ISTAC_DATASET}/~latest.csv?dim=TERRITORIO:${municipality}`;
    this.calls++;
    const text = await getText(url, "text/csv", "ISTAC", this.options);
    return parseIstacAdrCsv(text, municipality, band);
  }
}
