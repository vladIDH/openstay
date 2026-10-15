/**
 * Writing the drafts: for each stay whose last message is the guest's and has
 * no draft yet, gather what the assistant may know and ask the model.
 *
 * What goes to the model: the house file (without the access codes, unless
 * the stay is in progress), the dates and times of the stay, whether the
 * guest registration is done (Fairguest), which nights around the stay are
 * free (Fairnight's calendars, dates only) and the last messages. Never a
 * price, never the guest's name, document or contact details.
 */
import { existsSync, readFileSync } from "node:fs";
import { addDays } from "fairguest";
import {
  anthropicRequest,
  buildPrompt,
  finishDraft,
  ModelError,
  ollamaRequest,
  parseHouse,
  readAnthropic,
  readOllama,
  type DraftRequest,
  type House,
  type ModelAnswer,
  type Prompt,
} from "fairhello";
import { SetupError, unitsOf, type HostConfig, type HostListing } from "../config.js";
import type { Db } from "../db.js";
import { stripBom, type Io } from "../io.js";
import { guestsEnabled, peopleCount } from "../guests/store.js";
import { housePath, loadAnthropicKey, type HelloSettings } from "./settings.js";
import { activeStays, addDraft, conversation, draftForMessage, lastMessage, setStayLanguage, type HelloStayRow } from "./store.js";

/** Nights looked at before check-in and after check-out. */
const NEARBY_NIGHTS = 3;

export function readHouse(dir: string, listing: string): House | null {
  const file = housePath(dir, listing);
  if (!existsSync(file)) return null;
  return parseHouse(stripBom(readFileSync(file, "utf8")));
}

function occupied(db: Db, listing: string, night: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM calendar_events WHERE listing = ? AND removed_at IS NULL AND check_in <= ? AND check_out > ? LIMIT 1")
      .get(listing, night, night) !== undefined
  );
}

/**
 * Free nights right before check-in and right after check-out, from the
 * calendars Fairnight reads (only up to the first taken night, never before
 * today). Null for a room type with several units: one free unit says nothing
 * about this guest's room.
 */
export function nearbyNights(db: Db, listing: HostListing, stay: { check_in: string; check_out: string }, today: string): { freeBefore: string[]; freeAfter: string[] } | null {
  if (unitsOf(listing) > 1) return null;
  const freeBefore: string[] = [];
  for (let i = 1; i <= NEARBY_NIGHTS; i++) {
    const night = addDays(stay.check_in, -i);
    if (night < today || occupied(db, listing.name, night)) break;
    freeBefore.unshift(night);
  }
  const freeAfter: string[] = [];
  for (let i = 0; i < NEARBY_NIGHTS; i++) {
    const night = addDays(stay.check_out, i);
    if (occupied(db, listing.name, night)) break;
    freeAfter.push(night);
  }
  return { freeBefore, freeAfter };
}

/** People registered for this stay with Fairguest, or null when the listing does not use it. */
export function registrationOf(db: Db, listing: HostListing, stay: { check_in: string; check_out: string }): { registered: number } | null {
  if (!listing.fairguest || !guestsEnabled(db)) return null;
  const row = db
    .prepare("SELECT id FROM guest_stays WHERE listing = ? AND check_in = ? AND check_out = ? AND cancelled_at IS NULL AND erased_at IS NULL ORDER BY seen_at LIMIT 1")
    .get(listing.name, stay.check_in, stay.check_out) as { id: string } | undefined;
  return { registered: row ? peopleCount(db, row.id) : 0 };
}

export function draftRequest(db: Db, house: House, listing: HostListing, stay: HelloStayRow, today: string, settings: HelloSettings): DraftRequest {
  return {
    house,
    stay: {
      title: house.title ?? listing.pricing.name ?? listing.name,
      checkIn: stay.check_in,
      checkOut: stay.check_out,
      checkInTime: listing.fairguest?.checkInTime ?? null,
      checkOutTime: listing.fairguest?.checkOutTime ?? null,
      guests: stay.guests,
      language: stay.language,
    },
    today,
    messages: conversation(db, stay.id).map((m) => ({ from: m.sender, text: m.text })),
    signature: settings.signature,
    registration: registrationOf(db, listing, stay),
    nearby: nearbyNights(db, listing, stay, today),
  };
}

const realFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => fetch(url, init);

/** Send the request to the model chosen by the host and read its answer. */
export async function askModel(prompt: Prompt, settings: HelloSettings, dir: string, io: Io): Promise<ModelAnswer> {
  const anthropic = settings.provider === "anthropic";
  const req = anthropic
    ? anthropicRequest(prompt, { apiKey: loadAnthropicKey(dir, io.env ?? {}), model: settings.model, ...(io.anthropicBaseUrl ? { baseUrl: io.anthropicBaseUrl } : {}) })
    : ollamaRequest(prompt, { model: settings.model, baseUrl: settings.ollamaUrl });
  let res;
  try {
    res = await (io.modelFetch ?? realFetch)(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(anthropic ? 120_000 : 300_000) });
  } catch (e) {
    throw new ModelError(
      anthropic
        ? `Could not reach Anthropic (${(e as Error).name === "TimeoutError" ? "no answer in time" : "network"}). Check the internet connection and try again.`
        : `Could not reach Ollama at ${settings.ollamaUrl}. Is it running ("ollama serve")?`,
      true,
      true,
    );
  }
  const text = await res.text();
  return anthropic ? readAnthropic(res.status, text) : readOllama(res.status, text, settings.model);
}

export interface DraftReport {
  written: number;
  /** Listings with guest messages but no casa/<listing>.md: no draft without it. */
  noHouse: string[];
  /** Stays left for the next reading (the limit per reading was reached). */
  postponed: number;
  failed: { stay: string; error: string }[];
  tokens: { input: number; output: number; cached: number };
  /** A problem that stopped all drafts (wrong key, no key). */
  stopped: string | null;
}

export async function writeDrafts(db: Db, dir: string, io: Io, config: HostConfig, settings: HelloSettings, today: string): Promise<DraftReport> {
  const report: DraftReport = { written: 0, noHouse: [], postponed: 0, failed: [], tokens: { input: 0, output: 0, cached: 0 }, stopped: null };
  const houses = new Map<string, House | null>();
  for (const stay of activeStays(db, today)) {
    const last = lastMessage(db, stay.id);
    if (!last || last.sender !== "guest" || draftForMessage(db, stay.id, last.id)) continue;
    const listing = config.listings.find((l) => l.name === stay.listing);
    if (!listing) continue;
    if (!houses.has(listing.name)) houses.set(listing.name, readHouse(dir, listing.name));
    const house = houses.get(listing.name) ?? null;
    if (!house || house.sections.length === 0) {
      if (!report.noHouse.includes(listing.name)) report.noHouse.push(listing.name);
      continue;
    }
    if (report.written + report.failed.length >= settings.maxDraftsPerRun || report.stopped) {
      report.postponed++;
      continue;
    }
    const request = draftRequest(db, house, listing, stay, today, settings);
    try {
      const answer = await askModel(buildPrompt(request), settings, dir, io);
      const draft = finishDraft(answer.draft, request);
      addDraft(db, { stayId: stay.id, messageId: last.id, text: draft.text, language: draft.language, needsHost: draft.needsHost, note: draft.note, flags: draft.flags, model: `${settings.provider}:${settings.model}` }, io.now());
      if (draft.language) setStayLanguage(db, stay.id, draft.language);
      report.written++;
      report.tokens.input += answer.usage.input + answer.usage.cacheWrite;
      report.tokens.output += answer.usage.output;
      report.tokens.cached += answer.usage.cacheRead;
    } catch (e) {
      if ((e instanceof ModelError && e.fatal) || e instanceof SetupError) {
        report.stopped = e.message;
        report.postponed++;
        continue;
      }
      if (!(e instanceof ModelError)) throw e;
      report.failed.push({ stay: stay.id, error: e.message });
    }
  }
  return report;
}
