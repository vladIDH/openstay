/**
 * The machine-readable zone (MRZ) of passports and identity cards, read from
 * the text an OCR gives: ICAO Doc 9303, parts 3 (check digits), 4 (TD3,
 * passports, 2 lines of 44), 5 (TD1, identity cards, 3 lines of 30) and 6 (TD2,
 * 2 lines of 36).
 *
 * Pure text in, fields out: no image ever comes here. The check digits decide
 * whether the reading is right; common OCR confusions (O and 0, I and 1…) are
 * repaired only where the field must be digits or letters, and only when the
 * check digit then agrees.
 */
import { isCountryCode } from "./countries-iso.js";
import type { DocumentType, Guest, Sex } from "./types.js";

/**
 * The check-in form's fields from what the MRZ said, over what the guest
 * already typed; the guest checks them. `offered` are the document types of
 * the listing's country: a type the form does not offer becomes the closest one
 * it does (an identity card, else "other").
 */
export function formValuesFromMrz(g: Partial<Guest>, offered: readonly DocumentType[], before: Record<string, string>): Record<string, string> {
  const v = { ...before };
  if (g.givenName) v.givenName = g.givenName;
  if (g.surname1) v.surname1 = g.surname1;
  if (g.surname2) v.surname2 = g.surname2;
  if (g.birthDate) v.birthDate = g.birthDate;
  if (g.sex && g.sex !== "other") v.sex = g.sex;
  if (g.nationality) v.nationality = g.nationality;
  if (g.document) {
    const t = g.document.type;
    v.docType = offered.includes(t) ? t : offered.includes("id_card") ? "id_card" : offered.includes("other") ? "other" : (offered[0] ?? "");
    if (g.document.number) v.docNumber = g.document.number;
    if (g.document.support) v.docSupport = g.document.support;
    if (g.document.issuedIn?.country) v.docCountry = g.document.issuedIn.country;
    if (g.document.spanish) v.docSpanish = "1";
  }
  return v;
}

export type MrzFormat = "TD1" | "TD2" | "TD3";

export interface MrzFields {
  format: MrzFormat;
  /** "P" for passports, "I", "ID", "C"… for identity cards. */
  documentCode: string;
  issuingState: string;
  documentNumber: string;
  /** Optional data: on a Spanish DNI the DNI number, on other cards national numbers. */
  optional: string;
  birthDate: string | null;
  sex: Sex | null;
  expiryDate: string | null;
  nationality: string;
  surnames: string[];
  givenNames: string[];
  /** True when every check digit agrees, the composite one too. */
  valid: boolean;
  /** The fields whose check digit did not agree. */
  failed: string[];
}

const VALUES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** ICAO 9303 part 3: weights 7, 3, 1; digits as themselves, A = 10 … Z = 35, < = 0. */
export function checkDigit(field: string): string {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i] as string;
    const v = c === "<" ? 0 : VALUES.indexOf(c);
    sum += Math.max(v, 0) * ([7, 3, 1][i % 3] as number);
  }
  return String(sum % 10);
}

const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", U: "0", I: "1", L: "1", Z: "2", S: "5", G: "6", B: "8", T: "7" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "6": "G", "8": "B" };
const digits = (s: string) => s.replace(/[A-Z]/g, (c) => TO_DIGIT[c] ?? c);
const letters = (s: string) => s.replace(/[0-9]/g, (c) => TO_LETTER[c] ?? c);

/** Upper case, the OCR's look-alikes of "<" turned into "<", no spaces. */
function cleanLine(line: string): string {
  return line
    .toUpperCase()
    .replace(/[«‹([{]/g, "<")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9<]/g, "<");
}

/** The MRZ lines found in the OCR text, in order. */
export function findMrzLines(text: string): { format: MrzFormat; lines: string[] } | null {
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length >= 28 && (l.match(/</g) ?? []).length >= 2);
  const near = (l: string, n: number) => Math.abs(l.length - n) <= 2;
  const fit = (l: string, n: number) => (l.length > n ? l.slice(0, n) : l.padEnd(n, "<"));
  for (let i = 0; i + 1 < lines.length; i++) {
    const [a, b] = [lines[i] as string, lines[i + 1] as string];
    if (near(a, 44) && near(b, 44) && a.startsWith("P")) return { format: "TD3", lines: [fit(a, 44), fit(b, 44)] };
  }
  for (let i = 0; i + 2 < lines.length; i++) {
    const [a, b, c] = [lines[i] as string, lines[i + 1] as string, lines[i + 2] as string];
    if (near(a, 30) && near(b, 30) && near(c, 30)) return { format: "TD1", lines: [fit(a, 30), fit(b, 30), fit(c, 30)] };
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const [a, b] = [lines[i] as string, lines[i + 1] as string];
    if (near(a, 36) && near(b, 36)) return { format: "TD2", lines: [fit(a, 36), fit(b, 36)] };
  }
  return null;
}

/** "YYMMDD" to "YYYY-MM-DD": birth dates never in the future, expiry dates up to 50 years ahead. */
function mrzDate(yymmdd: string, kind: "birth" | "expiry", today: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const thisYear = Number(today.slice(0, 4));
  const century = Math.floor(thisYear / 100) * 100;
  let year = century + yy;
  if (kind === "birth" && `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}` > today) year -= 100;
  if (kind === "expiry" && year < thisYear - 50) year += 100;
  const iso = `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** ICAO codes that are not ISO alpha-3. */
const STATE_ALIASES: Record<string, string> = { D: "DEU", GBD: "GBR", GBN: "GBR", GBO: "GBR", GBP: "GBR", GBS: "GBR", RKS: "XKX" };
function state(raw: string): string {
  const code = letters(raw).replace(/<+$/, "");
  return STATE_ALIASES[code] ?? code;
}

const names = (field: string) => {
  const [sur = "", given = ""] = letters(field).replace(/<+$/, "").split("<<");
  const split = (s: string) => s.split("<").filter(Boolean);
  return { surnames: split(sur), givenNames: split(given) };
};

/** A field with its check digit, repaired toward digits when that makes the check agree. */
function checked(value: string, digit: string, numeric: boolean): { value: string; ok: boolean } {
  const d = digits(digit);
  if (checkDigit(value) === d) return { value, ok: true };
  const repaired = numeric ? digits(value) : value;
  return { value: repaired, ok: checkDigit(repaired) === d };
}

/**
 * The document number, with the ICAO rule for long numbers: when its check
 * digit is "<", the number goes on in the optional data up to a "<", and the
 * last character before it is the check digit.
 */
function documentNumber(field: string, digit: string, optional: string): { value: string; ok: boolean; optional: string } {
  if (digit === "<" && /^[A-Z0-9]/.test(optional)) {
    const rest = optional.split("<")[0] as string;
    const full = field + rest.slice(0, -1);
    return { value: full, ok: checkDigit(full) === rest.slice(-1), optional: optional.slice(rest.length) };
  }
  const r = checked(field, digit, false);
  return { ...r, optional };
}

export function parseMrz(text: string, today: string): MrzFields | null {
  const found = findMrzLines(text);
  if (!found) return null;
  const failed: string[] = [];
  const check = (name: string, r: { ok: boolean }) => {
    if (!r.ok) failed.push(name);
  };
  const { format, lines } = found;
  let documentCode: string, issuing: string, number: { value: string; ok: boolean; optional: string }, birth: { value: string; ok: boolean };
  let sexChar: string, expiry: { value: string; ok: boolean }, nationality: string, optional: string, nameField: string, composite: boolean;
  if (format === "TD1") {
    const [l1, l2, l3] = lines as [string, string, string];
    documentCode = l1.slice(0, 2).replace(/<+$/, "");
    issuing = l1.slice(2, 5);
    number = documentNumber(l1.slice(5, 14), l1.slice(14, 15), l1.slice(15, 30));
    birth = checked(l2.slice(0, 6), l2.slice(6, 7), true);
    sexChar = l2.slice(7, 8);
    expiry = checked(l2.slice(8, 14), l2.slice(14, 15), true);
    nationality = l2.slice(15, 18);
    optional = (number.optional + l2.slice(18, 29)).replace(/<+$/, "");
    nameField = l3;
    // Composite: line 1 from position 6, line 2 positions 1-7, 9-15, 19-29 (ICAO part 5).
    const comp = l1.slice(5, 30) + birth.value + l2.slice(6, 7) + expiry.value + l2.slice(14, 15) + l2.slice(18, 29);
    composite = checkDigit(comp) === digits(l2.slice(29, 30));
  } else {
    const [l1, l2] = lines as [string, string];
    const n = format === "TD3" ? 44 : 36;
    documentCode = l1.slice(0, 2).replace(/<+$/, "");
    issuing = l1.slice(2, 5);
    nameField = l1.slice(5, n);
    const optEnd = format === "TD3" ? 42 : 35;
    number = documentNumber(l2.slice(0, 9), l2.slice(9, 10), format === "TD2" ? l2.slice(28, 35) : "");
    nationality = l2.slice(10, 13);
    birth = checked(l2.slice(13, 19), l2.slice(19, 20), true);
    sexChar = l2.slice(20, 21);
    expiry = checked(l2.slice(21, 27), l2.slice(27, 28), true);
    if (format === "TD3") {
      optional = l2.slice(28, 42).replace(/<+$/, "");
      const personal = l2.slice(28, 42);
      const pd = l2.slice(42, 43);
      if (!(pd === "<" && /^<+$/.test(personal)) && checkDigit(personal) !== digits(pd) && pd !== "<") failed.push("optional");
      const comp = l2.slice(0, 10) + birth.value + l2.slice(19, 20) + expiry.value + l2.slice(27, 28) + l2.slice(28, 43);
      composite = checkDigit(comp) === digits(l2.slice(43, 44));
    } else {
      optional = number.optional.replace(/<+$/, "");
      const comp = l2.slice(0, 10) + birth.value + l2.slice(19, 20) + expiry.value + l2.slice(27, 35);
      composite = checkDigit(comp) === digits(l2.slice(optEnd, optEnd + 1));
    }
  }
  check("documentNumber", number);
  check("birthDate", birth);
  check("expiryDate", expiry);
  if (!composite) failed.push("composite");
  const { surnames, givenNames } = names(nameField);
  const sex: Sex | null = sexChar === "F" ? "female" : sexChar === "M" ? "male" : sexChar === "<" || sexChar === "X" ? "other" : null;
  return {
    format,
    documentCode: letters(documentCode),
    issuingState: state(issuing),
    documentNumber: number.value.replace(/<+$/, ""),
    optional,
    birthDate: mrzDate(digits(birth.value), "birth", today),
    sex,
    expiryDate: mrzDate(digits(expiry.value), "expiry", today),
    nationality: state(nationality),
    surnames,
    givenNames,
    valid: failed.length === 0,
    failed,
  };
}

/**
 * What the form can be filled with, in the shape of a Guest. Only what the
 * MRZ says: the guest checks it and completes the rest (places of birth and
 * of issue are not in the MRZ).
 */
export function guestFromMrz(m: MrzFields): Partial<Guest> {
  const g: Partial<Guest> = {};
  const word = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
  if (m.givenNames.length > 0) g.givenName = m.givenNames.map(word).join(" ");
  const spanishCard = m.issuingState === "ESP" && m.documentCode.startsWith("I");
  if (m.surnames.length > 0) {
    // A Spanish DNI writes the two surnames apart; other documents keep the surname whole.
    if (spanishCard && m.surnames.length === 2) {
      g.surname1 = word(m.surnames[0] as string);
      g.surname2 = word(m.surnames[1] as string);
    } else g.surname1 = m.surnames.map(word).join(" ");
  }
  if (m.birthDate) g.birthDate = m.birthDate;
  if (m.sex) g.sex = m.sex;
  if (isCountryCode(m.nationality)) g.nationality = m.nationality;
  const type: DocumentType = m.documentCode.startsWith("P") ? "passport" : spanishCard ? "dni" : m.issuingState === "ITA" ? "electronic_id" : "id_card";
  const issuedIn = isCountryCode(m.issuingState) ? { country: m.issuingState } : undefined;
  if (type === "dni") {
    // On the DNI the number field holds the support number; the DNI number is in the optional data.
    const dni = /^\d{8}[A-Z]/.exec(m.optional)?.[0];
    g.document = { type, number: dni ?? "", support: m.documentNumber, ...(issuedIn ? { issuedIn } : {}) };
  } else {
    g.document = { type, number: m.documentNumber, ...(m.issuingState === "ESP" && type === "passport" ? { spanish: true } : {}), ...(issuedIn ? { issuedIn } : {}) };
  }
  return g;
}
