/**
 * The check-in link from the host's computer: it creates the stay's mailbox on
 * the relay, downloads what the guests sealed there and deletes it. Only
 * outgoing requests: the host's computer opens no port.
 *
 * What travels to the relay: the box id, the read secret (to read and delete),
 * the hash of the write secret and the expiry. The host's public key, the
 * write secret, the listing and the dates go only in the link, after "#".
 * The sealed guests are stored as they come (sealed for "relay/<box>") and are
 * opened only with the passphrase, like every other guest.
 */
import { createHash, randomBytes } from "node:crypto";
import { addDays, BOX_ID, linkFor, localDateTime, relayPlace, type LinkPayload } from "fairguest";
import type { HostConfig } from "../config.js";
import type { Db } from "../db.js";
import type { Io, RelayFetchLike } from "../io.js";
import { addRelayPerson, guestsEnabled, hasTable, peopleCount, readKeys, type StayRow } from "./store.js";

export const DEFAULT_RELAY = "https://fairguest.khlumen.com";
/** The MRZ model the page loads: tessdata_fast/mrz.traineddata of DoubangoTelecom/tesseractMRZ, commit 1e7adfec (see fairguest-relay/scripts/assets.mjs). */
export const MRZ_MODEL_SHA256 = "ece2a54f125a73792f9cec74e6f8e62f6e5e00c7f19153ba865af689be5b5f01";
/** How long the relay keeps a box after check-out, for late guests and late downloads. */
export const BOX_DAYS_AFTER_CHECKOUT = 2;
const MAX_GUESTS = 50;
const MAX_MESSAGE = 24 * 1024;

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayError";
  }
}

export const relayOf = (config: HostConfig) => config.fairguestRelay ?? DEFAULT_RELAY;

function relayFetch(io: Io): RelayFetchLike {
  return io.relayFetch ?? ((url, init) => fetch(url, init));
}

async function call(io: Io, relay: string, method: string, path: string, read: string, body?: string): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { authorization: `Bearer ${read}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  let res;
  try {
    res = await relayFetch(io)(`${relay}${path}`, { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new RelayError(`The relay ${relay} cannot be reached (${(e as Error).message}).`);
  }
  return { status: res.status, text: await res.text() };
}

const secret = (bytes: number) => randomBytes(bytes).toString("base64url");

export interface RelayRow extends StayRow {
  relay_box: string | null;
  relay_read: string | null;
  relay_write: string | null;
}

export function relayRow(db: Db, id: string): RelayRow | null {
  return (db.prepare("SELECT * FROM guest_stays WHERE id = ?").get(id) as RelayRow | undefined) ?? null;
}

/** The last day the box lives: a couple of days after check-out, at noon UTC. */
const expiryOf = (row: StayRow) => `${addDays(row.check_out, BOX_DAYS_AFTER_CHECKOUT)}T12:00:00Z`;

/**
 * The link of a stay: the box is created on the relay the first time, then the
 * same link is given again. `title` and `country` are what the guest sees.
 */
export async function stayLink(db: Db, io: Io, config: HostConfig, row: StayRow, payload: { title: string; country: LinkPayload["c"] }): Promise<string> {
  const record = readKeys(db);
  if (!record) throw new RelayError('Guest registration is not turned on: "fairnight ospiti attiva".');
  const relay = relayOf(config);
  let r = relayRow(db, row.id) as RelayRow;
  if (!r.relay_box || !r.relay_read || !r.relay_write) {
    const box = secret(16);
    const read = secret(32);
    const write = secret(16);
    const res = await call(io, relay, "PUT", `/api/box/${box}`, read, JSON.stringify({ writeHash: createHash("sha256").update(write).digest("hex"), expires: expiryOf(row) }));
    if (res.status !== 201 && res.status !== 200) throw new RelayError(`The relay ${relay} did not create the mailbox (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
    db.prepare("UPDATE guest_stays SET relay_box = ?, relay_read = ?, relay_write = ? WHERE id = ?").run(box, read, write, row.id);
    r = relayRow(db, row.id) as RelayRow;
  }
  return linkFor(relay, r.relay_box as string, { k: record.publicKey, w: r.relay_write as string, c: payload.country, n: payload.title.slice(0, 80), i: row.check_in, o: row.check_out });
}

export interface PullReport {
  guests: number;
  stays: number;
  closed: number;
  errors: string[];
}

/**
 * Download what the guests sent through the link, store it sealed, delete it
 * from the relay. Boxes of stays erased, cancelled or past are deleted. No
 * passphrase: the guests stay sealed.
 */
export async function pullRelay(db: Db, io: Io, config: HostConfig): Promise<PullReport> {
  const report: PullReport = { guests: 0, stays: 0, closed: 0, errors: [] };
  if (!hasTable(db, "guest_stays") || !guestsEnabled(db)) return report;
  const relay = relayOf(config);
  const today = localDateTime(io.now()).slice(0, 10);
  const rows = db.prepare("SELECT * FROM guest_stays WHERE relay_box IS NOT NULL").all() as RelayRow[];
  for (const r of rows) {
    const box = r.relay_box as string;
    const read = r.relay_read as string;
    try {
      const over = !!r.erased_at || !!r.cancelled_at || today > addDays(r.check_out, BOX_DAYS_AFTER_CHECKOUT);
      if (!over && BOX_ID.test(box)) {
        const res = await call(io, relay, "GET", `/api/box/${box}/messages`, read);
        if (res.status === 404) {
          // Expired or never there: nothing to download any more.
          db.prepare("UPDATE guest_stays SET relay_box = NULL, relay_read = NULL, relay_write = NULL WHERE id = ?").run(r.id);
          report.closed++;
          continue;
        }
        if (res.status !== 200) throw new RelayError(`HTTP ${res.status}`);
        const { messages } = JSON.parse(res.text) as { messages: { id: string; body: string }[] };
        let got = 0;
        for (const m of messages) {
          // Only sealed text of a sensible size goes in; it is opened later, with the passphrase.
          if (typeof m.body === "string" && m.body.startsWith("fg1.") && m.body.length <= MAX_MESSAGE && peopleCount(db, r.id) < MAX_GUESTS) {
            addRelayPerson(db, r.id, m.body, relayPlace(box), io.now());
            got++;
          }
          const del = await call(io, relay, "DELETE", `/api/box/${box}/messages/${m.id}`, read);
          if (del.status !== 200) throw new RelayError(`the relay did not delete a message (HTTP ${del.status})`);
        }
        report.guests += got;
        if (got > 0) report.stays++;
        continue;
      }
      const del = await call(io, relay, "DELETE", `/api/box/${box}`, read);
      if (del.status !== 200 && del.status !== 404) throw new RelayError(`the relay did not delete the mailbox (HTTP ${del.status})`);
      db.prepare("UPDATE guest_stays SET relay_box = NULL, relay_read = NULL, relay_write = NULL WHERE id = ?").run(r.id);
      report.closed++;
    } catch (e) {
      report.errors.push(`${r.id}: ${(e as Error).message}`);
    }
  }
  return report;
}

/** SHA-256 of what the relay serves, against the hashes of this version's page. */
export async function checkPage(io: Io, config: HostConfig, expected: Record<string, string>): Promise<{ path: string; ok: boolean; got: string | null }[]> {
  const relay = relayOf(config);
  const out: { path: string; ok: boolean; got: string | null }[] = [];
  for (const [path, want] of Object.entries(expected)) {
    let got: string | null = null;
    try {
      // The page itself is served at /c/<box>, for any box: a box id of zeros asks for it.
      const served = path === "/checkin.html" ? `/c/${"0".repeat(22)}` : path;
      const res = await relayFetch(io)(`${relay}${served}`, { method: "GET", headers: {}, signal: AbortSignal.timeout(60_000) });
      if (res.status === 200) got = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex");
    } catch {
      got = null;
    }
    out.push({ path, ok: got === want, got });
  }
  return out;
}
