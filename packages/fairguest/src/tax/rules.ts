/**
 * Tourist tax (imposta di soggiorno, impost sobre les estades en establiments
 * turístics): the rule of one town, who pays, how much a stay owes.
 *
 * - A rule is a rate per person per night, with optional seasons (other rates
 *   on some days of the year), an age below which guests do not pay, residents
 *   of the town who do not pay, and a cap on the nights that count.
 * - Money is in cents, always whole numbers: rates like 3.50 € never drift.
 * - What a guest is for the tax ("pays", "exempt by age", …) is decided when
 *   the guest checks in, from the birth date and one yes/no question, and only
 *   that class is kept outside the sealed data.
 * - No Node.js, no browser API: the same code runs on the host's computer and
 *   in the guest's page.
 */
import { ageOn, isDate } from "../dates.js";

export const TAX_CLASSES = ["pays", "exempt-age", "exempt-resident", "exempt-other"] as const;
/**
 * What a guest is for the tax. A reduced rate by age is "reduced:<from>-<to>"
 * ("reduced:70-" with no upper age): the band is found again by its ages, so
 * the host may reorder the bands without changing what was recorded.
 */
export type TaxClass = (typeof TAX_CLASSES)[number] | `reduced:${string}`;
const REDUCED = /^reduced:(\d{1,3})-(\d{1,3})?$/;
export const isTaxClass = (v: unknown): v is TaxClass => (TAX_CLASSES as readonly unknown[]).includes(v) || (typeof v === "string" && REDUCED.test(v));
export const isReduced = (c: TaxClass | null): c is `reduced:${string}` => typeof c === "string" && c.startsWith("reduced:");

export const TAX_PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;
export type TaxPeriod = (typeof TAX_PERIODS)[number];

/** Another rate on some days of the year: "MM-DD" to "MM-DD", both included; may cross the new year. */
export interface TaxSeason {
  from: string;
  to: string;
  rate: number;
}

/** A part of the rate shown on its own (Barcelona: the Catalan tax and the city's surcharge). */
export interface TaxComponent {
  label: string;
  rate: number;
}

/**
 * A reduced rate by age, both ages included and counted in whole years on the
 * day of check-in (Verona: 15 to 25, 70 and over). Either its own `rate` per
 * person per night, or a `percent` of the night's rate (Venezia: 50).
 */
export interface TaxAgeBand {
  fromAge: number;
  /** Missing: no upper age. */
  toAge?: number;
  rate?: number;
  percent?: number;
}

/**
 * A point of the starting values that the host must check with the town:
 * the words of the regulation, where they are, and what Fairguest does meanwhile.
 * It is shown on the page /pagamenti, in `fairnight tassa` and in the summary,
 * until the host writes "confirmed": true (or their own value) in the config.
 */
export interface TaxVerify {
  /** The field it is about, e.g. "exemptUnderAge". */
  field: string;
  /** The words of the regulation, as written. */
  quote: string;
  /** Where they come from (the official page, or the copy that was read). */
  url: string;
  /** The quote was read in an unofficial copy of the regulation (the official text was not found). */
  unofficialCopy?: boolean;
  /** What the town's own page says about the same point, in its words. */
  townPageSays?: string;
}

export interface TaxSource {
  url: string;
  title: string;
  /** The day the page was read, "YYYY-MM-DD". */
  checkedOn: string;
}

export interface TaxRule {
  /** Short id, like "roma" or "barcelona". */
  place: string;
  /** The town, as the declaration names it. */
  name: string;
  currency: string;
  /** Per person per night, in the currency (6 = 6.00 €). 0 = no tax. */
  rate: number;
  seasons?: TaxSeason[];
  components?: TaxComponent[];
  /** Only the first maxNights nights of a stay count. */
  maxNights?: number;
  /** Guests younger than this (age on the day of check-in) do not pay. */
  exemptUnderAge?: number;
  /** Residents of the town do not pay: the form asks each guest. */
  residentsExempt?: boolean;
  /** Reduced rates by age; the first band that fits the guest's age counts. */
  ageBands?: TaxAgeBand[];
  /** Points to check with the town; gone once the host confirms. */
  verify?: TaxVerify[];
  /** How often the host declares to the town. */
  period?: TaxPeriod;
  /** Free text the host sees with the rule (the category used, other exemptions). */
  notes?: string;
  source?: TaxSource;
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

export const TAX_RULE_FIELDS = ["place", "name", "currency", "rate", "seasons", "components", "maxNights", "exemptUnderAge", "residentsExempt", "ageBands", "verify", "confirmed", "period", "notes", "source"] as const;

const isAge = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 120;

/** Check a rule written by the host (or merged over a starting value); every problem at once. */
export function validateTaxRule(input: unknown, path: string): { value: TaxRule | null; issues: { path: string; message: string }[] } {
  const issues: { path: string; message: string }[] = [];
  const add = (p: string, message: string) => issues.push({ path: `${path}.${p}`, message });
  if (!isObj(input)) return { value: null, issues: [{ path, message: "must be an object with place, name and rate" }] };
  for (const k of Object.keys(input)) if (!(TAX_RULE_FIELDS as readonly string[]).includes(k)) add(k, `unknown field (allowed: ${TAX_RULE_FIELDS.join(", ")})`);
  if (typeof input.place !== "string" || !/^[a-z0-9-]{1,40}$/.test(input.place)) add("place", "must be a short id of lower-case letters, digits and dashes, like roma");
  if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 80) add("name", "must be the name of the town");
  if (input.currency !== undefined && (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency))) add("currency", 'must be a currency code like "EUR"');
  if (!isRate(input.rate)) add("rate", `must be the amount per person per night, from 0 to 100 with at most two decimals, got ${JSON.stringify(input.rate)}`);
  if (input.seasons !== undefined) {
    if (!Array.isArray(input.seasons)) add("seasons", 'must be a list like [{ "from": "04-01", "to": "10-31", "rate": 5 }]');
    else
      input.seasons.forEach((s: unknown, i) => {
        if (!isObj(s) || typeof s.from !== "string" || !MMDD.test(s.from) || typeof s.to !== "string" || !MMDD.test(s.to)) add(`seasons[${i}]`, 'needs "from" and "to" as "MM-DD"');
        else if (!isRate(s.rate)) add(`seasons[${i}].rate`, "must be the amount per person per night");
      });
  }
  if (input.components !== undefined) {
    if (!Array.isArray(input.components) || input.components.some((c: unknown) => !isObj(c) || typeof c.label !== "string" || !isRate(c.rate))) add("components", 'must be a list like [{ "label": "…", "rate": 3 }]');
    else if (Math.round((input.components as TaxComponent[]).reduce((s, c) => s + c.rate * 100, 0)) !== Math.round((input.rate as number) * 100)) add("components", "must add up to the rate");
  }
  if (input.maxNights !== undefined && (!Number.isInteger(input.maxNights) || (input.maxNights as number) < 1 || (input.maxNights as number) > 365)) add("maxNights", "must be a whole number of nights from 1 to 365");
  if (input.exemptUnderAge !== undefined && (!Number.isInteger(input.exemptUnderAge) || (input.exemptUnderAge as number) < 0 || (input.exemptUnderAge as number) > 30)) add("exemptUnderAge", "must be an age from 0 to 30");
  if (input.residentsExempt !== undefined && typeof input.residentsExempt !== "boolean") add("residentsExempt", "must be true or false");
  if (input.ageBands !== undefined) {
    if (!Array.isArray(input.ageBands) || input.ageBands.length > 6) add("ageBands", 'must be a list like [{ "fromAge": 15, "toAge": 25, "rate": 2.8 }] (at most 6)');
    else
      input.ageBands.forEach((b: unknown, i) => {
        const at = `ageBands[${i}]`;
        if (!isObj(b)) return add(at, 'must be like { "fromAge": 70, "rate": 2.8 } or { "fromAge": 10, "toAge": 15, "percent": 50 }');
        for (const k of Object.keys(b)) if (!["fromAge", "toAge", "rate", "percent"].includes(k)) add(`${at}.${k}`, "unknown field (allowed: fromAge, toAge, rate, percent)");
        if (!isAge(b.fromAge)) add(`${at}.fromAge`, "must be an age in whole years, from 0 to 120");
        if (b.toAge !== undefined && (!isAge(b.toAge) || (isAge(b.fromAge) && (b.toAge as number) < b.fromAge))) add(`${at}.toAge`, "must be an age not below fromAge (both included)");
        if ((b.rate === undefined) === (b.percent === undefined)) add(at, "needs either rate (its own amount) or percent (of the night's rate)");
        if (b.rate !== undefined && !isRate(b.rate)) add(`${at}.rate`, "must be the amount per person per night");
        if (b.percent !== undefined && (typeof b.percent !== "number" || !Number.isInteger(b.percent) || b.percent < 0 || b.percent > 100)) add(`${at}.percent`, "must be a whole percent from 0 to 100");
      });
  }
  if (input.confirmed !== undefined && typeof input.confirmed !== "boolean") add("confirmed", "must be true or false");
  if (input.verify !== undefined && (!Array.isArray(input.verify) || input.verify.some((v: unknown) => !isObj(v) || typeof v.field !== "string" || typeof v.quote !== "string" || typeof v.url !== "string" || (v.townPageSays !== undefined && typeof v.townPageSays !== "string")))) {
    add("verify", 'comes from the starting values: remove it, and write "confirmed": true once you have checked');
  }
  if (input.period !== undefined && !TAX_PERIODS.includes(input.period as TaxPeriod)) add("period", `must be one of ${TAX_PERIODS.join(", ")}`);
  if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 500)) add("notes", "must be a text of at most 500 characters");
  if (input.source !== undefined) {
    const s = input.source;
    if (!isObj(s) || typeof s.url !== "string" || !/^https?:\/\//.test(s.url) || typeof s.title !== "string" || !isDate(s.checkedOn)) add("source", "must have url, title and checkedOn (YYYY-MM-DD)");
  }
  if (issues.length > 0) return { value: null, issues };
  const value: TaxRule = { place: input.place as string, name: (input.name as string).trim(), currency: (input.currency as string | undefined) ?? "EUR", rate: input.rate as number };
  if (input.seasons !== undefined) value.seasons = (input.seasons as TaxSeason[]).map((s) => ({ from: s.from, to: s.to, rate: s.rate }));
  if (input.components !== undefined) value.components = (input.components as TaxComponent[]).map((c) => ({ label: c.label, rate: c.rate }));
  if (input.maxNights !== undefined) value.maxNights = input.maxNights as number;
  if (input.exemptUnderAge !== undefined) value.exemptUnderAge = input.exemptUnderAge as number;
  if (input.residentsExempt !== undefined) value.residentsExempt = input.residentsExempt as boolean;
  if (input.ageBands !== undefined) {
    value.ageBands = (input.ageBands as TaxAgeBand[]).map((b) => ({ fromAge: b.fromAge, ...(b.toAge !== undefined ? { toAge: b.toAge } : {}), ...(b.rate !== undefined ? { rate: b.rate } : { percent: b.percent as number }) }));
  }
  // What the host checked and confirmed is no longer flagged.
  const verify = input.confirmed === true ? [] : ((input.verify as TaxVerify[] | undefined) ?? []);
  if (verify.length > 0) {
    value.verify = verify.map((v) => ({ field: v.field, quote: v.quote, url: v.url, ...(v.unofficialCopy ? { unofficialCopy: true } : {}), ...(v.townPageSays ? { townPageSays: v.townPageSays } : {}) }));
  }
  if (input.period !== undefined) value.period = input.period as TaxPeriod;
  if (input.notes !== undefined) value.notes = input.notes as string;
  if (input.source !== undefined) value.source = input.source as TaxSource;
  return { value, issues };
}

const cents = (amount: number) => Math.round(amount * 100);

/** Does "MM-DD" fall in the season? Seasons may cross the new year (11-01 to 02-28). */
function inSeason(mmdd: string, s: TaxSeason): boolean {
  return s.from <= s.to ? mmdd >= s.from && mmdd <= s.to : mmdd >= s.from || mmdd <= s.to;
}

/** The rate of one night, in cents per person. */
export function nightRateCents(rule: TaxRule, night: string): number {
  const mmdd = night.slice(5, 10);
  const season = rule.seasons?.find((s) => inSeason(mmdd, s));
  return cents(season ? season.rate : rule.rate);
}

export const bandKey = (b: TaxAgeBand): `reduced:${string}` => `reduced:${b.fromAge}-${b.toAge ?? ""}`;

/** The band of a "reduced:…" class, if the rule still has it. */
export function bandOf(rule: TaxRule, c: TaxClass | null): TaxAgeBand | undefined {
  return isReduced(c) ? rule.ageBands?.find((b) => bandKey(b) === c) : undefined;
}

/** A reduced guest's rate for one night, in cents. */
export function bandRateCents(band: TaxAgeBand, nightCents: number): number {
  return band.rate !== undefined ? cents(band.rate) : Math.round((nightCents * (band.percent ?? 100)) / 100);
}

/**
 * What one guest is for the tax, from the birth date (age on the day of
 * check-in) and the answer to "do you live in <town>?". Exemptions come
 * before reduced rates.
 */
export function classifyGuest(rule: TaxRule, guest: { birthDate?: string | undefined; resident?: boolean }, checkIn: string): TaxClass {
  const age = guest.birthDate && isDate(guest.birthDate) ? ageOn(guest.birthDate, checkIn) : null;
  if (rule.exemptUnderAge !== undefined && age !== null && age < rule.exemptUnderAge) return "exempt-age";
  if (rule.residentsExempt && guest.resident === true) return "exempt-resident";
  const band = age === null ? undefined : rule.ageBands?.find((b) => age >= b.fromAge && (b.toAge === undefined || age <= b.toAge));
  return band ? bandKey(band) : "pays";
}

/** The nights of a stay, "YYYY-MM-DD" each: check-in included, check-out not. */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  for (let t = Date.parse(`${checkIn}T00:00:00Z`); t < end && out.length < 1000; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export interface StayTaxNight {
  date: string;
  /** Counted for the tax (inside the cap on nights). */
  taxed: boolean;
  /** Per person, in cents. */
  rateCents: number;
}

export interface StayTax {
  place: string;
  currency: string;
  nights: StayTaxNight[];
  /** Guests by class; "reduced" = all the reduced rates; "unknown" = arrived through the link and not opened yet. */
  guests: Record<(typeof TAX_CLASSES)[number] | "reduced" | "unknown", number>;
  /** Person-nights that pay, at the full or at a reduced rate. */
  personNights: number;
  /** Of those, at a reduced rate. */
  reducedPersonNights: number;
  /** Person-nights not paid, by reason. */
  exemptPersonNights: Record<"age" | "resident" | "other" | "cap", number>;
  totalCents: number;
}

/**
 * The tax of a stay. `classes` has one entry per guest; null = not known yet
 * (the stay is then not complete: `guests.unknown` says how many).
 * `within` limits the nights to a period (a month, a quarter), for the
 * declaration; the cap on nights still counts from the first night of the stay.
 */
export function stayTax(rule: TaxRule, checkIn: string, checkOut: string, classes: (TaxClass | null)[], within?: { from: string; to: string }): StayTax {
  const guests: StayTax["guests"] = { pays: 0, "exempt-age": 0, "exempt-resident": 0, "exempt-other": 0, reduced: 0, unknown: 0 };
  // A reduced class whose band the host removed counts at the full rate.
  const bands: TaxAgeBand[] = [];
  for (const c of classes) {
    if (c === null) guests.unknown++;
    else if (isReduced(c)) {
      const band = bandOf(rule, c);
      if (band) {
        guests.reduced++;
        bands.push(band);
      } else guests.pays++;
    } else guests[c as (typeof TAX_CLASSES)[number]]++;
  }
  const all = nightsOf(checkIn, checkOut).map((date, i) => ({ date, taxed: rule.maxNights === undefined || i < rule.maxNights, rateCents: nightRateCents(rule, date) }));
  const nights = within ? all.filter((n) => n.date >= within.from && n.date <= within.to) : all;
  const exempt = { age: 0, resident: 0, other: 0, cap: 0 };
  let personNights = 0;
  let reducedPersonNights = 0;
  let totalCents = 0;
  for (const n of nights) {
    if (!n.taxed) {
      exempt.cap += guests.pays + guests.reduced;
      continue;
    }
    personNights += guests.pays + guests.reduced;
    reducedPersonNights += guests.reduced;
    totalCents += guests.pays * n.rateCents + bands.reduce((s, b) => s + bandRateCents(b, n.rateCents), 0);
    exempt.age += guests["exempt-age"];
    exempt.resident += guests["exempt-resident"];
    exempt.other += guests["exempt-other"];
  }
  return { place: rule.place, currency: rule.currency, nights, guests, personNights, reducedPersonNights, exemptPersonNights: exempt, totalCents };
}

/** "2099-06" → first and last day; "2099-Q2" → the quarter. Null when it is neither. */
export function periodRange(period: string): { from: string; to: string; label: string } | null {
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  const quarter = /^(\d{4})-[QqTt]([1-4])$/.exec(period);
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    return { from: `${month[1]}-${month[2]}-01`, to: `${month[1]}-${month[2]}-${String(lastDay(y, m)).padStart(2, "0")}`, label: period };
  }
  if (quarter) {
    const y = Number(quarter[1]);
    const q = Number(quarter[2]);
    const first = (q - 1) * 3 + 1;
    const last = first + 2;
    return { from: `${y}-${String(first).padStart(2, "0")}-01`, to: `${y}-${String(last).padStart(2, "0")}-${String(lastDay(y, last)).padStart(2, "0")}`, label: `${y}-Q${q}` };
  }
  return null;
}

/** 3650 cents in EUR → "36,50" (Italian and Spanish write the comma). */
export function formatCents(c: number, decimal: "," | "." = ","): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}${decimal}${String(a % 100).padStart(2, "0")}`;
}
