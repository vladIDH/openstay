/**
 * Finding a Spanish municipality by its name, for the address of a guest who
 * lives in Spain: the check-in form asks for the town, Fairguest finds its INE
 * code. The code kept is the full one of 6 digits (province, municipality,
 * check digit), as the Mossos d'Esquadra file wants it (manual v8, field 29);
 * SES.HOSPEDAJES takes its first 5 digits («códigos de municipios del INE
 * (5 dígitos)», Instrucciones SES).
 *
 * The names are the INE's, with two kindnesses for people typing them: the
 * article at the end goes back to the front ("Palmas de Gran Canaria, Las" is
 * also "Las Palmas de Gran Canaria"), and a bilingual name answers to each of
 * its halves ("Donostia/San Sebastián", "Vitoria-Gasteiz"). Case and accents never matter.
 */
import { ES_MUNICIPALITIES_RAW, ES_PROVINCES } from "./es-municipalities-data.js";

export interface Municipality {
  /** INE code of 6 digits: CPRO + CMUN + DC. */
  code: string;
  /** The INE's name, article in front: "Las Palmas de Gran Canaria". */
  name: string;
  province: string;
  /** What the form shows and the guest picks: "Adeje (Santa Cruz de Tenerife)". */
  label: string;
}

/** "Palmas de Gran Canaria, Las" → "Las Palmas de Gran Canaria"; the same for each half of "A/B". */
function articleFirst(name: string): string {
  return name
    .split("/")
    .map((part) => {
      const m = /^(.*), (El|La|Los|Las|L'|Lo|Les|Els|Es|Sa|Ses|O|A|Os|As)$/.exec(part.trim());
      if (!m) return part.trim();
      const [, rest, article] = m as unknown as [string, string, string];
      return article.endsWith("'") ? `${article}${rest}` : `${article} ${rest}`;
    })
    .join("/");
}

/** Lower case, no accents, no punctuation: what two spellings of a town have in common. */
export function normalizePlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´.,()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let all: Municipality[] | null = null;
let byKey: Map<string, Municipality[]> | null = null;

/** Every municipality, read from the INE's list the first time it is asked for. */
export function esMunicipalities(): Municipality[] {
  if (all) return all;
  const lines = ES_MUNICIPALITIES_RAW.split("\n");
  byKey = new Map();
  all = lines.map((line) => {
    const code = line.slice(0, 6);
    const official = line.slice(6);
    const name = articleFirst(official);
    const province = ES_PROVINCES[code.slice(0, 2)] ?? "";
    const m: Municipality = { code, name, province, label: `${name} (${province})` };
    const keys = new Set<string>([normalizePlace(m.label), normalizePlace(name), normalizePlace(official)]);
    for (const half of [...name.split("/"), ...official.split("/")]) keys.add(normalizePlace(half));
    // "Vitoria-Gasteiz", "Alegría-Dulantzi": each half of a bilingual name joined by a dash.
    for (const half of name.split(/[/-]/)) if (half.trim().length >= 4) keys.add(normalizePlace(half));
    for (const k of keys) (byKey as Map<string, Municipality[]>).set(k, [...((byKey as Map<string, Municipality[]>).get(k) ?? []), m]);
    return m;
  });
  return all;
}

export type MunicipalityMatch = { municipality: Municipality } | { problem: "not_found" | "ambiguous"; candidates: Municipality[] };

/**
 * The municipality a guest meant. `text` is what they typed or picked from the
 * list; `postalCode`, when given, chooses between towns of the same name (its
 * first two digits are the province) and must agree with the one found.
 */
export function findEsMunicipality(text: string, postalCode?: string): MunicipalityMatch {
  esMunicipalities();
  const found = (byKey as Map<string, Municipality[]>).get(normalizePlace(text)) ?? [];
  const province = postalCode && /^\d{5}$/.test(postalCode) ? postalCode.slice(0, 2) : null;
  const inProvince = province ? found.filter((m) => m.code.startsWith(province)) : found;
  if (found.length === 0) return { problem: "not_found", candidates: [] };
  if (inProvince.length === 1) return { municipality: inProvince[0] as Municipality };
  if (inProvince.length === 0 && found.length === 1) return { municipality: found[0] as Municipality };
  return { problem: "ambiguous", candidates: inProvince.length > 0 ? inProvince : found };
}

/** The municipality of an INE code of 6 digits (or of 5, without the check digit), or null. */
export function esMunicipalityByCode(code: string): Municipality | null {
  const list = esMunicipalities();
  if (/^\d{6}$/.test(code)) return list.find((m) => m.code === code) ?? null;
  if (/^\d{5}$/.test(code)) return list.find((m) => m.code.startsWith(code)) ?? null;
  return null;
}

/** The code SES.HOSPEDAJES takes: the first 5 digits (province and municipality, no check digit). */
export const sesMunicipalityCode = (code: string): string => code.slice(0, 5);
