/**
 * The guest assistant's tables (hello_*): stays, messages, drafts, readings.
 * Every function takes an open database; nothing here talks to the network.
 */
import { addDays, localDateTime } from "fairguest";
import { checkFreshness, GRACE_DAYS, type DraftStatus, type Flag, type Freshness, type Sender } from "fairhello";
import type { Db } from "../db.js";

export type HelloSource = "smoobu" | "beds24";

export interface HelloStayRow {
  id: string;
  listing: string;
  source: HelloSource;
  booking_id: number;
  check_in: string;
  check_out: string;
  language: string | null;
  channel: string | null;
  guests: number | null;
  seen_at: string;
  cancelled_at: string | null;
  erased_at: string | null;
}

export interface MessageRow {
  stay_id: string;
  id: string;
  seq: number;
  sender: Sender;
  text: string;
  sent_at: string | null;
  seen_at: string;
}

export interface DraftRow {
  id: number;
  stay_id: string;
  message_id: string;
  text: string;
  edited_text: string | null;
  language: string | null;
  needs_host: number;
  note: string | null;
  flags: string;
  model: string;
  status: DraftStatus;
  created_at: string;
  decided_at: string | null;
  sent_at: string | null;
  error: string | null;
}

export interface StayInput {
  listing: string;
  source: HelloSource;
  bookingId: number;
  checkIn: string;
  checkOut: string;
  language: string | null;
  channel: string | null;
  guests: number | null;
  cancelled: boolean;
}

export interface MessageInput {
  id: string;
  seq: number;
  from: Sender;
  text: string;
  sentAt: string | null;
}

export const stayIdOf = (source: HelloSource, bookingId: number) => `${source}:${bookingId}`;

/** Does this database have the Fairhello tables? (A read-only older one may not.) */
export function helloTablesExist(db: Db): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hello_drafts'").get() !== undefined;
}

/** Insert or update a booking; the language found by a draft is kept when the channel has none. */
export function upsertStay(db: Db, s: StayInput, now: Date): HelloStayRow {
  const id = stayIdOf(s.source, s.bookingId);
  const at = localDateTime(now);
  const existing = getStay(db, id);
  if (!existing) {
    db.prepare(
      "INSERT INTO hello_stays (id, listing, source, booking_id, check_in, check_out, language, channel, guests, seen_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, s.listing, s.source, s.bookingId, s.checkIn, s.checkOut, s.language, s.channel, s.guests, at, s.cancelled ? at : null);
  } else {
    db.prepare("UPDATE hello_stays SET listing = ?, check_in = ?, check_out = ?, language = ?, channel = ?, guests = ?, cancelled_at = ? WHERE id = ?").run(
      s.listing,
      s.checkIn,
      s.checkOut,
      s.language ?? existing.language,
      s.channel ?? existing.channel,
      s.guests ?? existing.guests,
      s.cancelled ? (existing.cancelled_at ?? at) : null,
      id,
    );
  }
  return getStay(db, id) as HelloStayRow;
}

export function getStay(db: Db, id: string): HelloStayRow | null {
  return (db.prepare("SELECT * FROM hello_stays WHERE id = ?").get(id) as HelloStayRow | undefined) ?? null;
}

/** Stays still worth answering: not cancelled, not erased, check-out at most GRACE_DAYS ago. */
export function activeStays(db: Db, today: string): HelloStayRow[] {
  return db
    .prepare("SELECT * FROM hello_stays WHERE cancelled_at IS NULL AND erased_at IS NULL AND check_out >= ? ORDER BY check_in, id")
    .all(addDays(today, -GRACE_DAYS)) as HelloStayRow[];
}

export function setStayLanguage(db: Db, id: string, language: string): void {
  db.prepare("UPDATE hello_stays SET language = ? WHERE id = ? AND language IS NULL").run(language, id);
}

/** The highest message order stored for a stay, or null when none. */
export function lastSeq(db: Db, stayId: string): number | null {
  const r = db.prepare("SELECT MAX(seq) AS s FROM hello_messages WHERE stay_id = ?").get(stayId) as { s: number | null };
  return r.s;
}

/** Store the messages not seen before; returns how many were new. */
export function saveMessages(db: Db, stayId: string, messages: MessageInput[], now: Date): number {
  const at = localDateTime(now);
  const insert = db.prepare("INSERT OR IGNORE INTO hello_messages (stay_id, id, seq, sender, text, sent_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  let added = 0;
  db.transaction(() => {
    for (const m of messages) added += insert.run(stayId, m.id, m.seq, m.from, m.text, m.sentAt, at).changes;
  })();
  return added;
}

export function conversation(db: Db, stayId: string): MessageRow[] {
  return db.prepare("SELECT * FROM hello_messages WHERE stay_id = ? ORDER BY seq, id").all(stayId) as MessageRow[];
}

export function lastMessage(db: Db, stayId: string): MessageRow | null {
  return (db.prepare("SELECT * FROM hello_messages WHERE stay_id = ? ORDER BY seq DESC, id DESC LIMIT 1").get(stayId) as MessageRow | undefined) ?? null;
}

export function draftForMessage(db: Db, stayId: string, messageId: string): DraftRow | null {
  return (db.prepare("SELECT * FROM hello_drafts WHERE stay_id = ? AND message_id = ?").get(stayId, messageId) as DraftRow | undefined) ?? null;
}

export interface NewDraft {
  stayId: string;
  messageId: string;
  text: string;
  language: string | null;
  needsHost: boolean;
  note: string;
  flags: Flag[];
  model: string;
}

export function addDraft(db: Db, d: NewDraft, now: Date): number {
  const r = db
    .prepare(
      "INSERT INTO hello_drafts (stay_id, message_id, text, language, needs_host, note, flags, model, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)",
    )
    .run(d.stayId, d.messageId, d.text, d.language, d.needsHost ? 1 : 0, d.note || null, JSON.stringify(d.flags), d.model, localDateTime(now));
  return Number(r.lastInsertRowid);
}

export function getDraft(db: Db, id: number): DraftRow | null {
  return (db.prepare("SELECT * FROM hello_drafts WHERE id = ?").get(id) as DraftRow | undefined) ?? null;
}

export function flagsOf(d: DraftRow): Flag[] {
  try {
    const v = JSON.parse(d.flags) as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as Flag[]) : [];
  } catch {
    return [];
  }
}

/** The text that would be sent: the host's version when there is one. */
export const textToSend = (d: DraftRow) => d.edited_text ?? d.text;

/** A draft the model wrote with an amount of money in it cannot go out until the host edits it. */
export const blockedByPrice = (d: DraftRow) => flagsOf(d).includes("price") && d.edited_text === null;

export function freshnessOf(db: Db, d: DraftRow, today: string): Freshness {
  const stay = getStay(db, d.stay_id);
  if (!stay || stay.erased_at) return { sendable: false, reason: "stay_ended" };
  const last = lastMessage(db, d.stay_id);
  const latest = db.prepare("SELECT MAX(id) AS id FROM hello_drafts WHERE stay_id = ?").get(d.stay_id) as { id: number };
  return checkFreshness({
    draft: { id: d.id, messageId: d.message_id, status: d.status },
    stay: { cancelled: stay.cancelled_at !== null, checkOut: stay.check_out },
    lastMessage: last ? { id: last.id, from: last.sender } : undefined,
    latestDraftId: latest.id,
    today,
  });
}

export interface DraftView {
  draft: DraftRow;
  stay: HelloStayRow;
  freshness: Freshness;
}

/** Drafts not sent and not discarded, with their stay and whether they can still be sent. */
export function openDrafts(db: Db, today: string): DraftView[] {
  const rows = db.prepare("SELECT * FROM hello_drafts WHERE status IN ('waiting', 'approved', 'failed') ORDER BY created_at, id").all() as DraftRow[];
  return rows.flatMap((d) => {
    const stay = getStay(db, d.stay_id);
    return stay && !stay.erased_at ? [{ draft: d, stay, freshness: freshnessOf(db, d, today) }] : [];
  });
}

export function editDraft(db: Db, id: number, text: string, now: Date): void {
  const d = getDraft(db, id);
  if (!d) return;
  const t = text.replace(/\r\n?/g, "\n").trim();
  // The host's own words are kept apart from the model's: a draft flagged for a price
  // becomes sendable only once the host has written a version of their own.
  if (t === d.text.trim() && d.edited_text === null) return;
  db.prepare("UPDATE hello_drafts SET edited_text = ?, decided_at = ? WHERE id = ? AND status IN ('waiting', 'approved', 'failed')").run(t, localDateTime(now), id);
}

export function discardDraft(db: Db, id: number, now: Date): boolean {
  return db.prepare("UPDATE hello_drafts SET status = 'discarded', decided_at = ? WHERE id = ? AND status IN ('waiting', 'approved', 'failed')").run(localDateTime(now), id).changes === 1;
}

/** Take the draft for sending, once: a second click or a second window gets false. */
export function claimDraft(db: Db, id: number, now: Date): boolean {
  return (
    db.prepare("UPDATE hello_drafts SET status = 'sending', decided_at = ?, error = NULL WHERE id = ? AND status IN ('waiting', 'approved', 'failed')").run(localDateTime(now), id).changes === 1
  );
}

export function markSent(db: Db, id: number, now: Date): void {
  db.prepare("UPDATE hello_drafts SET status = 'sent', sent_at = ? WHERE id = ?").run(localDateTime(now), id);
}

export function markFailed(db: Db, id: number, error: string): void {
  db.prepare("UPDATE hello_drafts SET status = 'failed', error = ? WHERE id = ?").run(error.slice(0, 500), id);
}

export interface RunRecord {
  stays: number;
  newMessages: number;
  drafts: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  error: string | null;
}

export function recordRun(db: Db, r: RunRecord, now: Date): void {
  db.prepare("INSERT INTO hello_runs (at, stays, new_messages, drafts, input_tokens, output_tokens, cached_tokens, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    localDateTime(now),
    r.stays,
    r.newMessages,
    r.drafts,
    r.inputTokens,
    r.outputTokens,
    r.cachedTokens,
    r.error,
  );
}

export function lastRun(db: Db): { at: string; error: string | null } | null {
  return (db.prepare("SELECT at, error FROM hello_runs ORDER BY id DESC LIMIT 1").get() as { at: string; error: string | null } | undefined) ?? null;
}

/** Tokens used in the last 30 days, for `fairnight risposte stato`. */
export function tokensSince(db: Db, since: string): { input: number; output: number; cached: number; drafts: number } {
  const r = db
    .prepare("SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cached_tokens),0) AS c, COALESCE(SUM(drafts),0) AS d FROM hello_runs WHERE at >= ?")
    .get(since) as { i: number; o: number; c: number; d: number };
  return { input: r.i, output: r.o, cached: r.c, drafts: r.d };
}

/**
 * Erase the messages and drafts of stays that ended more than `days` days ago
 * (and of cancelled ones, counted from check-out too). The stay row stays,
 * marked erased, so the booking is not read again.
 */
export function eraseOld(db: Db, today: string, days: number, now: Date): number {
  const limit = addDays(today, -days);
  const old = db.prepare("SELECT id FROM hello_stays WHERE erased_at IS NULL AND check_out < ?").all(limit) as { id: string }[];
  const at = localDateTime(now);
  db.transaction(() => {
    for (const s of old) {
      db.prepare("DELETE FROM hello_messages WHERE stay_id = ?").run(s.id);
      db.prepare("DELETE FROM hello_drafts WHERE stay_id = ?").run(s.id);
      db.prepare("UPDATE hello_stays SET erased_at = ?, guests = NULL, language = NULL WHERE id = ?").run(at, s.id);
    }
  })();
  return old.length;
}
