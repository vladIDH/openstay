/**
 * The two things the guest assistant does, shared by the commands and the page:
 * - read: new messages from Smoobu and Beds24, drafts for the guests waiting
 *   for an answer, and the erasing of old conversations;
 * - send: one draft the host approved, after checking again that it is still
 *   the right answer.
 */
import { localDateTime } from "fairguest";
import { Beds24Error } from "fairnight-beds24";
import { SmoobuError } from "fairnight-smoobu";
import type { StaleReason } from "fairhello";
import { loadHostConfig, SetupError } from "../config.js";
import { openDb, type Db } from "../db.js";
import { dbPath, localToday, type Io } from "../io.js";
import { writeDrafts, type DraftReport } from "./drafts.js";
import { loadSettings } from "./settings.js";
import { beds24Linked, deliver, readBeds24, readSmoobu, refreshConversation, smoobuLinked, type ReadReport } from "./sources.js";
import {
  blockedByPrice,
  claimDraft,
  editDraft,
  eraseOld,
  freshnessOf,
  getDraft,
  getStay,
  markFailed,
  markSent,
  recordRun,
  textToSend,
} from "./store.js";

export interface ReadSummary {
  reads: ReadReport[];
  drafts: DraftReport | null;
  erased: number;
}

const channelError = (e: unknown): string | null =>
  e instanceof SmoobuError || e instanceof Beds24Error || e instanceof SetupError ? (e as Error).message : null;

export async function readAndDraft(dir: string, io: Io, options: { drafts: boolean }): Promise<ReadSummary> {
  const config = loadHostConfig(dir);
  const settings = loadSettings(dir);
  const today = localToday(io.now());
  const db = openDb(dbPath(dir));
  try {
    const summary: ReadSummary = { reads: [], drafts: null, erased: eraseOld(db, today, settings.retentionDays, io.now()) };
    if (!smoobuLinked(config.listings) && !beds24Linked(config.listings)) {
      throw new SetupError(
        'No listing is linked to Smoobu or Beds24: guest messages are read through them. Run "fairnight smoobu importa" or "fairnight beds24 importa" first.',
      );
    }
    for (const [source, read] of [
      ["smoobu", () => readSmoobu(db, dir, io, config.listings, today)],
      ["beds24", () => readBeds24(db, dir, io, config.listings, today, settings.retentionDays)],
    ] as const) {
      if (source === "smoobu" ? !smoobuLinked(config.listings) : !beds24Linked(config.listings)) continue;
      try {
        summary.reads.push(await read());
      } catch (e) {
        const message = channelError(e);
        if (message === null) throw e;
        summary.reads.push({ source, stays: 0, newMessages: 0, error: message });
      }
    }
    if (options.drafts) summary.drafts = await writeDrafts(db, dir, io, config, settings, today);
    const t = summary.drafts?.tokens ?? { input: 0, output: 0, cached: 0 };
    recordRun(
      db,
      {
        stays: summary.reads.reduce((n, r) => n + r.stays, 0),
        newMessages: summary.reads.reduce((n, r) => n + r.newMessages, 0),
        drafts: summary.drafts?.written ?? 0,
        inputTokens: t.input,
        outputTokens: t.output,
        cachedTokens: t.cached,
        error: [...summary.reads.map((r) => r.error), summary.drafts?.stopped ?? null].filter(Boolean).join(" | ") || null,
      },
      io.now(),
    );
    return summary;
  } finally {
    db.close();
  }
}

/** One line per part of a reading, for the terminal (English, like the other commands). */
export function formatReadSummary(s: ReadSummary): string[] {
  const lines: string[] = [];
  for (const r of s.reads) {
    const name = r.source === "smoobu" ? "Smoobu" : "Beds24";
    lines.push(r.error ? `${name}: could not read the messages. ${r.error}` : `${name}: ${r.stays} bookings, ${r.newMessages} new message${r.newMessages === 1 ? "" : "s"}.`);
  }
  const d = s.drafts;
  if (d) {
    lines.push(`Drafts written: ${d.written}.` + (d.written > 0 ? ` Tokens: ${d.tokens.input} in, ${d.tokens.output} out, ${d.tokens.cached} read from cache.` : ""));
    for (const l of d.noHouse) lines.push(`Listing "${l}" has guests waiting but no casa/${l}.md: no draft without it. Write it with "fairnight risposte casa --listing ${l}".`);
    for (const f of d.failed) lines.push(`No draft for ${f.stay}: ${f.error}`);
    if (d.stopped) lines.push(`Drafts stopped: ${d.stopped}`);
    if (d.postponed > 0) lines.push(`${d.postponed} conversation${d.postponed === 1 ? "" : "s"} left for the next reading.`);
  }
  if (s.erased > 0) lines.push(`Erased the messages of ${s.erased} stay${s.erased === 1 ? "" : "s"} past the retention period.`);
  return lines;
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; reason: StaleReason | "not_found" | "price" | "error"; detail?: string };

/**
 * Send one draft. In order: the host's edit is saved; the conversation is read
 * again from the channel; the draft must still be fresh and free of prices;
 * it is claimed (so a double click sends once); then it goes out.
 */
export async function sendDraft(dir: string, io: Io, id: number, editedText?: string): Promise<SendOutcome> {
  const settings = loadSettings(dir);
  const db = openDb(dbPath(dir));
  try {
    return await sendWith(db, dir, io, id, settings.retentionDays, editedText);
  } finally {
    db.close();
  }
}

async function sendWith(db: Db, dir: string, io: Io, id: number, retentionDays: number, editedText?: string): Promise<SendOutcome> {
  const before = getDraft(db, id);
  if (!before) return { ok: false, reason: "not_found" };
  const stay = getStay(db, before.stay_id);
  if (!stay) return { ok: false, reason: "not_found" };
  if (editedText !== undefined) editDraft(db, id, editedText, io.now());
  try {
    await refreshConversation(db, dir, io, stay, retentionDays);
  } catch (e) {
    const message = channelError(e);
    if (message === null) throw e;
    return { ok: false, reason: "error", detail: message };
  }
  const draft = getDraft(db, id);
  if (!draft) return { ok: false, reason: "not_found" };
  const fresh = freshnessOf(db, draft, localToday(io.now()));
  if (!fresh.sendable) return { ok: false, reason: fresh.reason };
  if (blockedByPrice(draft)) return { ok: false, reason: "price" };
  if (!claimDraft(db, id, io.now())) return { ok: false, reason: "already_sent" };
  try {
    await deliver(dir, io, stay, textToSend(draft));
  } catch (e) {
    const message = channelError(e) ?? `unexpected error: ${(e as Error).message}`;
    markFailed(db, id, `${localDateTime(io.now())} ${message}`);
    return { ok: false, reason: "error", detail: message };
  }
  markSent(db, id, io.now());
  return { ok: true };
}
