/**
 * The messages of a Smoobu booking (docs.smoobu.com, "Messages"), for the
 * guest assistant (Fairhello). Kept apart from the pricing client: these calls
 * read and write what guests and hosts say to each other.
 *
 * - GET  /api/threads: one row per booking with its latest message, so only
 *   the conversations that changed are read again.
 * - GET  /api/reservations/{id}/messages: every message of a booking, by pages.
 *   Smoobu gives no time for a message: its id is the order.
 *   type 1 = from the guest (inbox), type 2 = from the host (outbox).
 * - POST /api/reservations/{id}/messages/send-message-to-guest: the reply,
 *   in plain text. Smoobu passes it on to the channel of the booking.
 */
import { SmoobuError, type SmoobuBooking, type SmoobuClient } from "./client.js";

export interface SmoobuMessage {
  id: number;
  from: "guest" | "host";
  text: string;
}

export interface SmoobuThread {
  bookingId: number;
  apartmentId: number | null;
  latestMessageId: number | null;
}

const MAX_PAGES = 50;

/** Plain text of a message: the text part, or the HTML one without its tags. */
export function messageText(m: { message?: unknown; messageHtml?: unknown; htmlMessage?: unknown }): string {
  if (typeof m.message === "string" && m.message.trim() !== "") return m.message.trim();
  const html = typeof m.messageHtml === "string" ? m.messageHtml : typeof m.htmlMessage === "string" ? m.htmlMessage : "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every conversation with its latest message id, all pages. */
export async function listThreads(client: SmoobuClient, apartments?: number[]): Promise<SmoobuThread[]> {
  const out: SmoobuThread[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await client.request<{
      page_count?: number;
      threads?: { booking?: { id?: number }; apartment?: { id?: number }; latest_message?: { id?: number } | null }[];
    }>("GET", "/api/threads", { page_number: page, page_size: 100, ...(apartments && apartments.length > 0 ? { apartments } : {}) });
    for (const t of body.threads ?? []) {
      if (typeof t.booking?.id !== "number") continue;
      out.push({
        bookingId: t.booking.id,
        apartmentId: typeof t.apartment?.id === "number" ? t.apartment.id : null,
        latestMessageId: typeof t.latest_message?.id === "number" ? t.latest_message.id : null,
      });
    }
    if (page >= (body.page_count ?? 1)) break;
  }
  return out;
}

/** Every message between the guest and the host of a booking, oldest first. */
export async function listMessages(client: SmoobuClient, reservationId: number): Promise<SmoobuMessage[]> {
  const all: SmoobuMessage[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await client.request<{
      page_count?: number;
      messages?: { id?: number; type?: number; message?: unknown; messageHtml?: unknown; htmlMessage?: unknown }[];
    }>("GET", `/api/reservations/${reservationId}/messages`, { page });
    for (const m of body.messages ?? []) {
      if (typeof m.id !== "number" || (m.type !== 1 && m.type !== 2)) continue;
      const text = messageText(m);
      if (text === "") continue;
      all.push({ id: m.id, from: m.type === 1 ? "guest" : "host", text });
    }
    if (page >= (body.page_count ?? 1)) break;
  }
  return all.sort((a, b) => a.id - b.id);
}

/** Send a reply to the guest of a booking, in plain text. */
export async function sendMessageToGuest(client: SmoobuClient, reservationId: number, text: string): Promise<void> {
  if (text.trim() === "") throw new SmoobuError("An empty message cannot be sent.", null);
  await client.request("POST", `/api/reservations/${reservationId}/messages/send-message-to-guest`, {}, { messageBody: text });
}

/** The guest's language, when Smoobu knows it ("en", "de"…). */
export function bookingLanguage(b: SmoobuBooking): string | null {
  const v = (b as unknown as Record<string, unknown>).language;
  return typeof v === "string" && /^[a-z]{2,3}([-_][a-z0-9]+)?$/i.test(v.trim()) ? v.trim().slice(0, 2).toLowerCase() : null;
}

/** The channel of a booking ("Airbnb", "Booking.com"…), when Smoobu says it. */
export function bookingChannel(b: SmoobuBooking): string | null {
  const c = (b as unknown as Record<string, unknown>).channel as { name?: unknown } | undefined;
  return typeof c?.name === "string" && c.name.trim() !== "" ? c.name.trim() : null;
}
