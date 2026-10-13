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
}

export interface MappingResult {
  stays: ImportedStay[];
  /** Ids of cancelled bookings: they must not count any more. */
  cancelled: string[];
  /** Bookings that could not be read, with the reason. */
  skipped: string[];
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
    });
  }
  // A booking listed both as a reservation and as cancelled is cancelled.
  const cancelled = new Set(result.cancelled);
  result.stays = result.stays.filter((s) => !cancelled.has(s.uid));
  return result;
}
