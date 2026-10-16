/**
 * The page /pagamenti of `fairnight serve`: the tourist tax and the deposit of
 * each current stay, the buttons to release or keep a deposit, and the
 * summary for the town's declaration (CSV or PDF).
 *
 * - Only from this computer: any other address and any request through a
 *   proxy or tunnel is refused, like /risposte.
 * - Plain HTML forms with a token signed by a secret made at each start.
 * - The «Carta» look of the check-in.
 * - Stripe is asked only with the host's key; without it the page says so.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { esc, localDateTime, money, page, PAY_WORDS, verifyTexts, periodRange, summaryCsv, summaryPdf, taxSummary, type Lang, type SummaryStay, type TaxRule } from "fairguest";
import { loadHostConfig, type HostConfig, type HostListing } from "../config.js";
import { openDb, type Db } from "../db.js";
import { dbPath, type Io } from "../io.js";
import { fromThisComputer } from "../hello/page.js";
import { guestsEnabled, hasTable, type StayRow } from "../guests/store.js";
import { confirmTaxPlace } from "./confirm.js";
import { keepDeposit, paymentRows, paymentsOn, refreshPayments, releaseDeposit, taxClasses, taxOfStay, type PaymentRow } from "./run.js";
import { loadStripeKey, StripeClient, type StripeKey } from "./stripe.js";

export interface PaymentsPageContext {
  dir: string;
  io: Io;
  secret: Buffer;
}

const W = {
  it: {
    title: "Pagamenti",
    back: "Calendario",
    noKey: "Nessuna chiave Stripe in questa cartella: la pagina non chiede niente a Stripe. Per aggiungere la tua: fairnight pagamenti collega",
    test: "Stripe in modalità di prova: nessun soldo vero.",
    live: "Stripe in modalità reale: i soldi arrivano sul tuo conto Stripe.",
    off: "Nessun annuncio ha la tassa di soggiorno o i pagamenti accesi.",
    none: "Nessun soggiorno in corso o in arrivo.",
    tax: "Tassa di soggiorno",
    noGuests: "nessun ospite registrato",
    notOpened: (n: number) => `${n} ospiti dal link non ancora classificati (fairnight tassa classifica)`,
    paid: "pagata",
    deposit: "Cauzione",
    states: { open: "link in attesa dell'ospite", paid: "pagata", held: "bloccata sulla carta", captured: "trattenuta", released: "rilasciata", expired: "preautorizzazione scaduta", replaced: "link sostituito" },
    until: "fino al",
    release: "Rilascia",
    keep: "Trattieni",
    amount: "Importo da trattenere (vuoto = tutta)",
    done: "Fatto.",
    summary: "Riepilogo per il comune",
    period: "Periodo (2099-06 oppure 2099-Q2)",
    town: "Comune",
    download: (f: string) => `Scarica ${f}`,
    badPeriod: "Periodo non valido.",
    badAmount: "Importo non valido.",
    error: "Stripe non ha accettato:",
    stale: "Il modulo è scaduto: ricarica la pagina.",
    checked: "Ho verificato",
    source: "Fonte",
  },
  es: {
    title: "Pagos",
    back: "Calendario",
    noKey: "No hay clave de Stripe en esta carpeta: la página no pide nada a Stripe. Para añadir la suya: fairnight pagamenti collega",
    test: "Stripe en modo de prueba: sin dinero real.",
    live: "Stripe en modo real: el dinero llega a su cuenta de Stripe.",
    off: "Ningún anuncio tiene el impuesto turístico o los pagos activados.",
    none: "Ninguna estancia en curso o próxima.",
    tax: "Impuesto turístico",
    noGuests: "ningún huésped registrado",
    notOpened: (n: number) => `${n} huéspedes del enlace aún sin clasificar (fairnight tassa classifica)`,
    paid: "pagado",
    deposit: "Fianza",
    states: { open: "enlace esperando al huésped", paid: "pagado", held: "bloqueada en la tarjeta", captured: "retenida", released: "liberada", expired: "preautorización caducada", replaced: "enlace sustituido" },
    until: "hasta el",
    release: "Liberar",
    keep: "Retener",
    amount: "Importe a retener (vacío = toda)",
    done: "Hecho.",
    summary: "Resumen para la declaración",
    period: "Periodo (2099-06 o 2099-Q2)",
    town: "Municipio",
    download: (f: string) => `Descargar ${f}`,
    badPeriod: "Periodo no válido.",
    badAmount: "Importe no válido.",
    error: "Stripe no lo aceptó:",
    stale: "El formulario ha caducado: recargue la página.",
    checked: "Lo he verificado",
    source: "Fuente",
  },
  en: {
    title: "Payments",
    back: "Calendar",
    noKey: "No Stripe key in this folder: the page asks Stripe nothing. To add yours: fairnight pagamenti collega",
    test: "Stripe in test mode: no real money.",
    live: "Stripe in live mode: the money goes to your Stripe account.",
    off: "No listing has the tourist tax or payments turned on.",
    none: "No current or coming stay.",
    tax: "Tourist tax",
    noGuests: "no guest registered yet",
    notOpened: (n: number) => `${n} guests from the link not classified yet (fairnight tassa classifica)`,
    paid: "paid",
    deposit: "Deposit",
    states: { open: "link waiting for the guest", paid: "paid", held: "held on the card", captured: "kept", released: "released", expired: "hold expired", replaced: "link replaced" },
    until: "until",
    release: "Release",
    keep: "Keep",
    amount: "Amount to keep (empty = all of it)",
    done: "Done.",
    summary: "Summary for the town",
    period: "Period (2099-06 or 2099-Q2)",
    town: "Town",
    download: (f: string) => `Download ${f}`,
    badPeriod: "Not a valid period.",
    badAmount: "Not a valid amount.",
    error: "Stripe did not accept it:",
    stale: "The form expired: reload the page.",
    checked: "I checked",
    source: "Source",
  },
};

const EXTRA = `.wide{max-width:760px}.row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:6px 0}.row span{color:var(--muted)}
.inline{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}.inline button{width:auto;margin-top:8px;padding:11px 18px}.inline label{margin-top:8px}
.back{color:var(--accent);font-weight:600;text-decoration:none}.verify{border-color:var(--warn-line);background:var(--warn-bg)}.verify h3{margin:0 0 6px;font-size:1rem;color:var(--warn)}
.verify blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--warn-line);font-style:italic}.verify p{margin:6px 0;font-size:.92rem}
:root{--warn:#7a4d00;--warn-bg:#fff7e6;--warn-line:#d9a441}@media (prefers-color-scheme:dark){:root{--warn:#f3c56b;--warn-bg:#2b2416;--warn-line:#8a6a2a}}
.ghost{background:transparent;color:var(--accent);border:1.5px solid var(--accent)}.banner.ok{background:var(--ok-bg);color:var(--ok)}.mode{color:var(--muted);font-size:.92rem}`;

function token(secret: Buffer, what: string): string {
  return createHmac("sha256", secret).update(`pagamenti:${what}`).digest("base64url");
}
function tokenOk(secret: Buffer, what: string, given: string | null): boolean {
  const want = Buffer.from(token(secret, what));
  const got = Buffer.from(given ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

function send(res: ServerResponse, status: number, type: string, body: string | Uint8Array, nonce = "", extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...(nonce ? { "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } : {}),
    ...extra,
  });
  res.end(body);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > 4096) return null;
  }
  return new URLSearchParams(body);
}

const langOf = (config: HostConfig, url: URL): Lang => {
  const q = url.searchParams.get("lang");
  return q === "it" || q === "es" || q === "en" ? q : (config.language ?? "en");
};

function currentStays(db: Db, config: HostConfig, today: string): StayRow[] {
  const names = config.listings.filter((l) => paymentsOn(l.fairguest) || l.fairguest?.touristTax).map((l) => l.name);
  if (names.length === 0 || !hasTable(db, "guest_payments")) return [];
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  return db.prepare(`SELECT * FROM guest_stays WHERE cancelled_at IS NULL AND check_out >= ? AND listing IN (${names.map(() => "?").join(",")}) ORDER BY check_in, id`).all(from, ...names) as StayRow[];
}

function stayCard(db: Db, ctx: PaymentsPageContext, listing: HostListing, row: StayRow, lang: Lang, key: StripeKey | null): string {
  const w = W[lang];
  const settings = listing.fairguest;
  if (!settings) return "";
  const tax = taxOfStay(db, settings, row);
  const rows = paymentRows(db, row.id).filter((p) => p.status !== "replaced" && (!key || p.live === (key.live ? 1 : 0)));
  const lines: string[] = [];
  if (tax) {
    const paid = rows.filter((p) => p.kind === "tax" && p.status === "paid").reduce((n, p) => n + p.amount, 0);
    lines.push(
      `<div class="row"><b>${esc(w.tax)}</b><strong>${esc(money(tax.totalCents, tax.currency, lang))}</strong></div>` +
        `<div class="row"><span>${esc(taxClasses(db, row.id).length === 0 ? w.noGuests : PAY_WORDS[lang].taxDetail(tax.guests.pays + tax.guests.reduced, tax.nights.filter((n) => n.taxed).length))}${tax.guests.unknown > 0 ? ` · ${esc(w.notOpened(tax.guests.unknown))}` : ""}</span>${paid > 0 ? `<span>${esc(w.paid)} ${esc(money(paid, tax.currency, lang))}</span>` : ""}</div>`,
    );
  }
  for (const p of rows.filter((x) => x.kind === "deposit")) {
    const state = `${w.states[p.status]}${p.status === "held" && p.hold_until ? ` ${w.until} ${p.hold_until.replace("T", " ")}` : ""}${p.status === "captured" && p.captured !== null ? ` ${money(p.captured, p.currency, lang)}` : ""}`;
    lines.push(`<div class="row"><b>${esc(w.deposit)}</b><strong>${esc(money(p.amount, p.currency, lang))}</strong></div><div class="row"><span>${esc(state)}${p.live ? "" : " · test"}</span></div>`);
    if (p.status === "held" && key) lines.push(depositForms(ctx, row, p, w));
  }
  if (lines.length === 0) return "";
  return `<div class="pay-item"><div class="row"><b>${esc(listing.pricing.name ?? listing.name)}</b><span>${esc(row.check_in)} → ${esc(row.check_out)} · ${esc(row.id)}</span></div>${lines.join("")}</div>`;
}

function depositForms(ctx: PaymentsPageContext, row: StayRow, p: PaymentRow, w: (typeof W)["it"]): string {
  const t = (what: string) => `<input type="hidden" name="t" value="${esc(token(ctx.secret, `${what}:${row.id}`))}"><input type="hidden" name="stay" value="${esc(row.id)}">`;
  return `<div class="inline"><form method="post" action="/pagamenti/rilascia">${t("release")}<button type="submit" class="ghost">${esc(w.release)}</button></form>
<form method="post" action="/pagamenti/trattieni" class="inline">${t("keep")}<label>${esc(w.amount)}<input name="amount" inputmode="decimal" size="8" placeholder="${(p.amount / 100).toFixed(2)}"></label><button type="submit">${esc(w.keep)}</button></form></div>`;
}

/** The points of the starting values the host still has to check with the town, one box per town. */
function verifyBoxes(ctx: PaymentsPageContext, config: HostConfig, lang: Lang): string {
  const w = W[lang];
  const seen = new Set<string>();
  const boxes: string[] = [];
  for (const l of config.listings) {
    const rule = l.fairguest?.touristTax;
    if (!rule?.verify?.length || seen.has(rule.place)) continue;
    seen.add(rule.place);
    for (const v of verifyTexts(rule, lang)) {
      boxes.push(
        `<div class="pay-item verify" role="note"><h3>${esc(v.title)}</h3><blockquote>${esc(v.quote)}</blockquote><p>${esc(v.explain)}</p>${v.note ? `<p>${esc(v.note)}</p>` : ""}` +
          `<p><a class="back" href="${esc(v.url)}" rel="noopener noreferrer" target="_blank">${esc(w.source)} ↗</a></p>` +
          `<form method="post" action="/pagamenti/conferma"><input type="hidden" name="t" value="${esc(token(ctx.secret, `confirm:${rule.place}`))}"><input type="hidden" name="place" value="${esc(rule.place)}"><button type="submit" class="ghost">${esc(w.checked)}</button></form></div>`,
      );
    }
  }
  return boxes.join("");
}

function summaryForm(config: HostConfig, lang: Lang): string {
  const w = W[lang];
  const places = new Map<string, string>();
  for (const l of config.listings) if (l.fairguest?.touristTax) places.set(l.fairguest.touristTax.place, l.fairguest.touristTax.name);
  if (places.size === 0) return "";
  const options = [...places].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("");
  return `<section class="pay"><h2>${esc(w.summary)}</h2><form method="get" action="/pagamenti/riepilogo" class="pay-item">
<label for="place">${esc(w.town)}</label><select id="place" name="place">${options}</select>
<label for="periodo">${esc(w.period)}</label><input id="periodo" name="periodo" required pattern="\\d{4}-(0[1-9]|1[0-2]|[Qq][1-4])">
<input type="hidden" name="lang" value="${lang}">
<div class="inline"><button type="submit" name="formato" value="pdf">${esc(w.download("PDF"))}</button><button type="submit" name="formato" value="csv" class="ghost">${esc(w.download("CSV"))}</button></div></form></section>`;
}

/** Handles /pagamenti…; returns false for any other path. */
export async function handlePayments(req: IncomingMessage, res: ServerResponse, url: URL, ctx: PaymentsPageContext, nonce: string): Promise<boolean> {
  if (url.pathname !== "/pagamenti" && !url.pathname.startsWith("/pagamenti/")) return false;
  if (!fromThisComputer(req)) {
    send(res, 403, "text/plain; charset=utf-8", "Only on the computer that runs Fairnight.");
    return true;
  }
  const config = loadHostConfig(ctx.dir);
  const lang = langOf(config, url);
  const w = W[lang];
  const db = openDb(dbPath(ctx.dir));
  try {
    const now = ctx.io.now();
    const today = localDateTime(now).slice(0, 10);
    let key: StripeKey | null = null;
    try {
      key = loadStripeKey(ctx.dir, ctx.io.env ?? {});
    } catch {
      key = null;
    }

    if (req.method === "GET" && url.pathname === "/pagamenti/riepilogo") {
      const place = url.searchParams.get("place") ?? "";
      const period = periodRange(url.searchParams.get("periodo") ?? "");
      const group = config.listings.filter((l) => l.fairguest?.touristTax?.place === place);
      if (!period || group.length === 0) {
        send(res, 400, "text/plain; charset=utf-8", w.badPeriod);
        return true;
      }
      const rule = group[0]?.fairguest?.touristTax as TaxRule;
      const names = group.map((l) => l.name);
      const stays = (db.prepare(`SELECT * FROM guest_stays WHERE cancelled_at IS NULL AND check_in <= ? AND check_out > ? AND listing IN (${names.map(() => "?").join(",")})`).all(period.to, period.from, ...names) as StayRow[]).map(
        (r): SummaryStay => ({ id: r.id, listing: r.listing, checkIn: r.check_in, checkOut: r.check_out, classes: taxClasses(db, r.id), paidCents: paymentRows(db, r.id).filter((p) => p.kind === "tax" && p.status === "paid").reduce((n, p) => n + p.amount, 0) }),
      );
      const s = taxSummary(rule, period, stays);
      const name = `${place}-${period.label}`;
      if (url.searchParams.get("formato") === "csv") send(res, 200, "text/csv; charset=utf-8", summaryCsv(s, lang), "", { "content-disposition": `attachment; filename="${name}.csv"` });
      else send(res, 200, "application/pdf", summaryPdf(s, lang, today), "", { "content-disposition": `attachment; filename="${name}.pdf"` });
      return true;
    }

    let banner = "";
    if (req.method === "POST" && url.pathname === "/pagamenti/conferma") {
      const form = await readForm(req);
      const place = form?.get("place") ?? "";
      if (!form || !tokenOk(ctx.secret, `confirm:${place}`, form.get("t"))) banner = `<div class="banner bad" role="alert">${esc(w.stale)}</div>`;
      else {
        confirmTaxPlace(ctx.dir, place);
        res.writeHead(303, { location: `/pagamenti?lang=${lang}&fatto=1`, "cache-control": "no-store" }).end();
        return true;
      }
    } else if (req.method === "POST" && (url.pathname === "/pagamenti/rilascia" || url.pathname === "/pagamenti/trattieni")) {
      const form = await readForm(req);
      const stay = form?.get("stay") ?? "";
      const keep = url.pathname.endsWith("trattieni");
      if (!form || !tokenOk(ctx.secret, `${keep ? "keep" : "release"}:${stay}`, form.get("t")) || !key) banner = `<div class="banner bad" role="alert">${esc(w.stale)}</div>`;
      else {
        const client = new StripeClient(key, ctx.io);
        try {
          const raw = (form.get("amount") ?? "").trim().replace(",", ".");
          const amount = raw === "" ? undefined : Math.round(Number(raw) * 100);
          if (amount !== undefined && !(amount > 0)) throw new Error(w.badAmount);
          if (keep) await keepDeposit(db, client, stay, amount, now);
          else await releaseDeposit(db, client, stay, now);
          // Back to the page with a plain GET, so a reload does not post again.
          res.writeHead(303, { location: `/pagamenti?lang=${lang}&fatto=1`, "cache-control": "no-store" }).end();
          return true;
        } catch (e) {
          banner = `<div class="banner bad" role="alert">${esc(w.error)} ${esc((e as Error).message)}</div>`;
        }
      }
    } else if (req.method !== "GET" || url.pathname !== "/pagamenti") {
      send(res, 404, "text/plain; charset=utf-8", "not found");
      return true;
    }
    if (url.searchParams.get("fatto") === "1") banner = `<div class="banner ok" role="status">${esc(w.done)}</div>`;

    const stays = guestsEnabled(db) ? currentStays(db, config, today) : [];
    if (key) {
      const client = new StripeClient(key, ctx.io);
      for (const row of stays) await refreshPayments(db, client, row.id, now).catch((e: unknown) => ctx.io.err(`Payments for stay ${row.id}: ${(e as Error).message}`));
    }
    const mode = `<p class="mode">${esc(key ? (key.live ? w.live : w.test) : w.noKey)}</p>`;
    const on = config.listings.some((l) => paymentsOn(l.fairguest) || l.fairguest?.touristTax);
    const cards = stays.map((r) => stayCard(db, ctx, config.listings.find((l) => l.name === r.listing) as HostListing, r, lang, key)).join("");
    const nav = `<p><a class="back" href="/">← ${esc(w.back)}</a></p>`;
    const body = nav + banner + mode + verifyBoxes(ctx, config, lang) + (on ? `<section class="pay">${cards || `<p class="message">${esc(w.none)}</p>`}</section>` + summaryForm(config, lang) : `<p class="message">${esc(w.off)}</p>`);
    const html = page(lang, w.title, body, nonce, (l) => `/pagamenti?lang=${l}`).replace("</style>", `${EXTRA}</style>`);
    send(res, banner.includes("bad") ? 422 : 200, "text/html; charset=utf-8", html, nonce);
    return true;
  } finally {
    db.close();
  }
}
