/**
 * Where the guests' messages come from and where the replies go: Smoobu and
 * Beds24, through their official APIs and the host's own keys (the same ones
 * Fairnight already uses for prices). No email, no scraping.
 */
import { addDays } from "fairguest";
import { GRACE_DAYS } from "fairhello";
import { beds24BookingChannel, beds24BookingLanguage, listBeds24Messages, sendBeds24Message } from "fairnight-beds24";
import { bookingChannel, bookingLanguage, listMessages, listThreads, sendMessageToGuest } from "fairnight-smoobu";
import { isBeds24, isSmoobu, type HostListing } from "../config.js";
import type { Db } from "../db.js";
import { beds24Client } from "../beds24.js";
import { smoobuClient } from "../smoobu.js";
import type { Io } from "../io.js";
import { activeStays, lastSeq, saveMessages, upsertStay, type HelloStayRow, type StayInput } from "./store.js";

export interface ReadReport {
  source: "smoobu" | "beds24";
  stays: number;
  newMessages: number;
  error: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}/;
const count = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};
const sum = (a: unknown, b: unknown) => (count(a) === null && count(b) === null ? null : (count(a) ?? 0) + (count(b) ?? 0));

export const smoobuLinked = (listings: HostListing[]) => listings.some((l) => l.calendars.some(isSmoobu));
export const beds24Linked = (listings: HostListing[]) => listings.some((l) => l.calendars.some(isBeds24));

/** Bookings and new messages from Smoobu. Conversations that did not change are not read again. */
export async function readSmoobu(db: Db, dir: string, io: Io, listings: HostListing[], today: string): Promise<ReadReport> {
  const report: ReadReport = { source: "smoobu", stays: 0, newMessages: 0, error: null };
  const byApartment = new Map<number, string>();
  for (const l of listings) for (const c of l.calendars) if (isSmoobu(c)) byApartment.set(c.apartmentId, l.name);
  if (byApartment.size === 0) return report;
  const client = smoobuClient(dir, io);
  const bookings = await client.listReservations({ departureFrom: addDays(today, -GRACE_DAYS) });
  const now = io.now();
  for (const b of bookings) {
    const listing = byApartment.get(Number(b.apartment?.id));
    if (!listing || b["is-blocked-booking"] === true) continue;
    const arrival = String(b.arrival ?? "").match(ISO)?.[0];
    const departure = String(b.departure ?? "").match(ISO)?.[0];
    if (!arrival || !departure) continue;
    const raw = b as unknown as Record<string, unknown>;
    const stay: StayInput = {
      listing,
      source: "smoobu",
      bookingId: Number(b.id),
      checkIn: arrival,
      checkOut: departure,
      language: bookingLanguage(b),
      channel: bookingChannel(b),
      guests: sum(raw.adults, raw.children),
      cancelled: String(b.type).toLowerCase() === "cancellation",
    };
    upsertStay(db, stay, now);
    report.stays++;
  }
  const active = new Map(activeStays(db, today).filter((s) => s.source === "smoobu").map((s) => [s.booking_id, s]));
  if (active.size === 0) return report;
  for (const t of await listThreads(client, [...byApartment.keys()])) {
    const stay = active.get(t.bookingId);
    if (!stay || t.latestMessageId === null) continue;
    const seen = lastSeq(db, stay.id);
    if (seen !== null && seen >= t.latestMessageId) continue;
    const messages = await listMessages(client, t.bookingId);
    report.newMessages += saveMessages(
      db,
      stay.id,
      messages.map((m) => ({ id: String(m.id), seq: m.id, from: m.from, text: m.text, sentAt: null })),
      now,
    );
  }
  return report;
}

/** Bookings and their messages from Beds24 (one request for up to 50 bookings). */
export async function readBeds24(db: Db, dir: string, io: Io, listings: HostListing[], today: string, retentionDays: number): Promise<ReadReport> {
  const report: ReadReport = { source: "beds24", stays: 0, newMessages: 0, error: null };
  const byRoom = new Map<number, string>();
  for (const l of listings) for (const c of l.calendars) if (isBeds24(c)) byRoom.set(c.roomId, l.name);
  if (byRoom.size === 0) return report;
  const client = beds24Client(dir, io);
  const bookings = await client.listBookings({ departureFrom: addDays(today, -GRACE_DAYS), roomIds: [...byRoom.keys()] });
  const now = io.now();
  for (const b of bookings) {
    const listing = byRoom.get(Number(b.roomId));
    const status = String(b.status ?? "").toLowerCase();
    if (!listing || status === "black") continue;
    const arrival = String(b.arrival ?? "").match(ISO)?.[0];
    const departure = String(b.departure ?? "").match(ISO)?.[0];
    if (!arrival || !departure) continue;
    upsertStay(
      db,
      {
        listing,
        source: "beds24",
        bookingId: Number(b.id),
        checkIn: arrival,
        checkOut: departure,
        language: beds24BookingLanguage(b),
        channel: beds24BookingChannel(b),
        guests: sum(b.numAdult, b.numChild),
        cancelled: status === "cancelled",
      },
      now,
    );
    report.stays++;
  }
  const active = activeStays(db, today).filter((s) => s.source === "beds24");
  if (active.length === 0) return report;
  const byBooking = new Map<number, HelloStayRow>(active.map((s) => [s.booking_id, s]));
  const messages = await listBeds24Messages(client, [...byBooking.keys()], retentionDays);
  for (const [bookingId, stay] of byBooking) {
    const mine = messages.filter((m) => m.bookingId === bookingId);
    if (mine.length === 0) continue;
    report.newMessages += saveMessages(
      db,
      stay.id,
      mine.map((m) => ({ id: String(m.id), seq: m.id, from: m.from, text: m.text, sentAt: m.time })),
      now,
    );
  }
  return report;
}

/** Read one conversation again right before sending: a guest may have written in the meantime. */
export async function refreshConversation(db: Db, dir: string, io: Io, stay: HelloStayRow, retentionDays: number): Promise<number> {
  const now = io.now();
  if (stay.source === "smoobu") {
    const messages = await listMessages(smoobuClient(dir, io), stay.booking_id);
    return saveMessages(db, stay.id, messages.map((m) => ({ id: String(m.id), seq: m.id, from: m.from, text: m.text, sentAt: null })), now);
  }
  const messages = await listBeds24Messages(beds24Client(dir, io), [stay.booking_id], retentionDays);
  return saveMessages(
    db,
    stay.id,
    messages.filter((m) => m.bookingId === stay.booking_id).map((m) => ({ id: String(m.id), seq: m.id, from: m.from, text: m.text, sentAt: m.time })),
    now,
  );
}

/** Send the approved text to the guest through the channel manager of the booking. */
export async function deliver(dir: string, io: Io, stay: HelloStayRow, text: string): Promise<void> {
  if (stay.source === "smoobu") await sendMessageToGuest(smoobuClient(dir, io), stay.booking_id, text);
  else await sendBeds24Message(beds24Client(dir, io), stay.booking_id, text);
}
