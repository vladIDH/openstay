/**
 * What Istat needs of each guest, and nothing more: no name, no document.
 * Sex, birth date, citizenship, place of birth and residence, the lodger type
 * of the group, coded with the Alloggiati Web tables as the ROSS1000
 * specification asks (and as Trento and Umbria can use).
 *
 * The record is taken from the guest's data before Alloggiati Web erases it,
 * and is kept sealed until the region has the month.
 */
import { lodgerTypes } from "../italy.js";
import { municipalityCode, stateCode, type AlloggiatiTables } from "../countries/it-alloggiati.js";
import type { Guest, Problem, Stay } from "../types.js";

export interface IstatGuest {
  /** Stable id of the check-in: "<stay>-<n>". */
  id: string;
  /** 16 single, 17/19 family, 18/20 group. */
  type: string;
  /** Id of the head of family or group, for 19 and 20. */
  head: string;
  sex: "M" | "F";
  /** "YYYY-MM-DD". */
  birthDate: string;
  /** Alloggiati Web codes. */
  citizenship: string;
  birthState: string;
  birthMunicipality: string;
  residenceState: string;
  /** ISO alpha-3 of the residence. */
  residenceCountry: string;
  /** Code of the Italian municipality of residence, or the town abroad (at most 30 characters). */
  residencePlace: string;
  /** Province of residence in Italy (Roma = RM), "" abroad. */
  residenceProvince: string;
}

export interface IstatStay {
  checkIn: string;
  checkOut: string;
  guests: IstatGuest[];
}

/** Residence is asked in Italy only when the listing sends Istat data. */
export function residenceProblems(g: Guest, index: number): Problem[] {
  const p = `guests[${index}].address`;
  if (!g.address?.country) return [{ path: `${p}.country`, message: "the country of residence is required" }];
  if (!g.address.locality) return [{ path: `${p}.locality`, message: g.address.country === "ITA" ? "the municipality of residence is required" : "the town of residence is required" }];
  return [];
}

/** The Istat records of a stay, or the problems that stop them. */
export function istatStay(stay: Stay, tables: AlloggiatiTables): { record: IstatStay | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const types = lodgerTypes(stay.guests);
  const ids = stay.guests.map((_, i) => `${stay.id}-${i + 1}`.slice(0, 20));
  const guests = stay.guests.map((g, i): IstatGuest => {
    const p = `guests[${i}]`;
    const add = (path: string, message: string) => problems.push({ path: `${p}.${path}`, message });
    if (g.sex !== "male" && g.sex !== "female") add("sex", "male or female is required");
    if (!g.birthDate) add("birthDate", "the date of birth is required");
    const citizenship = g.nationality ? stateCode(tables, g.nationality) : null;
    if (!citizenship) add("nationality", "the citizenship is missing or not in the Alloggiati Web table");
    const birthState = g.birthPlace?.country ? stateCode(tables, g.birthPlace.country) : null;
    if (!birthState) add("birthPlace.country", "the country of birth is missing or not in the Alloggiati Web table");
    let birthMunicipality = "";
    if (g.birthPlace?.country === "ITA") {
      const m = municipalityCode(tables, g.birthPlace, g.birthDate);
      if ("problem" in m) add("birthPlace.locality", m.problem);
      else birthMunicipality = m.code;
    }
    problems.push(...residenceProblems(g, i));
    const residenceState = g.address?.country ? stateCode(tables, g.address.country) : null;
    if (g.address?.country && !residenceState) add("address.country", "the country of residence is not in the Alloggiati Web table");
    let residencePlace = "";
    let residenceProvince = "";
    if (g.address?.country === "ITA" && g.address.locality) {
      const m = municipalityCode(tables, { country: "ITA", locality: g.address.locality, ...(g.address.province ? { province: g.address.province } : {}) }, undefined);
      if ("problem" in m) add("address.locality", m.problem);
      else {
        residencePlace = m.code;
        residenceProvince = m.province;
      }
    } else if (g.address?.locality) residencePlace = g.address.locality.slice(0, 30);
    return {
      id: ids[i] as string,
      type: types[i] as string,
      head: i === 0 ? "" : (ids[0] as string),
      sex: g.sex === "male" ? "M" : "F",
      birthDate: g.birthDate ?? "",
      citizenship: citizenship ?? "",
      birthState: birthState ?? "",
      birthMunicipality,
      residenceState: residenceState ?? "",
      residenceCountry: g.address?.country ?? "",
      residencePlace,
      residenceProvince,
    };
  });
  if (stay.guests.length === 0) problems.push({ path: "guests", message: "no guest registered" });
  return problems.length > 0 ? { record: null, problems } : { record: { checkIn: stay.checkIn, checkOut: stay.checkOut, guests }, problems };
}
