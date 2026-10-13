/**
 * From Smoobu bookings to what Fairnight stores: stays and blocked dates for
 * the calendar, and the price of each stay for the (optional) history.
 */
import type { SmoobuBooking } from "./client.js";

const ISO = /^\d{4}-\d{2}-\d{2}/;

export interface ImportedStay {
  uid: string;
  apartmentId: number;
  checkIn: string;
  checkOut: string;
  /** "blocked" for Smoobu's blocked dates: unavailable, never counted as a booking. */
  kind: "reservation" | "blocked";
  /** The day the booking was made (YYYY-MM-DD), from Smoobu's created-at. Null for blocks. */
  bookedAt: string | null;
  /** The price of the whole stay, when Smoobu has one (reservations only). */
  stayPrice: { total: number; nights: number; perNight: number } | null;
  /** Holder, number of guests and reference, for guest registration only. Null for blocks. */
  guests: BookingGuests | null;
}

export interface MappingResult {
  stays: ImportedStay[];
  /** Ids of cancelled bookings: they must not count any more. */
  cancelled: string[];
  /** Bookings that could not be read, with the reason. */
  skipped: string[];
}

/**
 * Who stays, as the channel manager knows it: only for guest registration
 * (Fairguest), which seals it. Pricing never reads it and it is never printed.
 */
export interface BookingGuests {
  firstName: string | null;
  lastName: string | null;
  /** Adults plus children, when known. */
  guests: number | null;
  /** The booking reference on the channel. */
  reference: string | null;
}

const textOrNull = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t === "" ? null : t;
};
const countOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};
function guestCount(adults: unknown, children: unknown): number | null {
  const a = countOrNull(adults);
  const c = countOrNull(children);
  return a === null && c === null ? null : (a ?? 0) + (c ?? 0);
}

/** Smoobu gives firstname/lastname, or only guest-name. */
function smoobuGuests(b: SmoobuBooking): BookingGuests {
  const first = textOrNull(b.firstname);
  const last = textOrNull(b.lastname);
  return {
    firstName: first ?? (last ? null : textOrNull(b["guest-name"])),
    lastName: last,
    guests: guestCount(b.adults, b.children),
    reference: textOrNull(b["reference-id"]),
  };
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function mapBookings(bookings: readonly SmoobuBooking[]): MappingResult {
  const result: MappingResult = { stays: [], cancelled: [], skipped: [] };
  const seen = new Set<string>();
  for (const b of bookings) {
    const uid = String(b.id);
    if (String(b.type).toLowerCase() === "cancellation") {
      result.cancelled.push(uid);
      continue;
    }
    if (seen.has(uid)) continue;
    const checkIn = String(b.arrival ?? "").match(ISO)?.[0];
    const checkOut = String(b.departure ?? "").match(ISO)?.[0];
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      result.skipped.push(`booking ${uid} has unreadable dates (${b.arrival} → ${b.departure})`);
      continue;
    }
    seen.add(uid);
    const blocked = b["is-blocked-booking"] === true;
    const nights = nightsBetween(checkIn, checkOut);
    const total = Number(b.price);
    result.stays.push({
      uid,
      apartmentId: Number(b.apartment?.id),
      checkIn,
      checkOut,
      kind: blocked ? "blocked" : "reservation",
      bookedAt: blocked ? null : (String(b["created-at"] ?? "").match(ISO)?.[0] ?? null),
      stayPrice:
        !blocked && Number.isFinite(total) && total > 0
          ? { total, nights, perNight: Math.round((total / nights) * 100) / 100 }
          : null,
      guests: blocked ? null : smoobuGuests(b),
    });
  }
  // A booking listed both as a reservation and as cancelled is cancelled.
  const cancelled = new Set(result.cancelled);
  result.stays = result.stays.filter((s) => !cancelled.has(s.uid));
  return result;
}
