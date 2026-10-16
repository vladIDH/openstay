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
 *
 * In Spain with SES.HOSPEDAJES ("country": "ES") "establishment" is the
 * codigoEstablecimiento, and the web service needs one more block:
 *
 *   "ses": {
 *     "landlord": "0000000123",  // codigoArrendador given at the registration on the SES website
 *     "account": "principale",   // the name of the saved user and password (fairnight ospiti credenziali --ses)
 *     "environment": "test"      // "test" (pre-ses, the Ministry's test service) or "production"
 *   }
 *
 * The user and password are never written here: they are sealed in the database.
 *
 * The tourist tax and the payments (both off unless written):
 *
 *   "touristTax": { "place": "roma" },          // the starting values of src/tax/places.ts
 *   "touristTax": { "place": "roma", "rate": 6, "maxNights": 10 },   // or the host's own figures
 *   "payments": {
 *     "enabled": true,           // the guest pays in the check-in, with the host's own Stripe
 *     "collectTax": true,        // ask for the tourist tax (needs touristTax)
 *     "deposit": 200,            // a hold on the card, released or kept by the host; 0 or missing = none
 *     "depositDaysBefore": 2     // the hold is offered from this many days before check-in (a hold lasts 7 days)
 *   }
 */
import { isTime } from "./dates.js";
import { taxRuleFor } from "./tax/places.js";
import type { TaxRule } from "./tax/rules.js";
import { ISTAT_REGION_KEYS, ISTAT_REGIONS, type IstatRegionKey } from "./istat/regions.js";
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

/** Spain: the SES.HOSPEDAJES web service. */
export interface SesSettings {
  /** codigoArrendador, 10 characters. */
  landlord: string;
  /** Name of the saved credentials; "principale" when not given. */
  account: string;
  /** Which service the communications go to: the Ministry's test service until the host says "production". */
  environment: "test" | "production";
}

/** Italy: where the listing's Istat data goes (see istat/regions.ts). */
export interface IstatSettings {
  region: IstatRegionKey;
  /** The structure's code at the region (ROSS1000 codice, Trento CIPAT); for Umbria and manual regions, the name. */
  code: string;
  /** Name of the saved ROSS1000 credentials; "principale" when not given. */
  account: string;
}

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
  /** Beds available (people the listing can host): needed for ROSS1000. */
  beds?: number;
  /** Italy only: the regional Istat data. */
  istat?: IstatSettings;
  /** The tourist tax of the town, merged: starting values and the host's figures. */
  touristTax?: TaxRule;
  /** The guest pays in the check-in, with the host's own Stripe account. Off unless enabled. */
  payments?: PaymentSettings;
  /** Spain (SES.HOSPEDAJES) only. */
  ses?: SesSettings;
}

export interface PaymentSettings {
  enabled: boolean;
  collectTax: boolean;
  /** The amount held on the card, in the tax's currency (EUR when there is no tax); 0 = no deposit. */
  deposit: number;
  depositDaysBefore: number;
  currency: string;
}

export const DEFAULT_DEPOSIT_DAYS_BEFORE = 2;
const PAYMENT_FIELDS = ["enabled", "collectTax", "deposit", "depositDaysBefore", "currency"];

export const SETTINGS_FIELDS = ["country", "establishment", "establishmentName", "professional", "checkInTime", "checkOutTime", "rooms", "beds", "internet", "alloggiati", "istat", "touristTax", "payments", "ses"] as const;
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
  if (input.beds !== undefined && (!Number.isInteger(input.beds) || (input.beds as number) < 1 || (input.beds as number) > 9999)) add("beds", "must be a whole number from 1 to 9999");
  let istat: IstatSettings | undefined;
  if (input.istat !== undefined) {
    const s = input.istat;
    if (input.country !== "IT") add("istat", 'only for listings in Italy ("country": "IT")');
    else if (!isObj(s)) add("istat", "must be an object with region and code");
    else {
      for (const key of Object.keys(s)) if (!["region", "code", "account"].includes(key)) add(`istat.${key}`, "unknown field (allowed: region, code, account)");
      if (!ISTAT_REGION_KEYS.includes(s.region as IstatRegionKey)) add("istat.region", `must be one of ${ISTAT_REGION_KEYS.join(", ")}`);
      if (typeof s.code !== "string" || s.code.trim() === "" || s.code.length > 60) add("istat.code", "must be the structure's code at the region (or its name where there is no code)");
      if (s.account !== undefined && (typeof s.account !== "string" || !/^[a-z0-9-]{1,30}$/.test(s.account))) add("istat.account", "must be a short name of lower-case letters, digits and dashes");
      const region = ISTAT_REGIONS[s.region as IstatRegionKey];
      // Rooms and beds are part of every day sent to ROSS1000.
      if (region?.mode === "ross1000") {
        if (input.rooms === undefined) add("rooms", `is required with ROSS1000 (${region.name}): the rooms the listing has`);
        if (input.beds === undefined) add("beds", `is required with ROSS1000 (${region.name}): the people the listing can host`);
      }
      if (region && typeof s.code === "string") istat = { region: s.region as IstatRegionKey, code: s.code.trim(), account: (s.account as string | undefined) ?? DEFAULT_ALLOGGIATI_ACCOUNT };
    }
  }
  let ses: SesSettings | undefined;
  if (input.ses !== undefined) {
    const x = input.ses;
    if (input.country !== "ES") add("ses", 'only for listings that send to SES.HOSPEDAJES ("country": "ES")');
    else if (!isObj(x)) add("ses", "must be an object with landlord, account, environment");
    else {
      for (const key of Object.keys(x)) if (!["landlord", "account", "environment"].includes(key)) add(`ses.${key}`, "unknown field (allowed: landlord, account, environment)");
      if (typeof x.landlord !== "string" || !/^[A-Za-z0-9]{10}$/.test(x.landlord)) add("ses.landlord", `must be the codigoArrendador given by SES.HOSPEDAJES (10 letters and digits), got ${JSON.stringify(x.landlord)}`);
      if (x.account !== undefined && (typeof x.account !== "string" || !/^[a-z0-9-]{1,30}$/.test(x.account))) add("ses.account", "must be a short name of lower-case letters, digits and dashes, like principale");
      if (x.environment !== undefined && x.environment !== "test" && x.environment !== "production") add("ses.environment", 'must be "test" (the test service of the Ministry) or "production"');
      if (typeof x.landlord === "string") {
        ses = { landlord: x.landlord.toUpperCase(), account: (x.account as string | undefined) ?? DEFAULT_ALLOGGIATI_ACCOUNT, environment: x.environment === "production" ? "production" : "test" };
      }
    }
  }
  let touristTax: TaxRule | undefined;
  if (input.touristTax !== undefined) {
    const t = taxRuleFor(input.touristTax, `${path}.touristTax`);
    issues.push(...t.issues);
    if (t.value) touristTax = t.value;
  }
  let payments: PaymentSettings | undefined;
  if (input.payments !== undefined) {
    const p = input.payments;
    if (!isObj(p)) add("payments", "must be an object like { \"enabled\": true, \"collectTax\": true, \"deposit\": 200 }");
    else {
      for (const key of Object.keys(p)) if (!PAYMENT_FIELDS.includes(key)) add(`payments.${key}`, `unknown field (allowed: ${PAYMENT_FIELDS.join(", ")})`);
      if (p.enabled !== undefined && typeof p.enabled !== "boolean") add("payments.enabled", "must be true or false");
      if (p.collectTax !== undefined && typeof p.collectTax !== "boolean") add("payments.collectTax", "must be true or false");
      const deposit = p.deposit ?? 0;
      if (typeof deposit !== "number" || !Number.isFinite(deposit) || deposit < 0 || deposit > 10_000 || Math.round(deposit * 100) !== deposit * 100) add("payments.deposit", "must be an amount from 0 to 10000 with at most two decimals");
      if (p.depositDaysBefore !== undefined && (!Number.isInteger(p.depositDaysBefore) || (p.depositDaysBefore as number) < 0 || (p.depositDaysBefore as number) > 6)) {
        add("payments.depositDaysBefore", "must be a whole number of days from 0 to 6: a hold on a card lasts 7 days");
      }
      if (p.currency !== undefined && (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency))) add("payments.currency", 'must be a currency code like "EUR"');
      const collectTax = p.collectTax !== false && input.touristTax !== undefined;
      if (p.collectTax === true && input.touristTax === undefined) add("payments.collectTax", "needs touristTax: the rate of the town");
      if (p.enabled === true && !collectTax && !(typeof deposit === "number" && deposit > 0)) add("payments", "has nothing to ask: set collectTax (with touristTax) or a deposit");
      if (touristTax && p.currency !== undefined && p.currency !== touristTax.currency) add("payments.currency", `must be the currency of the tax (${touristTax.currency})`);
      payments = {
        enabled: p.enabled === true,
        collectTax,
        deposit: typeof deposit === "number" ? deposit : 0,
        depositDaysBefore: (p.depositDaysBefore as number | undefined) ?? DEFAULT_DEPOSIT_DAYS_BEFORE,
        currency: touristTax?.currency ?? (p.currency as string | undefined) ?? "EUR",
      };
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
  if (input.beds !== undefined) value.beds = input.beds as number;
  if (istat) value.istat = istat;
  if (ses) value.ses = ses;
  if (touristTax) value.touristTax = touristTax;
  if (payments) value.payments = payments;
  return { value, issues };
}
