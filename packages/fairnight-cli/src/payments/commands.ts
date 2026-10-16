/**
 * `fairnight tassa …` (the tourist tax) and `fairnight pagamenti …` (the
 * payments in the host's own Stripe account).
 *
 * - The tax needs no passphrase: it reads only the guests' tax classes. Guests
 *   who came through the link are classified once with the passphrase
 *   (`tassa classifica`, or by `pagamenti prepara` when needed).
 * - Payments: nothing is sent to Stripe without the host's key. Keeping or
 *   releasing a deposit shows what it would do, and does it with --applica.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  bandOf,
  formatCents,
  isReduced,
  isTaxClass,
  localDateTime,
  periodRange,
  summaryCsv,
  summaryPdf,
  TAX_PLACES,
  taxRuleFor,
  taxSummary,
  verifyTexts,
  type GuestSettings,
  type SummaryStay,
  type TaxAgeBand,
  type TaxClass,
  type TaxRule,
} from "fairguest";
import { confirmTaxPlace } from "./confirm.js";
import { loadHostConfig, SetupError, type HostConfig, type HostListing } from "../config.js";
import { openDb, type Db } from "../db.js";
import { UsageError } from "../errors.js";
import { DATA_DIR, dbPath, type Io } from "../io.js";
import { unlockedKey } from "../guests/commands.js";
import { getStay, guestsEnabled, hasTable, people, type StayRow } from "../guests/store.js";
import { classifySealedGuests, keepDeposit, paymentRows, paymentsOn, refreshPayments, releaseDeposit, taxClasses, taxOfStay, type PaymentRow } from "./run.js";
import { isStripeSecretKey, loadStripeKey, saveStripeKey, StripeClient, StripeError } from "./stripe.js";
import { paymentsRound } from "./sync.js";

export interface TaxOptions {
  listing?: string;
  mese?: string;
  trimestre?: string;
  out?: string;
  persona?: string;
  motivo?: string;
  importo?: string;
  applica?: boolean;
  verifica?: boolean;
  json?: boolean;
}

export const TAX_USAGE = `  fairnight tassa tariffe                          starting rates of the main towns (official source and date) and the rule of each listing
  fairnight tassa soggiorno <stay>                 the tourist tax of a stay: guests who pay, exempt, nights, amount
  fairnight tassa riepilogo --mese YYYY-MM         the summary for the town's declaration, CSV and PDF [--trimestre YYYY-Q1] [--listing <name>] [--out folder]
  fairnight tassa esenta <stay> --persona N --motivo eta|residente|altro|paga   change the tax class of one guest
  fairnight tassa classifica                       classify the guests who came through the link (asks the passphrase)
  fairnight tassa conferma <place>                 you checked the flagged points of the starting values with the town`;

export const PAYMENTS_USAGE = `  fairnight pagamenti                              the tax and the deposit of each stay, as Stripe has them
  fairnight pagamenti collega                      save YOUR Stripe secret key in this folder (asked, never shown) [--verifica]
  fairnight pagamenti prepara [<stay>…]            make the payment links and leave them in the check-in links
  fairnight pagamenti rilascia <stay>              release the deposit held on the guest's card [--applica]
  fairnight pagamenti trattieni <stay>             keep the deposit, all of it or --importo 50 [--applica]`;

const MOTIVI: Record<string, TaxClass> = { eta: "exempt-age", età: "exempt-age", residente: "exempt-resident", altro: "exempt-other", paga: "pays" };
const CLASS_WORDS: Record<"pays" | "exempt-age" | "exempt-resident" | "exempt-other" | "unknown", string> = { pays: "pays", "exempt-age": "exempt (age)", "exempt-resident": "exempt (resident)", "exempt-other": "exempt (other)", unknown: "not opened yet" };
const classWord = (c: TaxClass | null, rule: TaxRule): string => {
  if (c === null) return CLASS_WORDS.unknown;
  if (!isReduced(c)) return CLASS_WORDS[c as keyof typeof CLASS_WORDS];
  const band = bandOf(rule, c);
  return band ? `reduced (${bandWords(band, rule.currency)})` : "pays (its reduced band is no longer in the config)";
};
const bandWords = (b: TaxAgeBand, currency: string) =>
  `${b.toAge === undefined ? `${b.fromAge} and over` : `${b.fromAge}-${b.toAge}`}: ${b.rate !== undefined ? money(Math.round(b.rate * 100), currency) : `${b.percent}%`}`;

/** The flagged points of a rule, for the terminal. */
function printVerify(rule: TaxRule, io: Io, indent = "  "): void {
  for (const v of verifyTexts(rule, "en")) {
    io.out(`${indent}! ${v.title}`);
    io.out(`${indent}  ${v.quote}`);
    io.out(`${indent}  ${v.explain}`);
    if (v.note) io.out(`${indent}  ${v.note}`);
    io.out(`${indent}  ${v.url}`);
    io.out(`${indent}  Checked? fairnight tassa conferma ${rule.place}`);
  }
}

const money = (cents: number, currency: string) => `${formatCents(cents, ".")} ${currency}`;

function stayOrFail(db: Db, id: string | undefined): StayRow {
  if (id === undefined) throw new UsageError('Which stay? Give its id (see "fairnight ospiti elenco").');
  const row = getStay(db, id);
  if (!row) throw new SetupError(`No stay "${id}". "fairnight ospiti elenco" lists them.`);
  return row;
}

function settingsOf(config: HostConfig, row: StayRow): { listing: HostListing; settings: GuestSettings } {
  const listing = config.listings.find((l) => l.name === row.listing);
  if (!listing?.fairguest) throw new SetupError(`Listing "${row.listing}" has no "fairguest" block in fairnight.config.json.`);
  return { listing, settings: listing.fairguest };
}

function withDb<T>(dir: string, fn: (db: Db, config: HostConfig) => Promise<T>): Promise<T> {
  const config = loadHostConfig(dir);
  const db = openDb(dbPath(dir));
  return fn(db, config).finally(() => db.close());
}

export async function runTax(dir: string, values: TaxOptions, rest: string[], io: Io): Promise<number> {
  const [sub = "tariffe", ...args] = rest;
  if (sub === "tariffe" || sub === "rates") return rates(dir, io);
  if (sub === "conferma" || sub === "confirm") {
    const place = args[0];
    if (!place) throw new UsageError("Which place? fairnight tassa conferma <place> (like napoli)");
    const changed = confirmTaxPlace(dir, place);
    io.out(changed.length === 0 ? `Nothing to confirm for "${place}": no listing uses it, or it is confirmed already.` : `Confirmed for ${changed.join(", ")}: "confirmed": true written in the touristTax block (copy of the old config in fairnight.config.json.bak).`);
    return 0;
  }
  return withDb(dir, async (db, config) => {
    if (!guestsEnabled(db)) throw new SetupError('Guest registration is not turned on in this folder: run "fairnight ospiti attiva" first.');
    switch (sub) {
      case "soggiorno":
      case "stay":
        return stayCommand(db, config, args, io);
      case "riepilogo":
      case "summary":
        return summary(dir, db, config, values, io);
      case "esenta":
      case "exempt":
        return exempt(db, config, args, values, io);
      case "classifica":
      case "classify": {
        const n = classifySealedGuests(db, config, await unlockedKey(db, io));
        io.out(n === 0 ? "No guest to classify." : `Classified ${n} guest${n === 1 ? "" : "s"} who came through the link.`);
        return 0;
      }
      default:
        throw new UsageError(`Unknown command "tassa ${sub}".`);
    }
  });
}

function ruleLine(r: Omit<TaxRule, "rate" | "currency"> & { rate: number | null; currency?: string }): string {
  const parts = [r.rate === null ? "rate: not found, write your own" : `${money(Math.round(r.rate * 100), r.currency ?? "EUR")} per person per night`];
  if (r.seasons?.length) parts.push(`seasons ${r.seasons.map((s) => `${s.from}..${s.to} ${s.rate}`).join(", ")}`);
  if (r.maxNights) parts.push(`first ${r.maxNights} nights`);
  if (r.exemptUnderAge !== undefined) parts.push(`under ${r.exemptUnderAge} exempt`);
  if (r.residentsExempt) parts.push("residents exempt");
  if (r.ageBands?.length) parts.push(`reduced ${r.ageBands.map((b) => bandWords(b, r.currency ?? "EUR")).join(", ")}`);
  if (r.period) parts.push(`declared ${r.period}`);
  return parts.join(" · ");
}

function rates(dir: string, io: Io): number {
  io.out("Starting values (private short-term rentals). A start, not advice: check them with your town and write your own figures in the listing's touristTax block.");
  for (const p of Object.values(TAX_PLACES)) {
    io.out("");
    io.out(`${p.place.padEnd(10)} ${p.name}: ${ruleLine(p)}`);
    if (p.notes) io.out(`           ${p.notes}`);
    if (p.source) io.out(`           source: ${p.source.title}, read on ${p.source.checkedOn}\n           ${p.source.url}`);
    if (p.verify?.length && p.rate !== null) printVerify(taxRuleFor({ place: p.place }, "t").value as TaxRule, io, "           ");
  }
  let config: HostConfig | null = null;
  try {
    config = loadHostConfig(dir);
  } catch {
    config = null;
  }
  const mine = config?.listings.filter((l) => l.fairguest?.touristTax) ?? [];
  if (mine.length > 0) {
    io.out("");
    io.out("Your listings:");
    for (const l of mine) {
      io.out(`  ${l.name}: ${(l.fairguest?.touristTax as TaxRule).name}, ${ruleLine(l.fairguest?.touristTax as TaxRule)}${paymentsOn(l.fairguest) ? " · collected in the check-in" : ""}`);
      printVerify(l.fairguest?.touristTax as TaxRule, io, "    ");
    }
  }
  return 0;
}

function stayCommand(db: Db, config: HostConfig, args: string[], io: Io): number {
  const row = stayOrFail(db, args[0]);
  const { settings } = settingsOf(config, row);
  const tax = taxOfStay(db, settings, row);
  if (!tax || !settings.touristTax) throw new SetupError(`Listing "${row.listing}" has no touristTax block.`);
  const classes = taxClasses(db, row.id);
  io.out(`Stay ${row.id} (${row.listing}), ${row.check_in} → ${row.check_out}, ${settings.touristTax.name}`);
  classes.forEach((c, i) => io.out(`  guest ${i + 1}: ${classWord(c, settings.touristTax as TaxRule)}`));
  if (classes.length === 0) io.out("  no guest registered yet");
  const taxed = tax.nights.filter((n) => n.taxed).length;
  io.out(`  nights: ${tax.nights.length}, taxed: ${taxed}${taxed < tax.nights.length ? ` (the town taxes the first ${settings.touristTax.maxNights})` : ""}`);
  io.out(`  person-nights that pay: ${tax.personNights}${tax.reducedPersonNights > 0 ? ` (${tax.reducedPersonNights} at a reduced rate)` : ""}; exempt: age ${tax.exemptPersonNights.age}, residents ${tax.exemptPersonNights.resident}, other ${tax.exemptPersonNights.other}`);
  io.out(`  tax: ${money(tax.totalCents, tax.currency)}`);
  if (tax.guests.unknown > 0) io.out(`  ${tax.guests.unknown} guest(s) came through the link and are not classified yet: "fairnight tassa classifica".`);
  const paid = paymentRows(db, row.id).filter((p) => p.kind === "tax" && p.status === "paid").reduce((n, p) => n + p.amount, 0);
  if (paid > 0) io.out(`  paid online: ${money(paid, tax.currency)}`);
  return 0;
}

function exempt(db: Db, config: HostConfig, args: string[], values: TaxOptions, io: Io): number {
  const row = stayOrFail(db, args[0]);
  settingsOf(config, row);
  const list = people(db, row.id);
  const n = Number(values.persona);
  if (!Number.isInteger(n) || n < 1 || n > list.length) throw new UsageError(`--persona must be a guest number from 1 to ${list.length}.`);
  const cls = MOTIVI[values.motivo ?? ""];
  if (!cls || !isTaxClass(cls)) throw new UsageError("--motivo must be eta, residente, altro or paga.");
  db.prepare("UPDATE guest_people SET tax_class = ? WHERE id = ?").run(cls, (list[n - 1] as { id: string }).id);
  io.out(`Stay ${row.id}, guest ${n}: ${CLASS_WORDS[cls as keyof typeof CLASS_WORDS]}.`);
  return 0;
}

/** Every stay of the listings with that rule, as the summary wants them. */
function summaryStays(db: Db, config: HostConfig, listings: HostListing[], from: string, to: string): SummaryStay[] {
  const names = listings.map((l) => l.name);
  if (names.length === 0) return [];
  const rows = db
    .prepare(`SELECT * FROM guest_stays WHERE cancelled_at IS NULL AND check_in <= ? AND check_out > ? AND listing IN (${names.map(() => "?").join(",")})`)
    .all(to, from, ...names) as StayRow[];
  return rows.map((r) => ({
    id: r.id,
    listing: r.listing,
    checkIn: r.check_in,
    checkOut: r.check_out,
    classes: taxClasses(db, r.id),
    paidCents: paymentRows(db, r.id)
      .filter((p) => p.kind === "tax" && p.status === "paid")
      .reduce((n, p) => n + p.amount, 0),
  }));
}

function summary(dir: string, db: Db, config: HostConfig, values: TaxOptions, io: Io): number {
  const raw = values.trimestre ?? values.mese;
  if (!raw || (values.trimestre && values.mese)) throw new UsageError("Give one period: --mese YYYY-MM or --trimestre YYYY-Q1.");
  const period = periodRange(raw);
  if (!period || (values.trimestre && !/Q/.test(period.label)) || (values.mese && /Q/.test(period.label))) throw new UsageError(`Not a period: "${raw}" (use 2099-06 or 2099-Q2).`);
  const listings = config.listings.filter((l) => l.fairguest?.touristTax && (!values.listing || l.name === values.listing));
  if (listings.length === 0) throw new SetupError(values.listing ? `Listing "${values.listing}" has no touristTax block.` : "No listing has a touristTax block in fairnight.config.json.");
  // One summary per town: listings with the same rule are declared together.
  const byPlace = new Map<string, HostListing[]>();
  for (const l of listings) byPlace.set((l.fairguest?.touristTax as TaxRule).place, [...(byPlace.get((l.fairguest?.touristTax as TaxRule).place) ?? []), l]);
  const outDir = values.out ? path.resolve(values.out) : path.join(dir, DATA_DIR, "tassa");
  mkdirSync(outDir, { recursive: true });
  const lang = config.language ?? "en";
  for (const [place, group] of byPlace) {
    const rule = group[0]?.fairguest?.touristTax as TaxRule;
    const s = taxSummary(rule, period, summaryStays(db, config, group, period.from, period.to));
    const base = path.join(outDir, `${place}-${period.label}`);
    writeFileSync(`${base}.csv`, summaryCsv(s, lang), "utf8");
    writeFileSync(`${base}.pdf`, summaryPdf(s, lang, localDateTime(io.now()).slice(0, 10)));
    io.out(`${rule.name}, ${period.label}: ${s.rows.length} stay${s.rows.length === 1 ? "" : "s"}, ${s.totals.personNights} taxed person-nights, tax ${money(s.totals.dueCents, rule.currency)}, paid online ${money(s.totals.paidCents, rule.currency)}`);
    io.out(`  ${base}.csv`);
    io.out(`  ${base}.pdf`);
    if (s.incomplete > 0) io.out(`  ${s.incomplete} stay(s) with guests from the link not classified yet: "fairnight tassa classifica", then run this again.`);
    printVerify(rule, io);
  }
  return 0;
}

export async function runPayments(dir: string, values: TaxOptions, rest: string[], io: Io): Promise<number> {
  const [sub = "stato", ...args] = rest;
  if (sub === "collega" || sub === "connect") return connect(dir, values, io);
  return withDb(dir, async (db, config) => {
    if (!hasTable(db, "guest_payments") || !guestsEnabled(db)) throw new SetupError('Guest registration is not turned on in this folder: run "fairnight ospiti attiva" first.');
    const key = loadStripeKey(dir, io.env ?? {});
    switch (sub) {
      case "stato":
      case "status":
        return await status(db, config, key ? new StripeClient(key, io) : null, io);
      case "prepara":
      case "prepare":
        return await prepare(dir, db, config, args, io);
      case "rilascia":
      case "release":
      case "trattieni":
      case "keep": {
        if (!key) throw new SetupError('No Stripe key in this folder: "fairnight pagamenti collega" first.');
        const row = stayOrFail(db, args[0]);
        const keep = sub === "trattieni" || sub === "keep";
        const amount = values.importo === undefined ? undefined : Math.round(Number(values.importo.replace(",", ".")) * 100);
        if (amount !== undefined && !(amount > 0)) throw new UsageError(`--importo must be an amount like 50 or 49.90, got "${values.importo}"`);
        const client = new StripeClient(key, io);
        await refreshPayments(db, client, row.id, io.now());
        const held = paymentRows(db, row.id).find((p) => p.kind === "deposit" && p.status === "held");
        if (!held) throw new SetupError(`Stay ${row.id} has no deposit held on a card${key.live ? "" : " (Stripe test mode)"}.`);
        const what = keep ? `keep ${money(amount ?? held.amount, held.currency)} of the ${money(held.amount, held.currency)} deposit${amount !== undefined && amount < held.amount ? " (the rest goes back to the card)" : ""}` : `release the ${money(held.amount, held.currency)} deposit (nothing is charged)`;
        if (!values.applica) {
          io.out(`Stay ${row.id}: would ${what}. Add --applica to do it.`);
          return 0;
        }
        const done = keep ? await keepDeposit(db, client, row.id, amount, io.now()) : await releaseDeposit(db, client, row.id, io.now());
        io.out(`Stay ${row.id}: ${keep ? `kept ${money(done.captured ?? 0, done.currency)}` : "deposit released"}.${key.live ? "" : " (Stripe test mode: no real money.)"}`);
        return 0;
      }
      default:
        throw new UsageError(`Unknown command "pagamenti ${sub}".`);
    }
  });
}

async function connect(dir: string, values: TaxOptions, io: Io): Promise<number> {
  if (!io.prompt) throw new SetupError('"fairnight pagamenti collega" needs a terminal to ask for the key.');
  io.out("Your own Stripe secret key (Stripe Dashboard → Developers → API keys). The money goes to your Stripe account only.");
  io.out("Start with a test key (sk_test_…): no real money moves until you save a live one.");
  const key = (await io.prompt("Stripe secret key: ", { hidden: true })).trim();
  if (!isStripeSecretKey(key)) throw new SetupError("That is not a Stripe secret key (sk_test_…, sk_live_…, rk_test_… or rk_live_…). A publishable key (pk_…) cannot create payments.");
  if (values.verifica) {
    await new StripeClient({ key, live: /_live_/.test(key), source: "file" }, io).check();
    io.out("Stripe accepted the key.");
  }
  const how = saveStripeKey(dir, key);
  io.out(`Saved in ${"stripe-credentials.json"} (${how}), ${/_live_/.test(key) ? "LIVE mode: real payments" : "test mode"}.`);
  io.out('Payments stay off until a listing has "payments": { "enabled": true } in its fairguest block.');
  return 0;
}

function statusWord(p: PaymentRow): string {
  const m = money(p.amount, p.currency);
  switch (p.status) {
    case "open":
      return `${m} link waiting for the guest`;
    case "paid":
      return `${m} paid`;
    case "held":
      return `${m} held on the card${p.hold_until ? ` until ${p.hold_until.replace("T", " ")}` : ""}`;
    case "captured":
      return `kept ${money(p.captured ?? p.amount, p.currency)}`;
    case "released":
      return `${m} released`;
    case "expired":
      return `${m} hold expired (Stripe let it go)`;
    case "replaced":
      return `${m} link replaced`;
  }
}

async function status(db: Db, config: HostConfig, client: StripeClient | null, io: Io): Promise<number> {
  const today = localDateTime(io.now()).slice(0, 10);
  const on = config.listings.filter((l) => paymentsOn(l.fairguest) || l.fairguest?.touristTax).map((l) => l.name);
  if (on.length === 0) {
    io.out('No listing has a touristTax or payments block: payments are off.');
    return 0;
  }
  if (!client) io.out('No Stripe key in this folder: nothing is asked to Stripe ("fairnight pagamenti collega" to add yours).');
  else io.out(client.live ? "Stripe: LIVE mode." : "Stripe: test mode (no real money).");
  const rows = (db.prepare(`SELECT * FROM guest_stays WHERE cancelled_at IS NULL AND check_out >= ? AND listing IN (${on.map(() => "?").join(",")}) ORDER BY check_in`).all(addBack(today), ...on) as StayRow[]);
  let errors = 0;
  for (const row of rows) {
    const { settings } = settingsOf(config, row);
    if (client) {
      try {
        await refreshPayments(db, client, row.id, io.now());
      } catch (e) {
        errors++;
        io.err(`${row.id}: ${(e as StripeError).message}`);
      }
    }
    const tax = taxOfStay(db, settings, row);
    const pays = paymentRows(db, row.id).filter((p) => p.status !== "replaced");
    const parts = [tax ? `tax ${money(tax.totalCents, tax.currency)}${tax.guests.unknown > 0 ? ` (+${tax.guests.unknown} not classified)` : ""}` : null, ...pays.map((p) => `${p.kind}: ${statusWord(p)}${p.live ? "" : " [test]"}`)].filter(Boolean);
    io.out(`${row.id}  ${row.listing}  ${row.check_in} → ${row.check_out}  ${parts.join(" · ") || "nothing yet"}`);
  }
  if (rows.length === 0) io.out("No current stay.");
  return errors > 0 ? 1 : 0;
}

/** Stays that ended in the last 14 days stay on the list: their deposit may still be held. */
const addBack = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);

async function prepare(dir: string, db: Db, config: HostConfig, ids: string[], io: Io): Promise<number> {
  const unknown = db.prepare("SELECT COUNT(*) AS n FROM guest_people p JOIN guest_stays s ON s.id = p.stay_id WHERE p.tax_class IS NULL AND s.erased_at IS NULL").get() as { n: number };
  const taxed = config.listings.some((l) => l.fairguest?.touristTax);
  if (taxed && unknown.n > 0) {
    if (io.env?.FAIRGUEST_FRASE || io.prompt) {
      const n = classifySealedGuests(db, config, await unlockedKey(db, io));
      if (n > 0) io.out(`Classified ${n} guest${n === 1 ? "" : "s"} who came through the link.`);
    } else io.out(`${unknown.n} guest(s) from the link are not classified: their tax waits ("fairnight tassa classifica").`);
  }
  const round = await paymentsRound(db, io, dir, config, ids.length > 0 ? ids : undefined);
  if (!round.key) {
    io.out('No Stripe key in this folder: nothing was sent to Stripe ("fairnight pagamenti collega").');
    return 0;
  }
  io.out(`Payments ready for ${round.stays} stay${round.stays === 1 ? "" : "s"}; ${round.published} check-in link${round.published === 1 ? "" : "s"} updated.`);
  for (const e of round.errors) io.err(e);
  return round.errors.length > 0 ? 1 : 0;
}
