/**
 * The neutral shapes every country works with. Nothing here is specific to one
 * country's format: each registry (es-ses, es-mossos, later Italy and Portugal)
 * turns them into its own codes.
 *
 * Dates are "YYYY-MM-DD", times "HH:mm", both in the host's local time.
 */

export const COUNTRIES = ["ES", "ES-CT"] as const;
/** Where the communication goes: ES = SES.HOSPEDAJES, ES-CT = Mossos d'Esquadra (Catalonia). */
export type Country = (typeof COUNTRIES)[number];

export const DOCUMENT_TYPES = ["dni", "nie", "passport", "other"] as const;
/** dni = Spanish NIF/DNI (and TIE), nie = Spanish foreigner number, passport, other identity document. */
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SEXES = ["female", "male", "other"] as const;
export type Sex = (typeof SEXES)[number];

/**
 * Only the TYPE of payment: Real Decreto 933/2021 makes nothing else mandatory,
 * so card numbers, IBANs and card holders are never asked for nor stored.
 */
export const PAYMENT_TYPES = ["platform", "card", "cash", "transfer", "mobile", "voucher", "at_destination", "other"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/** Relationship to the holder, asked when the group includes a minor. */
export const KINSHIPS = [
  "parent",
  "child",
  "sibling",
  "spouse",
  "grandparent",
  "grandchild",
  "great_grandparent",
  "great_grandchild",
  "uncle_aunt",
  "nephew_niece",
  "parent_in_law",
  "child_in_law",
  "sibling_in_law",
  "guardian",
  "other",
] as const;
export type Kinship = (typeof KINSHIPS)[number];

export interface IdentityDocument {
  type: DocumentType;
  number: string;
  /** Support number of a Spanish DNI or NIE card (9 characters). */
  support?: string;
  /** Day the document was issued. */
  issuedOn?: string;
  /** For passports: true when issued by Spain (it changes the field it goes in for the Mossos). */
  spanish?: boolean;
}

export interface Address {
  /** ISO 3166-1 alpha-3, e.g. "ESP", "ITA". */
  country: string;
  street?: string;
  /** Town or city as written by the guest (abroad). */
  locality?: string;
  postalCode?: string;
  /** Municipality code of the Spanish INE (6 digits with the check digit), for addresses in Spain. */
  municipalityCode?: string;
}

export interface Guest {
  givenName: string;
  surname1: string;
  surname2?: string;
  birthDate?: string;
  sex?: Sex;
  /** ISO 3166-1 alpha-3. */
  nationality?: string;
  document?: IdentityDocument;
  address?: Address;
  phone?: string;
  phone2?: string;
  email?: string;
  /** Relationship to the holder; needed for minors. */
  kinship?: Kinship;
}

/**
 * A stay as the registry sees it. `guests` is everyone who sleeps there,
 * holder first; before check-in it may hold only the holder's name.
 */
export interface Stay {
  /** Random id of the stay in the local archive. */
  id: string;
  /** Establishment code given by the authority (SES codigoEstablecimiento, Mossos ID). */
  establishment: string;
  establishmentName?: string;
  /** Booking reference or contract number. */
  reference: string;
  contractDate: string;
  checkIn: string;
  checkInTime?: string;
  checkOut: string;
  checkOutTime?: string;
  /** Number of people staying. */
  people: number;
  rooms?: number;
  internet?: boolean;
  payment?: { type: PaymentType };
  guests: Guest[];
}

/** RH = reservation (booking made, changed or cancelled), PV = guests at check-in. */
export type Kind = "reservation" | "checkin";

export interface Problem {
  /** Where the problem is, e.g. "guests[1].document.number". */
  path: string;
  message: string;
}

export interface Deadline {
  kind: Kind;
  /** Local date-time "YYYY-MM-DDTHH:mm" by which the communication must be made. */
  due: string;
  /** What the 24 hours count from, in words. */
  from: string;
}

/** What would be sent, prepared without any network access. */
export interface Submission {
  country: Country;
  kind: Kind;
  stayIds: string[];
  /** How it leaves the computer: through a web service, or a file the host uploads. */
  channel: "web-service" | "file";
  /** Files to write (the Mossos .txt). Content as bytes, ready to save. */
  files: { name: string; bytes: Uint8Array; text: string }[];
}

export type OutcomeStatus = "sent" | "accepted" | "rejected" | "cancelled";

/** What the authority answered: a batch number to check later, or the final outcome. */
export interface Receipt {
  country: Country;
  kind: Kind;
  /** SES batch number (UUID), when the service gives one. */
  batch?: string;
  at: string;
}

export interface Outcome {
  status: OutcomeStatus;
  /** Messages of the authority, one per line, as they came. */
  detail: string[];
}

/** When the personal data of a stay can be (must be) erased. */
export interface RetentionRule {
  /** Local date-time from which the data is erased; null = keep for now. */
  eraseFrom: string | null;
  reason: string;
}

export interface HostDuty {
  /** Registered in the Spanish Censo de Empresarios: has to keep the register for 3 years. */
  professional: boolean;
}

/** One submission already recorded for a stay (for retention and reminders). */
export interface SubmissionRecord {
  kind: Kind;
  status: OutcomeStatus | "prepared";
  at: string;
}

/**
 * One implementation per country. Network access is never inside: `send` and
 * `status` receive a transport from the caller, so the registry stays testable.
 */
export interface Registry {
  country: Country;
  /** Name of the authority and its portal, for messages. */
  authority: string;
  validate(stay: Stay, kind: Kind): Problem[];
  deadlines(stay: { checkIn: string; checkInTime?: string; bookedAt?: string | null; seenAt: string }): Deadline[];
  /** Exactly what would leave the computer. Throws NotAvailableError when the format is not written yet. */
  prepare(stays: Stay[], kind: Kind, at: string): Submission;
  send?(submission: Submission, transport: Transport): Promise<Receipt>;
  status?(receipt: Receipt, transport: Transport): Promise<Outcome>;
  cancel?(receipt: Receipt, transport: Transport): Promise<Outcome>;
  retention(stay: { checkOut: string; cancelledAt: string | null }, duty: HostDuty, records: SubmissionRecord[]): RetentionRule;
}

/** A SOAP/HTTP call made by the caller; the registry builds the request and reads the answer. */
export type Transport = (request: { url: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; body: string }>;

/** A format that cannot be produced yet: the message says why and what is needed. */
export class NotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAvailableError";
  }
}
