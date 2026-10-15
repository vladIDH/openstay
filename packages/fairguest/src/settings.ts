/**
 * The "fairguest" block of a listing in fairnight.config.json:
 *
 *   "fairguest": {
 *     "country": "ES-CT",               // ES = SES.HOSPEDAJES, ES-CT = Mossos d'Esquadra
 *     "establishment": "ZZ00000000",     // the code the authority gave the listing
 *     "establishmentName": "Casa Prova", // needed in the Mossos file
 *     "professional": false,             // registered in the Censo de Empresarios?
 *     "checkInTime": "16:00", "checkOutTime": "10:00", "rooms": 1, "internet": true
 *   }
 *
 * In Italy ("country": "IT", Alloggiati Web) "establishment" is a code of the
 * listing for the host (the CIN works), and an optional block says which
 * Alloggiati Web account sends its schedine:
 *
 *   "alloggiati": {
 *     "account": "principale",  // the name of the saved credentials (fairnight ospiti credenziali)
 *     "apartmentId": 4,          // only for "Gestione Appartamenti" users: the IdAppartamento
 *     "autoSend": false          // true lets a scheduled task send without a terminal (see the docs)
 *   }
 */
import { isTime } from "./dates.js";
import { COUNTRIES, type Country } from "./types.js";

export interface AlloggiatiSettings {
  /** Name of the saved credentials; "principale" when not given. */
  account: string;
  /** IdAppartamento of a "Gestione Appartamenti" user (Tabella ListaAppartamenti). */
  apartmentId?: number;
  /** Sending without a terminal (a scheduled task with FAIRGUEST_FRASE) is allowed only with true. */
  autoSend: boolean;
}

export const DEFAULT_ALLOGGIATI_ACCOUNT = "principale";

export interface GuestSettings {
  country: Country;
  establishment: string;
  establishmentName?: string;
  /** Default false: a host is non-professional until they say otherwise. */
  professional: boolean;
  checkInTime?: string;
  checkOutTime?: string;
  rooms?: number;
  internet?: boolean;
  /** Italy only. */
  alloggiati?: AlloggiatiSettings;
}

export const SETTINGS_FIELDS = ["country", "establishment", "establishmentName", "professional", "checkInTime", "checkOutTime", "rooms", "internet", "alloggiati"] as const;
const ALLOGGIATI_FIELDS = ["account", "apartmentId", "autoSend"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateGuestSettings(input: unknown, path: string): { value: GuestSettings | null; issues: { path: string; message: string }[] } {
  const issues: { path: string; message: string }[] = [];
  const add = (p: string, message: string) => issues.push({ path: `${path}.${p}`, message });
  if (!isObj(input)) return { value: null, issues: [{ path, message: "must be an object with country and establishment" }] };
  for (const key of Object.keys(input)) {
    if (!(SETTINGS_FIELDS as readonly string[]).includes(key)) add(key, `unknown field (allowed: ${SETTINGS_FIELDS.join(", ")})`);
  }
  if (!COUNTRIES.includes(input.country as Country)) add("country", `must be one of ${COUNTRIES.join(", ")} (ES = SES.HOSPEDAJES, ES-CT = Catalonia, Mossos d'Esquadra, IT = Italy, Alloggiati Web)`);
  if (typeof input.establishment !== "string" || !/^[A-Za-z0-9]{1,20}$/.test(input.establishment)) {
    add("establishment", `must be the establishment code given by the authority (letters and digits), got ${JSON.stringify(input.establishment)}`);
  }
  if (input.establishmentName !== undefined && (typeof input.establishmentName !== "string" || input.establishmentName.trim() === "" || input.establishmentName.length > 40)) {
    add("establishmentName", "must be a name of at most 40 characters");
  }
  if (input.professional !== undefined && typeof input.professional !== "boolean") add("professional", "must be true or false");
  for (const key of ["checkInTime", "checkOutTime"] as const) {
    if (input[key] !== undefined && !isTime(input[key])) add(key, `must be a time like 16:00, got ${JSON.stringify(input[key])}`);
  }
  if (input.rooms !== undefined && (!Number.isInteger(input.rooms) || (input.rooms as number) < 1 || (input.rooms as number) > 999)) add("rooms", "must be a whole number from 1 to 999");
  if (input.internet !== undefined && typeof input.internet !== "boolean") add("internet", "must be true or false");
  let alloggiati: AlloggiatiSettings | undefined;
  if (input.country === "IT") alloggiati = { account: DEFAULT_ALLOGGIATI_ACCOUNT, autoSend: false };
  if (input.alloggiati !== undefined) {
    const a = input.alloggiati;
    if (input.country !== "IT") add("alloggiati", 'only for listings in Italy ("country": "IT")');
    else if (!isObj(a)) add("alloggiati", "must be an object with account, apartmentId, autoSend");
    else {
      for (const key of Object.keys(a)) if (!ALLOGGIATI_FIELDS.includes(key)) add(`alloggiati.${key}`, `unknown field (allowed: ${ALLOGGIATI_FIELDS.join(", ")})`);
      if (a.account !== undefined && (typeof a.account !== "string" || !/^[a-z0-9-]{1,30}$/.test(a.account))) add("alloggiati.account", "must be a short name of lower-case letters, digits and dashes, like principale");
      if (a.apartmentId !== undefined && (!Number.isInteger(a.apartmentId) || (a.apartmentId as number) < 1 || (a.apartmentId as number) > 999_999)) {
        add("alloggiati.apartmentId", "must be the IdAppartamento given by Alloggiati Web, a whole number");
      }
      if (a.autoSend !== undefined && typeof a.autoSend !== "boolean") add("alloggiati.autoSend", "must be true or false");
      alloggiati = { account: (a.account as string | undefined) ?? DEFAULT_ALLOGGIATI_ACCOUNT, autoSend: a.autoSend === true };
      if (a.apartmentId !== undefined) alloggiati.apartmentId = a.apartmentId as number;
    }
  }
  if (issues.length > 0) return { value: null, issues };

  const value: GuestSettings = { country: input.country as Country, establishment: (input.establishment as string).toUpperCase(), professional: input.professional === true };
  if (input.establishmentName !== undefined) value.establishmentName = (input.establishmentName as string).trim();
  if (input.checkInTime !== undefined) value.checkInTime = input.checkInTime as string;
  if (input.checkOutTime !== undefined) value.checkOutTime = input.checkOutTime as string;
  if (input.rooms !== undefined) value.rooms = input.rooms as number;
  if (input.internet !== undefined) value.internet = input.internet as boolean;
  if (alloggiati) value.alloggiati = alloggiati;
  return { value, issues };
}
