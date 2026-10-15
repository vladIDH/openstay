/**
 * The Istat files of the regions without a web service we can use, and the
 * month's figures for those that take them only by hand.
 *
 * - Trento, ISTATalloggi (specification v. 30/09/2024): CSV
 *   "CIPAT;arrival;departure;provenance;people", one line per stay and
 *   provenance. Provenance: the province (MI) for Italians, a three-letter
 *   code for foreigners (the example shows DEU) [NV: the ISPAT list].
 * - Umbria, Turismatica: one text file per day with the C/59 print, as in
 *   "Acquisizione automatica dati da file di stampa C59 – tracciato record".
 *   The portal reads the provenance code, and the description when the code
 *   is not one of its own [NV: its codes]; we write both.
 */
import { ALPHA3_TO_ALPHA2 } from "../countries-iso.js";
import { addDays } from "../dates.js";
import type { IstatStay } from "./record.js";

/** Province of Italy by its plate letters (Roma = RM), for the descriptions. */
export const PROVINCES: Record<string, string> = {
  AG: "Agrigento", AL: "Alessandria", AN: "Ancona", AO: "Aosta", AP: "Ascoli Piceno", AQ: "L'Aquila", AR: "Arezzo", AT: "Asti", AV: "Avellino",
  BA: "Bari", BG: "Bergamo", BI: "Biella", BL: "Belluno", BN: "Benevento", BO: "Bologna", BR: "Brindisi", BS: "Brescia", BT: "Barletta-Andria-Trani", BZ: "Bolzano",
  CA: "Cagliari", CB: "Campobasso", CE: "Caserta", CH: "Chieti", CL: "Caltanissetta", CN: "Cuneo", CO: "Como", CR: "Cremona", CS: "Cosenza", CT: "Catania", CZ: "Catanzaro",
  EN: "Enna", FC: "Forlì-Cesena", FE: "Ferrara", FG: "Foggia", FI: "Firenze", FM: "Fermo", FR: "Frosinone", GE: "Genova", GO: "Gorizia", GR: "Grosseto",
  IM: "Imperia", IS: "Isernia", KR: "Crotone", LC: "Lecco", LE: "Lecce", LI: "Livorno", LO: "Lodi", LT: "Latina", LU: "Lucca",
  MB: "Monza e della Brianza", MC: "Macerata", ME: "Messina", MI: "Milano", MN: "Mantova", MO: "Modena", MS: "Massa-Carrara", MT: "Matera",
  NA: "Napoli", NO: "Novara", NU: "Nuoro", OR: "Oristano", PA: "Palermo", PC: "Piacenza", PD: "Padova", PE: "Pescara", PG: "Perugia", PI: "Pisa", PN: "Pordenone", PO: "Prato",
  PR: "Parma", PT: "Pistoia", PU: "Pesaro e Urbino", PV: "Pavia", PZ: "Potenza", RA: "Ravenna", RC: "Reggio Calabria", RE: "Reggio Emilia", RG: "Ragusa", RI: "Rieti",
  RM: "Roma", RN: "Rimini", RO: "Rovigo", SA: "Salerno", SI: "Siena", SO: "Sondrio", SP: "La Spezia", SR: "Siracusa", SS: "Sassari", SU: "Sud Sardegna", SV: "Savona",
  TA: "Taranto", TE: "Teramo", TN: "Trento", TO: "Torino", TP: "Trapani", TR: "Terni", TS: "Trieste", TV: "Treviso", UD: "Udine",
  VA: "Varese", VB: "Verbano-Cusio-Ossola", VC: "Vercelli", VE: "Venezia", VI: "Vicenza", VR: "Verona", VT: "Viterbo", VV: "Vibo Valentia",
};

const italianNames = new Intl.DisplayNames(["it"], { type: "region" });

/** Where a guest comes from, as the statistics count it: an Italian province or a foreign country. */
export function provenance(g: { residenceCountry: string; residenceProvince: string }): { code: string; description: string } {
  if (g.residenceCountry === "ITA") return { code: g.residenceProvince, description: PROVINCES[g.residenceProvince] ?? g.residenceProvince };
  const a2 = ALPHA3_TO_ALPHA2.get(g.residenceCountry);
  return { code: g.residenceCountry, description: (a2 ? italianNames.of(a2) : undefined) ?? g.residenceCountry };
}

const compact = (d: string) => d.replaceAll("-", "");

/** Trento: the lines of the stays arriving in the period, grouped by provenance. */
export function trentoCsv(cipat: string, stays: IstatStay[]): string {
  const lines: string[] = [];
  for (const s of [...stays].sort((a, b) => a.checkIn.localeCompare(b.checkIn))) {
    const groups = new Map<string, number>();
    for (const g of s.guests) {
      const p = provenance(g).code;
      groups.set(p, (groups.get(p) ?? 0) + 1);
    }
    for (const [p, n] of groups) lines.push([cipat, compact(s.checkIn), compact(s.checkOut), p, String(Math.min(n, 99))].join(";"));
  }
  return lines.join("\r\n");
}

/** Who is there on each night and who comes and goes on a day, from the stays. */
export function dayFigures(stays: IstatStay[], day: string) {
  const before = addDays(day, -1);
  const present = (d: string) => stays.filter((s) => s.checkIn <= d && d < s.checkOut);
  const presentBefore = present(before).reduce((n, s) => n + s.guests.length, 0);
  const arriving = stays.filter((s) => s.checkIn === day).flatMap((s) => s.guests);
  const leaving = stays.filter((s) => s.checkOut === day).flatMap((s) => s.guests);
  return { presentBefore, arriving, leaving, roomsOccupied: present(day).length > 0, presentTonight: presentBefore + arriving.length - leaving.length };
}

const num = (n: number, width: number) => String(n).padStart(width, " ");
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** Umbria: the C/59 print of one day (name ggmmaaaa.txt). */
export function umbriaDay(structureName: string, rooms: number, stays: IstatStay[], day: string): { name: string; text: string } {
  const f = dayFigures(stays, day);
  const label = (text: string, n: number) => text.padEnd(27, " ") + num(n, 5);
  const rows = new Map<string, { description: string; arr: number; par: number }>();
  for (const [list, key] of [
    [f.arriving, "arr"],
    [f.leaving, "par"],
  ] as const) {
    for (const g of list) {
      const p = provenance(g);
      const row = rows.get(p.code) ?? { description: p.description, arr: 0, par: 0 };
      row[key]++;
      rows.set(p.code, row);
    }
  }
  const lines = [
    structureName.slice(0, 255),
    "",
    label("Presenti notte precedente", f.presentBefore),
    label("Arrivati", f.arriving.length),
    label("Totale", f.presentBefore + f.arriving.length),
    label("Partiti", f.leaving.length),
    label("Presenti nella notte", f.presentTonight),
    `CAMERE OCCUPATE=${num(f.roomsOccupied ? rooms : 0, 3)}`,
    `ARRIVATI E PARTITI DEL GIORNO ${ddmmyyyy(day)}`,
    "",
    "Provenienza                                   |ARR. |PAR.",
    ...[...rows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, r]) => `${code.padEnd(5, " ").slice(0, 5)} ${r.description.padEnd(35, " ").slice(0, 35)} ${num(r.arr, 5)} ${num(r.par, 5)}`),
  ];
  // Positions of the specification: numbers at column 28, rooms at 17, date at 31, provenance at 1, 7, 43, 49.
  return { name: `${ddmmyyyy(day).replaceAll("-", "")}.txt`, text: lines.join("\r\n") };
}

/** The month's figures for the regions that take them only by hand: arrivals and nights by provenance. */
export function monthSummary(stays: IstatStay[], month: string): { provenance: string; description: string; arrivals: number; nights: number }[] {
  const rows = new Map<string, { provenance: string; description: string; arrivals: number; nights: number }>();
  const first = `${month}-01`;
  const next = addDays(`${month}-28`, 4).slice(0, 7);
  const last = `${next}-01`;
  for (const s of stays) {
    const from = s.checkIn > first ? s.checkIn : first;
    const to = s.checkOut < last ? s.checkOut : last;
    const nights = Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
    const arrivesInMonth = s.checkIn.startsWith(month);
    if (!arrivesInMonth && nights === 0) continue;
    for (const g of s.guests) {
      const p = provenance(g);
      const row = rows.get(p.code) ?? { provenance: p.code, description: p.description, arrivals: 0, nights: 0 };
      if (arrivesInMonth) row.arrivals++;
      row.nights += nights;
      rows.set(p.code, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.nights - a.nights || a.provenance.localeCompare(b.provenance));
}
