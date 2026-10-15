/**
 * Italy, Alloggiati Web (Polizia di Stato): who must be communicated, by when,
 * and when the data goes.
 *
 * Sources, read on the official portal alloggiatiweb.poliziadistato.it:
 * - art. 109 TULPS, as amended by DL 53/2019: within 24 hours of arrival, within
 *   6 hours for stays of 24 hours or less;
 * - DM 7 January 2013 as amended by DM 16 September 2021 (GU n. 246 of
 *   14/10/2021): the record of the "schedina", the receipt kept 5 years, the
 *   data and any copy erased as soon as the receipt is generated (art. 4-bis);
 * - "Manuale Web-Services" Rev. 01 of 24/01/2022 and the user manual, ch. 12.
 *
 * Every guest needs a schedina: name, sex, birth date and place, citizenship.
 * Only the "single guest", head of family or head of group (the holder) gives
 * the identity document; family members and group members do not.
 */
import { addDays, addHours, ageOn, isDate } from "./dates.js";
import type { Deadline, DeadlineInput, DocumentType, Guest, HostDuty, Kind, Problem, RetentionRule, Stay, SubmissionRecord } from "./types.js";

/** The document types the Italian check-in form offers. */
export const ITALY_DOCUMENT_TYPES: readonly DocumentType[] = ["passport", "electronic_id", "id_card", "driving_licence"];

/** Alloggiati Web codes of the documents (table "Documenti" of the portal). */
export const ALLOGGIATI_DOCUMENT_CODES: Partial<Record<DocumentType, string>> = {
  passport: "PASOR",
  electronic_id: "IDELE",
  id_card: "IDENT",
  // A Spanish DNI is an identity card.
  dni: "IDENT",
  driving_licence: "PATEN",
};

/** The longest stay one schedina can declare ("massimo 30 gg"). */
export const MAX_DAYS = 30;

const nights = (checkIn: string, checkOut: string) => Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);

/** The surname as one field: Alloggiati Web has a single surname of up to 50 characters. */
export const fullSurname = (g: Guest) => [g.surname1, g.surname2].filter(Boolean).join(" ");

/** Family (17 and 19) when every other guest has a relationship to the holder, group (18 and 20) otherwise. */
export function lodgerTypes(guests: Guest[]): string[] {
  if (guests.length === 1) return ["16"];
  const family = guests.slice(1).every((g) => !!g.kinship);
  return guests.map((_, i) => (i === 0 ? (family ? "17" : "18") : family ? "19" : "20"));
}

/** What one guest must give. `index` 0 is the holder, the only one with a document. */
export function italyGuestRules(g: Guest, index: number, checkIn: string): Problem[] {
  const problems: Problem[] = [];
  const p = `guests[${index}]`;
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!g.givenName || !g.surname1) add(p, "name and surname are required");
  if (g.givenName && g.givenName.length > 30) add(`${p}.givenName`, "must be at most 30 characters for Alloggiati Web");
  if (fullSurname(g).length > 50) add(`${p}.surname1`, "the surnames together must be at most 50 characters for Alloggiati Web");
  if (!g.sex) add(`${p}.sex`, "the sex is required");
  else if (g.sex === "other") add(`${p}.sex`, "Alloggiati Web accepts only male or female: use the one on the identity document");
  if (!g.birthDate) add(`${p}.birthDate`, "the date of birth is required");
  else if (isDate(checkIn) && ageOn(g.birthDate, checkIn) < 0) add(`${p}.birthDate`, "the date of birth comes after the arrival");
  if (!g.nationality) add(`${p}.nationality`, "the citizenship is required");
  if (!g.birthPlace?.country) add(`${p}.birthPlace.country`, "the country of birth is required");
  else if (g.birthPlace.country === "ITA" && !g.birthPlace.locality) add(`${p}.birthPlace.locality`, "the municipality of birth is required for someone born in Italy");
  if (index === 0) {
    const d = g.document;
    if (!d) add(`${p}.document`, "the identity document of the holder is required");
    else {
      if (!ALLOGGIATI_DOCUMENT_CODES[d.type]) add(`${p}.document.type`, "Alloggiati Web takes a passport, an identity card or a driving licence");
      if (d.number && !/^[A-Z0-9./-]{1,20}$/.test(d.number)) add(`${p}.document.number`, "must be up to 20 letters, digits, dots, dashes or slashes");
      if (!d.issuedIn?.country) add(`${p}.document.issuedIn.country`, "the country that issued the document is required");
      else if (d.issuedIn.country === "ITA" && !d.issuedIn.locality) add(`${p}.document.issuedIn.locality`, "the municipality that issued the document is required for an Italian document");
    }
  }
  return problems;
}

/** Everything Alloggiati Web needs for the stay. There is no communication of the booking in Italy. */
export function italyRules(stay: Stay, kind: Kind): Problem[] {
  if (kind === "reservation") return [];
  const problems: Problem[] = [];
  const add = (path: string, message: string) => problems.push({ path, message });
  if (!isDate(stay.checkIn) || !isDate(stay.checkOut) || stay.checkOut <= stay.checkIn) add("checkOut", "check-out must come after check-in");
  else if (nights(stay.checkIn, stay.checkOut) > MAX_DAYS) {
    add("checkOut", `a schedina declares at most ${MAX_DAYS} days: for a longer stay ask the Questura how to communicate it`);
  }
  if (!Number.isInteger(stay.people) || stay.people < 1) add("people", "the number of people is missing");
  if (stay.guests.length < stay.people) add("guests", `${stay.guests.length} of ${stay.people} guests registered`);
  if (stay.guests.length > stay.people) add("people", `${stay.guests.length} guests registered for ${stay.people} people: correct the number of people`);
  stay.guests.forEach((g, i) => problems.push(...italyGuestRules(g, i, stay.checkIn)));
  return problems;
}

/** Days of stay in the schedina. */
export const daysOfStay = (stay: { checkIn: string; checkOut: string }) => nights(stay.checkIn, stay.checkOut);

/**
 * Art. 109 TULPS: within 24 hours of arrival, within 6 hours when the stay
 * lasts 24 hours or less. Without check-in and check-out times a one-night
 * stay counts as 24 hours or less, and the count starts at midnight: the date
 * shown is never later than the real one.
 */
export function italyDeadlines(s: DeadlineInput): Deadline[] {
  const start = `${s.checkIn}T${s.checkInTime ?? "00:00"}`;
  const short =
    s.checkOut !== undefined &&
    s.checkOut === addDays(s.checkIn, 1) &&
    (s.checkInTime === undefined || s.checkOutTime === undefined || s.checkOutTime <= s.checkInTime);
  const hours = short ? 6 : 24;
  const from = s.checkInTime ? `arrival (${start.replace("T", " ")})` : `arrival (${s.checkIn}, hour not set: counted from midnight)`;
  return [{ kind: "checkin", due: addHours(start, hours), from: short ? `${from}; a stay of 24 hours or less has 6 hours` : from }];
}

/**
 * DM 7/1/2013, art. 4-bis (as amended in 2021): the data is erased as soon as
 * the receipt exists; only the receipt is kept, for 5 years. A cancelled stay
 * has nothing to communicate, so its data goes at once.
 */
export function italyRetention(stay: { checkOut: string; cancelledAt: string | null }, _duty: HostDuty, records: SubmissionRecord[]): RetentionRule {
  const accepted = records
    .filter((r) => r.kind === "checkin" && r.status === "accepted")
    .map((r) => r.at)
    .sort()[0];
  if (accepted) return { eraseFrom: accepted, reason: "communicated to Alloggiati Web: the data goes as soon as the receipt exists, only the receipt is kept (DM 7/1/2013, art. 4-bis)" };
  if (stay.cancelledAt) return { eraseFrom: stay.cancelledAt, reason: "booking cancelled: there is nothing to communicate to Alloggiati Web" };
  return { eraseFrom: null, reason: "kept until Alloggiati Web accepts the schedine" };
}

/** Years the Alloggiati Web receipt is kept (DM 7/1/2013, art. 4-bis). */
export const RECEIPT_YEARS = 5;
