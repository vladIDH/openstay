/**
 * Reading untrusted input (the check-in form, a corrected field) into a Guest,
 * and the rules of Real Decreto 933/2021 that SES and the Mossos share.
 * Every problem is reported at once, with the path of the field.
 */
import { isCountryCode } from "./countries-iso.js";
import { ageOn, isDate } from "./dates.js";
import { DOCUMENT_TYPES, KINSHIPS, PAYMENT_TYPES, SEXES } from "./types.js";
import type { Address, DocumentType, Guest, IdentityDocument, Kind, Kinship, PaymentType, Problem, Sex, Stay } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed text with single spaces, or undefined when empty. */
function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.normalize("NFC").replace(/\s+/g, " ").trim();
  return t === "" ? undefined : t;
}

const NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u;
const DOC_NUMBER = /^[A-Z0-9]{3,20}$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Spanish DNI/NIF: 8 digits and the check letter. */
export function validDni(n: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(n);
  return !!m && DNI_LETTERS[Number(m[1]) % 23] === m[2];
}

/** Spanish NIE: X, Y or Z, 7 digits and the check letter. */
export function validNie(n: string): boolean {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(n);
  return !!m && DNI_LETTERS[Number(`${"XYZ".indexOf(m[1] as string)}${m[2]}`) % 23] === m[3];
}

export interface ParsedGuest {
  guest: Guest | null;
  problems: Problem[];
}

/**
 * A guest from untrusted input. Unknown fields are ignored, never stored: that
 * is how card numbers or IBANs can never get in, even if someone sends them.
 * `today` is used to refuse birth and issue dates in the future.
 */
export function parseGuest(input: unknown, today: string, path = "guest"): ParsedGuest {
  const problems: Problem[] = [];
  const add = (p: string, message: string) => problems.push({ path: `${path}.${p}`, message });
  if (!isObj(input)) return { guest: null, problems: [{ path, message: "must be an object" }] };

  const name = (key: "givenName" | "surname1" | "surname2", required: boolean): string | undefined => {
    const v = text(input[key]);
    if (v === undefined) {
      if (required) add(key, "is required");
      return undefined;
    }
    if (v.length > 50) add(key, "must be at most 50 characters");
    else if (!NAME.test(v)) add(key, "may contain only letters, spaces, apostrophes, dots and dashes");
    return v;
  };
  const guest: Guest = { givenName: name("givenName", true) ?? "", surname1: name("surname1", true) ?? "" };
  const surname2 = name("surname2", false);
  if (surname2 !== undefined) guest.surname2 = surname2;

  const birth = text(input.birthDate);
  if (birth !== undefined) {
    if (!isDate(birth)) add("birthDate", "must be a date like 2099-01-31");
    else if (birth > today) add("birthDate", "cannot be in the future");
    else if (ageOn(birth, today) > 120) add("birthDate", "is more than 120 years ago");
    else guest.birthDate = birth;
  }
  const sex = text(input.sex);
  if (sex !== undefined) {
    if (SEXES.includes(sex as Sex)) guest.sex = sex as Sex;
    else add("sex", `must be one of ${SEXES.join(", ")}`);
  }
  const nationality = text(input.nationality)?.toUpperCase();
  if (nationality !== undefined) {
    if (isCountryCode(nationality)) guest.nationality = nationality;
    else add("nationality", "must be a country code like ESP or ITA (ISO 3166-1 alpha-3)");
  }

  if (input.document !== undefined && input.document !== null) {
    const d = parseDocument(input.document, today, `${path}.document`, problems);
    if (d) guest.document = d;
  }
  if (input.address !== undefined && input.address !== null) {
    const a = parseAddress(input.address, `${path}.address`, problems);
    if (a) guest.address = a;
  }

  for (const key of ["phone", "phone2"] as const) {
    const v = text(input[key]);
    if (v === undefined) continue;
    if (PHONE.test(v)) guest[key] = v;
    else add(key, "must be a phone number (digits, spaces, + and dashes, 6 to 20 characters)");
  }
  const email = text(input.email);
  if (email !== undefined) {
    if (email.length <= 100 && EMAIL.test(email)) guest.email = email;
    else add("email", "must be an email address");
  }
  const kinship = text(input.kinship);
  if (kinship !== undefined) {
    if (KINSHIPS.includes(kinship as Kinship)) guest.kinship = kinship as Kinship;
    else add("kinship", `must be one of ${KINSHIPS.join(", ")}`);
  }
  return { guest: problems.length === 0 ? guest : null, problems };
}

function parseDocument(input: unknown, today: string, path: string, problems: Problem[]): IdentityDocument | null {
  const add = (p: string, message: string) => problems.push({ path: `${path}.${p}`, message });
  if (!isObj(input)) {
    problems.push({ path, message: "must be an object with type and number" });
    return null;
  }
  const type = text(input.type);
  const number = text(input.number)?.toUpperCase().replace(/[\s.-]/g, "");
  if (type === undefined && number === undefined) return null;
  if (!DOCUMENT_TYPES.includes(type as DocumentType)) add("type", `must be one of ${DOCUMENT_TYPES.join(", ")}`);
  if (number === undefined) add("number", "is required with the document type");
  else if (!DOC_NUMBER.test(number)) add("number", "must be 3 to 20 letters and digits");
  else if (type === "dni" && !validDni(number)) add("number", "is not a valid DNI/NIF (8 digits and the right letter)");
  else if (type === "nie" && !validNie(number)) add("number", "is not a valid NIE (X, Y or Z, 7 digits and the right letter)");
  const doc: IdentityDocument = { type: type as DocumentType, number: number ?? "" };
  const support = text(input.support)?.toUpperCase().replace(/\s/g, "");
  if (support !== undefined) {
    if (/^[A-Z0-9]{9}$/.test(support)) doc.support = support;
    else add("support", "must be exactly 9 letters and digits");
  }
  const issued = text(input.issuedOn);
  if (issued !== undefined) {
    if (!isDate(issued)) add("issuedOn", "must be a date like 2099-01-31");
    else if (issued > today) add("issuedOn", "cannot be in the future");
    else doc.issuedOn = issued;
  }
  if (input.spanish === true) doc.spanish = true;
  return doc;
}

function parseAddress(input: unknown, path: string, problems: Problem[]): Address | null {
  const add = (p: string, message: string) => problems.push({ path: `${path}.${p}`, message });
  if (!isObj(input)) {
    problems.push({ path, message: "must be an object with country" });
    return null;
  }
  const country = text(input.country)?.toUpperCase();
  const street = text(input.street);
  const locality = text(input.locality);
  const postalCode = text(input.postalCode)?.toUpperCase();
  const municipalityCode = text(input.municipalityCode);
  if ([country, street, locality, postalCode, municipalityCode].every((v) => v === undefined)) return null;
  if (country === undefined || !isCountryCode(country)) add("country", "must be a country code like ESP or ITA (ISO 3166-1 alpha-3)");
  const a: Address = { country: country ?? "" };
  if (street !== undefined) {
    if (street.length <= 100) a.street = street;
    else add("street", "must be at most 100 characters");
  }
  if (locality !== undefined) {
    if (locality.length <= 100) a.locality = locality;
    else add("locality", "must be at most 100 characters");
  }
  if (postalCode !== undefined) {
    if (country === "ESP" && !/^\d{5}$/.test(postalCode)) add("postalCode", "must be 5 digits for an address in Spain");
    else if (!/^[A-Z0-9 -]{2,20}$/.test(postalCode)) add("postalCode", "must be 2 to 20 letters and digits");
    else a.postalCode = postalCode;
  }
  if (municipalityCode !== undefined) {
    if (/^\d{6}$/.test(municipalityCode)) a.municipalityCode = municipalityCode;
    else add("municipalityCode", "must be the 6-digit INE code of the municipality");
  }
  return a;
}

export const isPaymentType = (v: unknown): v is PaymentType => PAYMENT_TYPES.includes(v as PaymentType);

const ADULT = 18;

/**
 * What Real Decreto 933/2021 requires, for both SES and the Mossos.
 * `documentFromAge`: from which age the identity document is mandatory
 * (SES: adults; the Mossos validate it from 14).
 */
export function spainRules(stay: Stay, kind: Kind, documentFromAge: number): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });

  if (!stay.establishment) add("establishment", "the establishment code is missing (fairguest.establishment in fairnight.config.json)");
  if (!stay.reference) add("reference", "the booking reference or contract number is missing");
  if (!isDate(stay.contractDate)) add("contractDate", "the contract date is missing");
  if (!isDate(stay.checkIn) || !isDate(stay.checkOut) || stay.checkOut <= stay.checkIn) add("checkOut", "check-out must come after check-in");
  if (!Number.isInteger(stay.people) || stay.people < 1) add("people", "the number of people is missing");
  if (!stay.payment || !isPaymentType(stay.payment.type)) add("payment.type", "the type of payment is missing (only the type: card, cash, platform…)");

  const holder = stay.guests[0];
  if (!holder || !holder.givenName || !holder.surname1) add("guests[0]", "the holder's name and first surname are missing");
  if (kind === "reservation") return problems;

  if (stay.guests.length < stay.people) add("guests", `${stay.guests.length} of ${stay.people} guests registered`);
  if (stay.guests.length > stay.people) add("people", `${stay.guests.length} guests registered for ${stay.people} people: correct the number of people`);
  const ages = stay.guests.map((g) => (g.birthDate ? ageOn(g.birthDate, stay.checkIn) : null));
  stay.guests.forEach((g, i) => {
    const p = `guests[${i}]`;
    const age = ages[i] ?? null;
    if (!g.givenName || !g.surname1) add(p, "name and first surname are required");
    if (!g.birthDate) add(`${p}.birthDate`, "the date of birth is required");
    if (!g.address?.country) add(`${p}.address.country`, "the country of residence is required");
    else {
      if (!g.address.street) add(`${p}.address.street`, "the address is required");
      if (g.address.country === "ESP") {
        if (!g.address.municipalityCode) add(`${p}.address.municipalityCode`, "the INE code of the municipality is required for an address in Spain");
        if (!g.address.postalCode) add(`${p}.address.postalCode`, "the postal code is required for an address in Spain");
      } else if (!g.address.locality) add(`${p}.address.locality`, "the town or city is required for an address abroad");
    }
    if (!g.phone && !g.phone2 && !g.email) add(p, "at least one phone number or an email is required");
    if (age === null || age >= documentFromAge) {
      if (!g.document) add(`${p}.document`, `the identity document is required (from ${documentFromAge} years old)`);
      else {
        if (g.document.type === "dni" || g.document.type === "nie") {
          if (!g.document.support) add(`${p}.document.support`, "the support number of the DNI/NIE card is required");
        }
        if (g.document.type === "dni" && !g.surname2) add(`${p}.surname2`, "the second surname is required with a DNI");
      }
    }
    if (age !== null && age < ADULT && i > 0 && !g.kinship) add(`${p}.kinship`, "the relationship to the holder is required for a minor");
  });
  return problems;
}
