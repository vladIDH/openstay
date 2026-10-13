/**
 * From Beds24 bookings to what Fairnight stores.
 *
 * - confirmed, new, request: bookings (stays)
 * - black: blocked dates (unavailable, never a booking)
 * - cancelled: removed, also if imported before
 * - inquiry: ignored (not asked for)
 */
import type { Beds24Booking } from "./client.js";

const ISO = /^\d{4}-\d{2}-\d{2}/;
const BOOKED = new Set(["confirmed", "new", "request"]);

export interface ImportedStay {
  uid: string;
  roomId: number;
  checkIn: string;
  checkOut: string;
  kind: "reservation" | "blocked";
  /** Day the booking was made (from bookingTime, UTC), null for blocks. */
  bookedAt: string | null;
  /** Total price of the stay, when Beds24 has one (bookings only). */
  stayPrice: { total: number; nights: number; perNight: number } | null;
}

export interface MappingResult {
  stays: ImportedStay[];
  cancelled: string[];
  skipped: string[];
}

const nights = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function mapBookings(bookings: readonly Beds24Booking[]): MappingResult {
  const result: MappingResult = { stays: [], cancelled: [], skipped: [] };
  const seen = new Set<string>();
  for (const b of bookings) {
    const uid = String(b.id);
    const status = String(b.status ?? "").toLowerCase();
    if (status === "cancelled") {
      result.cancelled.push(uid);
      continue;
    }
    if (!BOOKED.has(status) && status !== "black") continue; // inquiry or unknown: not a booking
    if (seen.has(uid)) continue;
    const checkIn = String(b.arrival ?? "").match(ISO)?.[0];
    const checkOut = String(b.departure ?? "").match(ISO)?.[0];
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      result.skipped.push(`booking ${uid} has unreadable dates (${b.arrival} → ${b.departure})`);
      continue;
    }
    seen.add(uid);
    const blocked = status === "black";
    const n = nights(checkIn, checkOut);
    const total = Number(b.price);
    result.stays.push({
      uid,
      roomId: Number(b.roomId),
      checkIn,
      checkOut,
      kind: blocked ? "blocked" : "reservation",
      bookedAt: blocked ? null : (String(b.bookingTime ?? "").match(ISO)?.[0] ?? null),
      stayPrice: !blocked && Number.isFinite(total) && total > 0 ? { total, nights: n, perNight: Math.round((total / n) * 100) / 100 } : null,
    });
  }
  const cancelled = new Set(result.cancelled);
  result.stays = result.stays.filter((s) => !cancelled.has(s.uid));
  return result;
}
