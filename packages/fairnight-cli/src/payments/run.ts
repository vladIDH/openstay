/**
 * The tourist tax and the deposit of a stay, in the host's own Stripe account.
 *
 * - The tax: what the stay owes (fairguest's stayTax) minus what was already
 *   paid. One Stripe payment link for the rest; if the amount changes (a guest
 *   added), the old link is turned off and a new one made.
 * - The deposit: a payment link with manual capture, so the guest's card is
 *   only held. It is offered from `depositDaysBefore` days before check-in,
 *   because a hold lasts about 7 days. The host keeps it (all or part) or
 *   releases it, from the page /pagamenti or the command line.
 * - Every call to Stripe needs the host's key: without it these functions are
 *   never reached (see loadStripeKey).
 */
import { randomBytes, type KeyObject } from "node:crypto";
import { addDays, classifyGuest, isTaxClass, localDateTime, open, PAY_WORDS, stayTax, type GuestSettings, type Lang, type PayItem, type PayView, type StayTax, type TaxClass } from "fairguest";
import type { HostConfig, HostListing } from "../config.js";
import type { Db } from "../db.js";
import { hasTable, place, type PersonData, type StayRow } from "../guests/store.js";
import type { StripeClient } from "./stripe.js";

export type PaymentStatus = "open" | "paid" | "held" | "captured" | "released" | "expired" | "replaced";

export interface PaymentRow {
  id: string;
  stay_id: string;
  kind: "tax" | "deposit";
  amount: number;
  currency: string;
  live: number;
  link_id: string | null;
  link_url: string | null;
  payment_intent: string | null;
  status: PaymentStatus;
  captured: number | null;
  hold_until: string | null;
  created_at: string;
  updated_at: string;
}

/** A hold on a card lasts about this long when Stripe does not say. */
export const HOLD_DAYS = 7;

export const paymentsOn = (s: GuestSettings | undefined): s is GuestSettings & { payments: NonNullable<GuestSettings["payments"]> } => s?.payments?.enabled === true;

/**
 * One class per guest of the stay; null = arrived through the link, not opened
 * yet. After the guests are erased, the counts kept on the stay.
 */
export function taxClasses(db: Db, stayId: string): (TaxClass | null)[] {
  if (!hasTable(db, "guest_payments")) return [];
  const people = (db.prepare("SELECT tax_class FROM guest_people WHERE stay_id = ? ORDER BY added_at, rowid").all(stayId) as { tax_class: TaxClass | null }[]).map((r) => r.tax_class);
  if (people.length > 0) return people;
  const kept = (db.prepare("SELECT tax_counts FROM guest_stays WHERE id = ?").get(stayId) as { tax_counts: string | null } | undefined)?.tax_counts;
  if (!kept) return [];
  const out: (TaxClass | null)[] = [];
  for (const [cls, n] of Object.entries(JSON.parse(kept) as Record<string, number>)) for (let i = 0; i < n && i < 1000; i++) out.push(isTaxClass(cls) ? cls : null);
  return out;
}

export function paymentRows(db: Db, stayId: string): PaymentRow[] {
  if (!hasTable(db, "guest_payments")) return [];
  return db.prepare("SELECT * FROM guest_payments WHERE stay_id = ? ORDER BY created_at, rowid").all(stayId) as PaymentRow[];
}

/** The tax of a stay with the guests registered so far; null when the listing has no tourist tax. */
export function taxOfStay(db: Db, settings: GuestSettings, row: StayRow): StayTax | null {
  return settings.touristTax ? stayTax(settings.touristTax, row.check_in, row.check_out, taxClasses(db, row.id)) : null;
}

const paidTax = (rows: PaymentRow[]) => rows.filter((r) => r.kind === "tax" && r.status === "paid").reduce((n, r) => n + r.amount, 0);
const taxedNights = (t: StayTax) => t.nights.filter((n) => n.taxed).length;

/** The first day the deposit can be left. */
export const depositFrom = (settings: GuestSettings, row: StayRow) => addDays(row.check_in, -(settings.payments?.depositDaysBefore ?? 0));

function setStatus(db: Db, id: string, status: PaymentStatus, now: Date, extra: { payment_intent?: string; captured?: number; hold_until?: string } = {}): void {
  db.prepare("UPDATE guest_payments SET status = ?, updated_at = ?, payment_intent = COALESCE(?, payment_intent), captured = COALESCE(?, captured), hold_until = COALESCE(?, hold_until) WHERE id = ?").run(
    status,
    localDateTime(now),
    extra.payment_intent ?? null,
    extra.captured ?? null,
    extra.hold_until ?? null,
    id,
  );
}

async function newLink(db: Db, client: StripeClient, row: StayRow, kind: "tax" | "deposit", amount: number, currency: string, name: string, now: Date): Promise<void> {
  const id = `gp${randomBytes(6).toString("hex")}`;
  const price = await client.createPrice({ currency, unitAmount: amount, name });
  // Stripe sees the random id of the stay, never a name.
  const link = await client.createPaymentLink({ price, manual: kind === "deposit", metadata: { fairguest_stay: row.id, fairguest_kind: kind, fairguest_payment: id } });
  db.prepare("INSERT INTO guest_payments (id, stay_id, kind, amount, currency, live, link_id, link_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)").run(
    id,
    row.id,
    kind,
    amount,
    currency,
    client.live ? 1 : 0,
    link.id,
    link.url,
    localDateTime(now),
    localDateTime(now),
  );
}

/**
 * Make sure the links the guest needs exist, with the right amounts. Rows of
 * the other Stripe mode (test or live) are left alone: this key cannot see them.
 */
export async function ensurePayments(db: Db, client: StripeClient, listing: HostListing, settings: GuestSettings, row: StayRow, lang: Lang, today: string, now: Date): Promise<void> {
  if (!paymentsOn(settings) || row.cancelled_at || row.erased_at) return;
  const p = settings.payments;
  const mode = client.live ? 1 : 0;
  const rows = paymentRows(db, row.id).filter((r) => r.live === mode);
  const title = listing.pricing.name ?? listing.name;
  const when = `${row.check_in} → ${row.check_out}`;
  const words = PAY_WORDS[lang];

  const tax = p.collectTax ? taxOfStay(db, settings, row) : null;
  if (tax && tax.guests.unknown === 0 && today <= row.check_out) {
    const rest = tax.totalCents - paidTax(rows);
    const openTax = rows.filter((r) => r.kind === "tax" && r.status === "open");
    const keep = rest > 0 ? openTax.find((r) => r.amount === rest) : undefined;
    for (const r of openTax) {
      if (r === keep) continue;
      if (r.link_id) await client.deactivateLink(r.link_id);
      setStatus(db, r.id, "replaced", now);
    }
    if (rest > 0 && !keep) await newLink(db, client, row, "tax", rest, tax.currency, `${words.tax(settings.touristTax?.name)} · ${title} · ${when}`, now);
  }

  const depositCents = Math.round(p.deposit * 100);
  if (depositCents > 0) {
    const deposits = rows.filter((r) => r.kind === "deposit");
    const openDeposit = deposits.find((r) => r.status === "open");
    const inWindow = today >= depositFrom(settings, row) && today < row.check_out;
    if (openDeposit && !inWindow) {
      if (openDeposit.link_id) await client.deactivateLink(openDeposit.link_id);
      setStatus(db, openDeposit.id, "replaced", now);
    } else if (inWindow && !deposits.some((r) => ["open", "held", "captured", "released"].includes(r.status))) {
      await newLink(db, client, row, "deposit", depositCents, p.currency, `${words.deposit} · ${title} · ${when}`, now);
    }
  }
}

/** Ask Stripe where each payment of the stay stands, and write it down. */
export async function refreshPayments(db: Db, client: StripeClient, stayId: string, now: Date): Promise<void> {
  const mode = client.live ? 1 : 0;
  for (const r of paymentRows(db, stayId).filter((x) => x.live === mode && (x.status === "open" || x.status === "held"))) {
    let intent = r.payment_intent;
    if (!intent && r.link_id) intent = (await client.completedSessions(r.link_id)).find((s) => s.paymentIntent)?.paymentIntent ?? null;
    if (!intent) continue;
    const pi = await client.paymentIntent(intent);
    if (pi.status === "succeeded") setStatus(db, r.id, r.kind === "tax" ? "paid" : "captured", now, { payment_intent: pi.id, captured: pi.amountReceived });
    else if (pi.status === "requires_capture" && r.kind === "deposit") {
      const until = pi.captureBefore ? new Date(pi.captureBefore * 1000) : new Date(now.getTime() + HOLD_DAYS * 86_400_000);
      setStatus(db, r.id, "held", now, { payment_intent: pi.id, hold_until: localDateTime(until) });
    } else if (pi.status === "canceled") setStatus(db, r.id, r.status === "held" ? "expired" : "replaced", now, { payment_intent: pi.id });
    else if (r.payment_intent !== pi.id) db.prepare("UPDATE guest_payments SET payment_intent = ?, updated_at = ? WHERE id = ?").run(pi.id, localDateTime(now), r.id);
    // A finished link is not needed any more.
    if (r.status === "open" && r.link_id && (pi.status === "succeeded" || pi.status === "requires_capture")) await client.deactivateLink(r.link_id).catch(() => undefined);
  }
}

/** What the guest sees: the card of the check-in. `live` = the mode of the host's key. */
export function payView(db: Db, settings: GuestSettings, row: StayRow, today: string, live: boolean): PayView {
  if (!paymentsOn(settings)) return { items: [] };
  const p = settings.payments;
  const rows = paymentRows(db, row.id).filter((r) => r.live === (live ? 1 : 0));
  const items: PayItem[] = [];
  const tax = p.collectTax ? taxOfStay(db, settings, row) : null;
  if (tax) {
    const paid = paidTax(rows);
    const open = rows.find((r) => r.kind === "tax" && r.status === "open");
    const people = tax.guests.pays + tax.guests.reduced;
    const nights = taxedNights(tax);
    if (tax.guests.unknown > 0) items.push({ kind: "tax", amountCents: tax.totalCents, currency: tax.currency, state: "pending" });
    else if (tax.totalCents > 0 && paid >= tax.totalCents) items.push({ kind: "tax", amountCents: tax.totalCents, currency: tax.currency, state: "done", people, nights });
    else if (tax.totalCents > 0 && open?.link_url) items.push({ kind: "tax", amountCents: open.amount, currency: tax.currency, state: "open", url: open.link_url, people, nights });
    else if (tax.totalCents > 0) items.push({ kind: "tax", amountCents: tax.totalCents - paid, currency: tax.currency, state: "pending", people, nights });
  }
  const depositCents = Math.round(p.deposit * 100);
  if (depositCents > 0 && today < row.check_out) {
    const deposits = rows.filter((r) => r.kind === "deposit");
    const done = deposits.find((r) => ["held", "captured", "released"].includes(r.status));
    const open = deposits.find((r) => r.status === "open");
    const from = depositFrom(settings, row);
    if (done) items.push({ kind: "deposit", amountCents: done.amount, currency: done.currency, state: "done" });
    else if (open?.link_url) items.push({ kind: "deposit", amountCents: open.amount, currency: open.currency, state: "open", url: open.link_url });
    else if (today < from) items.push({ kind: "deposit", amountCents: depositCents, currency: p.currency, state: "later", from });
    else items.push({ kind: "deposit", amountCents: depositCents, currency: p.currency, state: "pending" });
  }
  const view: PayView = { items };
  if (settings.touristTax) view.town = settings.touristTax.name;
  return view;
}

export class DepositError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositError";
  }
}

/** The deposit held for the stay, after asking Stripe where it stands. */
async function heldDeposit(db: Db, client: StripeClient, stayId: string, now: Date): Promise<PaymentRow> {
  await refreshPayments(db, client, stayId, now);
  const mode = client.live ? 1 : 0;
  const held = paymentRows(db, stayId).find((r) => r.kind === "deposit" && r.status === "held" && r.live === mode);
  if (!held?.payment_intent) throw new DepositError(`Stay ${stayId} has no deposit held on a card${client.live ? "" : " (Stripe test mode)"}.`);
  return held;
}

/** Let the hold go: nothing is charged to the guest. */
export async function releaseDeposit(db: Db, client: StripeClient, stayId: string, now: Date): Promise<PaymentRow> {
  const held = await heldDeposit(db, client, stayId, now);
  await client.cancel(held.payment_intent as string);
  setStatus(db, held.id, "released", now);
  return paymentRows(db, stayId).find((r) => r.id === held.id) as PaymentRow;
}

/** Keep the deposit, all of it or `amount` cents of it; the rest goes back to the guest's card. */
export async function keepDeposit(db: Db, client: StripeClient, stayId: string, amount: number | undefined, now: Date): Promise<PaymentRow> {
  const held = await heldDeposit(db, client, stayId, now);
  if (amount !== undefined && (!Number.isInteger(amount) || amount < 1 || amount > held.amount)) throw new DepositError(`The amount to keep must be between 0.01 and ${(held.amount / 100).toFixed(2)}.`);
  const pi = await client.capture(held.payment_intent as string, amount);
  setStatus(db, held.id, "captured", now, { captured: pi.amountReceived || amount || held.amount });
  return paymentRows(db, stayId).find((r) => r.id === held.id) as PaymentRow;
}

/**
 * Guests who came through the link are sealed: their tax class is decided
 * here, with the private key (the passphrase was asked). Returns how many.
 */
export function classifySealedGuests(db: Db, config: HostConfig, key: KeyObject): number {
  if (!hasTable(db, "guest_payments")) return 0;
  const rows = db
    .prepare("SELECT p.id, p.data, p.place, s.listing, s.check_in FROM guest_people p JOIN guest_stays s ON s.id = p.stay_id WHERE p.tax_class IS NULL AND s.erased_at IS NULL")
    .all() as { id: string; data: string; place: string | null; listing: string; check_in: string }[];
  let n = 0;
  for (const r of rows) {
    const rule = config.listings.find((l) => l.name === r.listing)?.fairguest?.touristTax;
    if (!rule) continue;
    const data = open<PersonData>(key, r.data, r.place ?? place.person(r.id));
    const cls = classifyGuest(rule, { birthDate: (data as { guest?: { birthDate?: string } }).guest?.birthDate, resident: data.taxResident === true }, r.check_in);
    db.prepare("UPDATE guest_people SET tax_class = ? WHERE id = ?").run(cls, r.id);
    n++;
  }
  return n;
}
