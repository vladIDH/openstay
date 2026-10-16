/**
 * One round of the payments for every stay that needs them: make the links,
 * ask Stripe where they stand, leave them in the relay box of the stay's
 * check-in link. Run by `fairnight pagamenti prepara` and by `fairnight serve`
 * every few minutes. Without the host's Stripe key it does nothing at all.
 */
import { localDateTime, type Lang } from "fairguest";
import type { HostConfig } from "../config.js";
import type { Db } from "../db.js";
import type { Io } from "../io.js";
import { publishPay, relayRow } from "../guests/relay.js";
import { guestsEnabled, hasTable, type StayRow } from "../guests/store.js";
import { ensurePayments, paymentsOn, payView, refreshPayments } from "./run.js";
import { loadStripeKey, StripeClient } from "./stripe.js";

export interface PaymentsRound {
  /** False: no Stripe key, so no call was made. */
  key: boolean;
  stays: number;
  published: number;
  errors: string[];
}

const langOf = (config: HostConfig): Lang => config.language ?? "en";

/** The stays with payments on that are not over yet (or only the ones asked for). */
export function payingStays(db: Db, config: HostConfig, today: string, ids?: string[]): StayRow[] {
  if (!hasTable(db, "guest_payments") || !guestsEnabled(db)) return [];
  const on = new Set(config.listings.filter((l) => paymentsOn(l.fairguest)).map((l) => l.name));
  const rows = db.prepare("SELECT * FROM guest_stays WHERE erased_at IS NULL AND cancelled_at IS NULL AND check_out >= ? ORDER BY check_in, id").all(today) as StayRow[];
  return rows.filter((r) => on.has(r.listing) && (!ids || ids.includes(r.id)));
}

export async function paymentsRound(db: Db, io: Io, dir: string, config: HostConfig, ids?: string[]): Promise<PaymentsRound> {
  const round: PaymentsRound = { key: false, stays: 0, published: 0, errors: [] };
  const key = loadStripeKey(dir, io.env ?? {});
  if (!key) return round;
  round.key = true;
  const client = new StripeClient(key, io);
  const now = io.now();
  const today = localDateTime(now).slice(0, 10);
  for (const row of payingStays(db, config, today, ids)) {
    const listing = config.listings.find((l) => l.name === row.listing);
    const settings = listing?.fairguest;
    if (!listing || !settings) continue;
    round.stays++;
    try {
      await ensurePayments(db, client, listing, settings, row, langOf(config), today, now);
      await refreshPayments(db, client, row.id, now);
      if (relayRow(db, row.id)?.relay_box && (await publishPay(db, io, config, row, payView(db, settings, row, today, key.live)))) round.published++;
    } catch (e) {
      round.errors.push(`${row.id}: ${(e as Error).message}`);
    }
  }
  return round;
}
