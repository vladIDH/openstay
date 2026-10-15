/**
 * The messages of Beds24 bookings (API v2, /bookings/messages), for the guest
 * assistant (Fairhello). Kept apart from the pricing client.
 *
 * - The invite code must include the "bookings-personal" scope with write
 *   access: messages are guest data.
 * - GET  /bookings/messages?bookingId=…&maxAge=…: the messages of many
 *   bookings at once, with source (guest, host, system, internalNote) and time.
 *   Internal notes are never read.
 * - POST /bookings/messages [{ bookingId, message }]: the reply. Beds24 sends
 *   it only for bookings that came from a channel (Airbnb, Booking.com,
 *   Expedia, Vrbo), as plain text.
 */
import { Beds24Error, type Beds24Booking, type Beds24Client } from "./client.js";

export interface Beds24Message {
  id: number;
  bookingId: number;
  from: "guest" | "host" | "system";
  text: string;
  /** When it was written, ISO, as Beds24 says. */
  time: string | null;
}

/** Bookings per request: keeps the URL short. */
export const BOOKINGS_PER_REQUEST = 50;
const MAX_PAGES = 50;

const FROM: Record<string, Beds24Message["from"]> = { guest: "guest", host: "host", system: "system" };

/** Messages of these bookings written in the last `maxAgeDays` days, oldest first. */
export async function listMessages(client: Beds24Client, bookingIds: number[], maxAgeDays = 60): Promise<Beds24Message[]> {
  const out: Beds24Message[] = [];
  const maxAge = Math.min(999, Math.max(1, Math.round(maxAgeDays)));
  for (let i = 0; i < bookingIds.length; i += BOOKINGS_PER_REQUEST) {
    const ids = bookingIds.slice(i, i + BOOKINGS_PER_REQUEST);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { body } = await client.request<{
        data?: { id?: number; bookingId?: number; source?: string; message?: unknown; time?: unknown }[];
        pages?: { nextPageExists?: boolean };
      }>("GET", "/bookings/messages", { bookingId: ids, maxAge, page: page > 1 ? page : undefined });
      for (const m of body.data ?? []) {
        const from = FROM[m.source ?? ""];
        if (!from || typeof m.id !== "number" || typeof m.bookingId !== "number" || typeof m.message !== "string" || m.message.trim() === "") continue;
        out.push({ id: m.id, bookingId: m.bookingId, from, text: m.message.trim(), time: typeof m.time === "string" ? m.time : null });
      }
      if (!body.pages?.nextPageExists) break;
    }
  }
  return out.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.id - b.id);
}

/** Send a reply to the guest of a booking; Beds24's own error when it refuses. */
export async function sendMessage(client: Beds24Client, bookingId: number, text: string): Promise<void> {
  if (text.trim() === "") throw new Beds24Error("An empty message cannot be sent.", null);
  const { body } = await client.request<unknown>("POST", "/bookings/messages", {}, [{ bookingId, message: text }]);
  const answer = Array.isArray(body) ? (body[0] as { success?: boolean; errors?: { message?: string }[] } | undefined) : undefined;
  if (!answer || answer.success === false || (answer.errors ?? []).length > 0) {
    const why = (answer?.errors ?? []).map((e) => e.message).filter(Boolean).join("; ");
    throw new Beds24Error(`Beds24 did not send the message${why ? `: ${why}` : ""}. Beds24 sends messages only for bookings that came from a channel.`, null);
  }
}

/** The guest's language, when Beds24 knows it ("en", "de"…). */
export function bookingLanguage(b: Beds24Booking): string | null {
  const v = (b as unknown as Record<string, unknown>).lang;
  return typeof v === "string" && /^[a-z]{2}$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/** The channel of a booking, when Beds24 says it ("airbnb", "booking"…). */
export function bookingChannel(b: Beds24Booking): string | null {
  const r = b as unknown as Record<string, unknown>;
  const v = typeof r.channel === "string" ? r.channel : typeof r.referer === "string" ? r.referer : null;
  return v && v.trim() !== "" ? v.trim() : null;
}
