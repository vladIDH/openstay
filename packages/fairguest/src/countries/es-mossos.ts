/**
 * Catalonia, Mossos d'Esquadra: the text file uploaded by hand on
 * registreviatgers.mossos.gencat.cat ("Envío de ficheros masivos").
 *
 * Built from the public manual "Manual de instrucciones de la página web
 * Registro de viajeros", version 8 (May 2025), chapter 4 and the example of
 * chapter 9, downloadable from the portal's documents page without logging in:
 * - one record 1 (establishment) followed by one record 2 per traveller;
 * - fields separated by "|", empty fields keep their "|", no fixed widths;
 * - alphabetic values in capitals, records separated by CR LF, none after the last;
 * - format "V24" in record 1, which turns on the checks of the 2024 fields;
 * - file name: the establishment ID, a dot and a sequence 001…999 (then 001 again).
 *
 * We write one file per establishment, never the record 0 of hotel groups. The
 * file is never sent by Fairguest: the host uploads it.
 */
import { KINSHIP_CODES, PAYMENT_CODES, spainDeadlines, spainRetention } from "../spain.js";
import { NotAvailableError, type DocumentType, type Guest, type Kind, type Problem, type Registry, type Sex, type Stay, type Submission } from "../types.js";
import { spainRules } from "../validate.js";

export const MOSSOS_PORTAL = "https://registreviatgers.mossos.gencat.cat";

const DOCUMENT_CODES: Record<DocumentType, string> = { dni: "D", nie: "N", passport: "P", other: "O" };
const SEX_CODES: Record<Sex, string> = { female: "F", male: "M", other: "O" };

/** Western European alphabet only: what fits in ISO-8859-1. */
const LATIN1 = /^[ -~ -ÿ]*$/;

const compact = (d: string | undefined) => (d ? d.replaceAll("-", "") : "");
const hhmm = (t: string | undefined) => (t ? t.replace(":", "") : "0000");
/** No separator or line break can get into a field. */
const clean = (v: string | undefined) => (v ?? "").replace(/[|\s]+/g, " ").trim();
const upper = (v: string | undefined) => clean(v).toLocaleUpperCase("es");

function mossosRules(stay: Stay, kind: Kind): Problem[] {
  const problems = spainRules(stay, kind, 14);
  const add = (path: string, message: string) => problems.push({ path, message });
  if (stay.establishment && !/^[A-Z0-9]{1,10}$/.test(stay.establishment)) add("establishment", "the Mossos establishment ID is at most 10 capital letters and digits");
  if (!stay.establishmentName) add("establishmentName", "the establishment name is required in the Mossos file (fairguest.establishmentName)");
  else if (stay.establishmentName.length > 40) add("establishmentName", "the establishment name must be at most 40 characters");
  if (stay.reference.length > 20) add("reference", "the contract number must be at most 20 characters for the Mossos");
  if (stay.people > 999) add("people", "at most 999 people");
  if (stay.rooms !== undefined && (stay.rooms < 1 || stay.rooms > 999)) add("rooms", "the number of rooms must be from 1 to 999");
  const list = kind === "reservation" ? stay.guests.slice(0, 1) : stay.guests;
  list.forEach((g, i) => {
    const p = `guests[${i}]`;
    for (const key of ["givenName", "surname1", "surname2"] as const) {
      const v = g[key];
      if (v && v.length > 30) add(`${p}.${key}`, "must be at most 30 characters for the Mossos");
    }
    for (const [key, v] of Object.entries({ givenName: g.givenName, surname1: g.surname1, surname2: g.surname2, street: g.address?.street, locality: g.address?.locality })) {
      if (v && !LATIN1.test(v)) add(`${p}.${key}`, "has letters the Mossos file cannot carry: write it in Latin letters, as in the machine-readable lines of the document");
    }
    if (kind === "reservation" && !g.phone && !g.phone2 && !g.email) add(p, "the Mossos ask for a phone number or an email of the holder also for a reservation");
  });
  return problems;
}

/** One record 2: the 32 fields of the manual, then the closing "|" as in its example. */
function travellerLine(stay: Stay, g: Guest, kind: Kind): string {
  const doc = g.document;
  const spanishNumber = doc && (doc.type === "dni" || (doc.type === "passport" && doc.spanish)) ? doc.number : "";
  const foreignNumber = doc && !spanishNumber ? doc.number : "";
  const inSpain = g.address?.country === "ESP";
  const fields = [
    "2",
    clean(spanishNumber),
    clean(foreignNumber),
    doc ? DOCUMENT_CODES[doc.type] : "",
    compact(doc?.issuedOn),
    upper(g.surname1),
    upper(g.surname2),
    upper(g.givenName),
    g.sex ? SEX_CODES[g.sex] : "",
    compact(g.birthDate),
    g.nationality ?? "",
    compact(stay.checkIn),
    hhmm(stay.checkInTime),
    compact(stay.checkOut),
    hhmm(stay.checkOutTime),
    compact(stay.contractDate),
    kind === "checkin" ? "C" : "R",
    upper(stay.reference),
    String(stay.people),
    stay.rooms !== undefined ? String(stay.rooms) : "",
    stay.internet === undefined ? "" : stay.internet ? "S" : "N",
    stay.payment ? PAYMENT_CODES[stay.payment.type] : "",
    clean(g.phone ?? g.phone2),
    g.kinship ? KINSHIP_CODES[g.kinship] : "",
    clean(g.email),
    clean(doc?.support),
    upper(g.address?.street),
    inSpain ? (g.address?.postalCode ?? "").slice(0, 2) : "",
    inSpain ? clean(g.address?.municipalityCode) : "",
    inSpain ? "" : upper(g.address?.locality),
    g.address?.country ?? "",
    clean(g.address?.postalCode),
  ];
  return `${fields.join("|")}|`;
}

/**
 * The file for one establishment. `at` is the local date-time of creation
 * ("YYYY-MM-DDTHH:mm"); `sequence` is 1…999.
 */
export function mossosFile(stays: Stay[], kind: Kind, at: string, sequence: number): { name: string; text: string; bytes: Uint8Array } {
  const first = stays[0];
  if (!first) throw new Error("No stay to put in the file.");
  if (stays.some((s) => s.establishment !== first.establishment)) throw new Error("One Mossos file holds one establishment: prepare each establishment on its own.");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) throw new Error("The sequence of a Mossos file goes from 1 to 999.");
  const travellers = stays.flatMap((s) => (kind === "reservation" ? s.guests.slice(0, 1) : s.guests).map((g) => travellerLine(s, g, kind)));
  const header = ["1", first.establishment, upper(first.establishmentName).slice(0, 40), compact(at.slice(0, 10)), at.slice(11, 16).replace(":", ""), String(travellers.length), "V24"].join("|");
  const text = [header, ...travellers].join("\r\n");
  if (!LATIN1.test(text.replace(/\r\n/g, ""))) throw new Error("The file has characters outside the Western European alphabet: correct the guests' data first.");
  return { name: `${first.establishment}.${String(sequence).padStart(3, "0")}`, text, bytes: Buffer.from(text, "latin1") };
}

export const mossosRegistry: Registry & { file: typeof mossosFile } = {
  country: "ES-CT",
  authority: "Mossos d'Esquadra (registreviatgers.mossos.gencat.cat)",
  validate: mossosRules,
  deadlines: spainDeadlines,
  /** Use `file` to get the bytes with a sequence number; `prepare` uses sequence 1. */
  prepare(stays: Stay[], kind: Kind, at: string): Submission {
    const problems = stays.flatMap((s) => mossosRules(s, kind).map((p) => `${s.id}: ${p.path}: ${p.message}`));
    if (problems.length > 0) throw new NotAvailableError(`The Mossos file cannot be made yet:\n${problems.join("\n")}`);
    const f = mossosFile(stays, kind, at, 1);
    return { country: "ES-CT", kind, stayIds: stays.map((s) => s.id), channel: "file", files: [f] };
  },
  retention: spainRetention,
  file: mossosFile,
};

