/**
 * What Spain's two channels (SES.HOSPEDAJES and the Mossos d'Esquadra) share:
 * the 24-hour deadlines of Real Decreto 933/2021, the retention rule, and the
 * code tables published in the SES bulk-upload instructions (v1.1.0), which
 * the Mossos manual (v8, May 2025) repeats for payment and kinship.
 */
import { addDays, addHours, addYears } from "./dates.js";
import type { Deadline, DeadlineInput, DocumentType, HostDuty, Kinship, PaymentType, RetentionRule, Sex, SubmissionRecord } from "./types.js";

/** Payment types: the same five-letter codes for SES and the Mossos. */
export const PAYMENT_CODES: Record<PaymentType, string> = {
  platform: "PLATF",
  card: "TARJT",
  cash: "EFECT",
  transfer: "TRANS",
  mobile: "MOVIL",
  voucher: "TREG",
  at_destination: "DESTI",
  other: "OTRO",
};

/** Relationship to the holder: the same two-letter codes for SES and the Mossos. */
export const KINSHIP_CODES: Record<Kinship, string> = {
  grandparent: "AB",
  great_grandparent: "BA",
  great_grandchild: "BN",
  sibling_in_law: "CD",
  spouse: "CY",
  child: "HJ",
  sibling: "HR",
  grandchild: "NI",
  other: "OT",
  parent: "PM",
  nephew_niece: "SB",
  parent_in_law: "SG",
  uncle_aunt: "TI",
  guardian: "TU",
  child_in_law: "YN",
};

/** SES codes (bulk-upload instructions); the Mossos use other letters, see es-mossos. */
export const SES_DOCUMENT_CODES: Record<DocumentType, string> = {
  dni: "NIF",
  nie: "NIE",
  passport: "PAS",
  id_card: "OTRO",
  electronic_id: "OTRO",
  driving_licence: "OTRO",
  other: "OTRO",
};
/** The document types the Spanish check-in form offers. */
export const SPAIN_DOCUMENT_TYPES: readonly DocumentType[] = ["dni", "nie", "passport", "other"];
export const SES_SEX_CODES: Record<Sex, string> = { male: "H", female: "M", other: "O" };

/**
 * Real Decreto 933/2021, art. 6.3: "immediately and in any case within 24 hours",
 * once from the booking (RH) and once from the start of the stay (PV).
 * When the hour is not known the count starts at midnight, so the date shown
 * is never later than the real one.
 */
export function spainDeadlines(s: DeadlineInput): Deadline[] {
  const reservation: Deadline = s.bookedAt
    ? s.bookedAt.length > 10
      ? { kind: "reservation", due: addHours(s.bookedAt, 24), from: `the booking (${s.bookedAt.replace("T", " ")})` }
      : { kind: "reservation", due: `${addDays(s.bookedAt, 1)}T00:00`, from: `the booking (${s.bookedAt}, hour not known: counted from midnight)` }
    : { kind: "reservation", due: addHours(s.seenAt, 24), from: `when Fairguest first saw the booking (${s.seenAt.replace("T", " ")}); the booking date is not known` };
  const start = `${s.checkIn}T${s.checkInTime ?? "00:00"}`;
  const checkin: Deadline = {
    kind: "checkin",
    due: addHours(start, 24),
    from: s.checkInTime ? `check-in (${start.replace("T", " ")})` : `check-in (${s.checkIn}, hour not set: counted from midnight)`,
  };
  return [reservation, checkin];
}

/** Hours left after a cancellation to communicate it, while the reference is still needed. */
export const CANCELLATION_HOURS = 48;

/**
 * Real Decreto 933/2021, art. 5.3 and 5.4:
 * - professional hosts keep the register 3 years from the end of the stay;
 * - non-professional hosts must communicate but not keep anything: the data
 *   goes as soon as the check-in communication is confirmed, or soon after a
 *   cancellation.
 */
export function spainRetention(stay: { checkOut: string; cancelledAt: string | null }, duty: HostDuty, records: SubmissionRecord[]): RetentionRule {
  if (duty.professional) {
    return { eraseFrom: `${addYears(stay.checkOut, 3)}T00:00`, reason: "professional host: the register is kept 3 years from the end of the stay (RD 933/2021, art. 5.3)" };
  }
  const accepted = records
    .filter((r) => r.kind === "checkin" && r.status === "accepted")
    .map((r) => r.at)
    .sort()[0];
  if (accepted) {
    return { eraseFrom: accepted, reason: "non-professional host: nothing has to be kept (art. 5.4) and the check-in communication is confirmed" };
  }
  if (stay.cancelledAt) {
    return {
      eraseFrom: addHours(stay.cancelledAt, CANCELLATION_HOURS),
      reason: `non-professional host and booking cancelled: kept ${CANCELLATION_HOURS} hours to communicate the cancellation`,
    };
  }
  return { eraseFrom: null, reason: "non-professional host: kept until the check-in communication is confirmed" };
}
