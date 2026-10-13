/**
 * The check-in form, served by `fairnight serve` at /checkin/<code>.
 *
 * - Only from this computer or the local network: any other address, and any
 *   request that went through a proxy or tunnel (forwarding headers), is refused.
 * - The code is random (96 bits) and works until the day of check-out.
 * - A guest's data is sealed with the public key as soon as it arrives: the
 *   server never knows the passphrase and cannot read back what was saved.
 * - Plain HTML, no JavaScript, no external file; Spanish, English, Italian.
 * - Only the TYPE of payment exists in the form. Any other field sent is ignored.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIPv4, isIPv6 } from "node:net";
import { countryNames, guestRules, isPaymentType, localDateTime, parseGuest, DOCUMENT_TYPES, KINSHIPS, PAYMENT_TYPES, SEXES, type Problem } from "fairguest";
import { loadHostConfig } from "../config.js";
import { openDb } from "../db.js";
import { dbPath, type Io } from "../io.js";
import { pickLang, LANGS, WORDS, type Lang, type Words } from "./i18n.js";
import { addPerson, guestsEnabled, peopleCount, type StayRow } from "./store.js";

export interface CheckinContext {
  dir: string;
  io: Io;
  /** Random per server start: signs the form token. */
  secret: Buffer;
  /** Wrong codes per address, to slow down guessing. */
  failures: Map<string, { count: number; since: number }>;
}

const MAX_FAILURES = 20;
const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_BODY = 16 * 1024;
const MAX_GUESTS = 50;

/** Headers added by proxies and tunnels (ngrok, Cloudflare, reverse proxies). */
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "cf-connecting-ip", "true-client-ip", "x-client-ip"];

/** Loopback, private ranges (RFC 1918), link-local, IPv6 unique local. */
export function isLocalAddress(raw: string | undefined): boolean {
  if (!raw) return false;
  const ip = raw.startsWith("::ffff:") && isIPv4(raw.slice(7)) ? raw.slice(7) : raw;
  if (isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || /^fe[89ab]/.test(lower) || /^f[cd]/.test(lower);
  }
  return false;
}

export function fromLocalNetwork(req: IncomingMessage): boolean {
  if (FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return isLocalAddress(req.socket.remoteAddress);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function token(secret: Buffer, code: string): string {
  return createHmac("sha256", secret).update(`checkin:${code}`).digest("base64url");
}

function tokenOk(secret: Buffer, code: string, given: string | null): boolean {
  const want = Buffer.from(token(secret, code));
  const got = Buffer.from(given ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

function send(res: ServerResponse, status: number, html: string, nonce: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    ...extra,
  });
  res.end(html);
}

const STYLE = `
:root{color-scheme:light;--ink:#1d2327;--muted:#5f6b73;--line:#d5dade;--accent:#1f5f8b;--bad:#a4262c;--ok:#1e6b3a;--bg:#f6f7f8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
h1{font-size:1.35rem;margin:8px 0}nav{display:flex;flex-wrap:wrap;gap:4px 12px}nav a{color:var(--accent);font-size:.9rem}nav a[aria-current]{font-weight:700;text-decoration:none;color:var(--ink)}
.stay{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0}
.stay b{display:block;font-size:1.05rem}.muted{color:var(--muted);font-size:.92rem}
fieldset{border:1px solid var(--line);border-radius:8px;background:#fff;margin:14px 0;padding:10px 14px 14px;min-width:0}
legend{font-weight:700;padding:0 6px}
label{display:block;margin-top:10px;font-weight:600;font-size:.95rem}
input,select{display:block;width:100%;max-width:100%;min-width:0;margin-top:4px;padding:10px;border:1px solid #aeb6bc;border-radius:6px;font:inherit;background:#fff;color:var(--ink)}
input[type=checkbox]{display:inline;width:auto;margin-right:8px}
.check{font-weight:400}
.hint{font-weight:400;color:var(--muted);font-size:.85rem}
.err{color:var(--bad);font-size:.88rem;font-weight:600;margin-top:4px}
.has-err input,.has-err select{border-color:var(--bad)}
.banner{border-radius:8px;padding:10px 14px;margin:12px 0}.banner.ok{background:#e6f2ea;color:var(--ok)}.banner.bad{background:#f8e6e7;color:var(--bad)}
button,.button{display:inline-block;margin-top:16px;padding:12px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;text-decoration:none}
.privacy{font-size:.85rem;color:var(--muted);margin-top:18px}
`;

function page(lang: Lang, title: string, body: string, nonce: string, langLink?: (l: Lang) => string): string {
  const nav = langLink
    ? `<nav>${LANGS.map((l) => `<a href="${esc(langLink(l))}"${l === lang ? ' aria-current="true"' : ""}>${WORDS[l].langName}</a>`).join("")}</nav>`
    : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head><body><main><header><h1>${esc(title)}</h1>${nav}</header>${body}</main></body></html>`;
}

/** Which form field a problem belongs to. */
function fieldOf(path: string): string {
  const rest = path.replace(/^guests?(\[\d+\])?\.?/, "");
  const map: Record<string, string> = {
    "": "phone",
    "document": "docType",
    "document.type": "docType",
    "document.number": "docNumber",
    "document.support": "docSupport",
    "document.issuedOn": "docIssued",
    "address": "country",
    "address.country": "country",
    "address.street": "street",
    "address.postalCode": "postalCode",
    "address.locality": "locality",
    "address.municipalityCode": "postalCode",
    phone2: "phone",
  };
  return map[rest] ?? rest;
}

function errorsByField(problems: Problem[], w: Words): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of problems) {
    const field = fieldOf(p.path);
    if (out.has(field)) continue;
    const contact = p.message.startsWith("at least one phone");
    const required = /required|missing/.test(p.message);
    out.set(field, contact ? w.contactMissing : required ? w.required : w.invalid);
  }
  return out;
}

interface FormState {
  values: Record<string, string>;
  errors: Map<string, string>;
}

function renderForm(w: Words, lang: Lang, action: string, tok: string, registered: number, state: FormState): string {
  const v = (k: string) => esc(state.values[k] ?? "");
  const err = (k: string) => (state.errors.has(k) ? `<div class="err">${esc(state.errors.get(k) as string)}</div>` : "");
  const cls = (k: string) => (state.errors.has(k) ? ' class="has-err"' : "");
  const input = (k: string, type = "text", extra = "") =>
    `<div${cls(k)}><label for="${k}">${esc(w.fields[k] as string)}${w.hints[k] ? ` <span class="hint">${esc(w.hints[k] as string)}</span>` : ""}</label><input id="${k}" name="${k}" type="${type}" value="${v(k)}" ${extra}>${err(k)}</div>`;
  const select = (k: string, options: [string, string][], hint?: string) =>
    `<div${cls(k)}><label for="${k}">${esc(w.fields[k] as string)}${hint ? ` <span class="hint">${esc(hint)}</span>` : ""}</label><select id="${k}" name="${k}"><option value="">${esc(w.choose)}</option>${options
      .map(([val, label]) => `<option value="${esc(val)}"${state.values[k] === val ? " selected" : ""}>${esc(label)}</option>`)
      .join("")}</select>${err(k)}</div>`;
  const countries = countryNames(lang).map((c): [string, string] => [c.code, c.name]);
  const first = registered === 0;
  return `<form method="post" action="${esc(action)}" autocomplete="off">
<input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="lang" value="${lang}">
<h2>${esc(first ? w.firstGuest : w.nextGuest(registered + 1))}</h2>
<fieldset><legend>${esc(w.sections.person)}</legend>
${input("givenName", "text", 'maxlength="50" required')}${input("surname1", "text", 'maxlength="50" required')}${input("surname2", "text", 'maxlength="50"')}
${input("birthDate", "date")}
${select("sex", SEXES.map((s) => [s, w.sex[s]]))}
${select("nationality", countries)}
${first ? "" : select("kinship", KINSHIPS.map((k) => [k, w.kinship[k]]), w.hints.kinship)}
</fieldset>
<fieldset><legend>${esc(w.sections.document)}</legend>
${select("docType", DOCUMENT_TYPES.map((d) => [d, w.documentTypes[d]]))}
${input("docNumber", "text", 'maxlength="20"')}${input("docSupport", "text", 'maxlength="9"')}${input("docIssued", "date")}
<label class="check"><input type="checkbox" name="docSpanish" value="1"${state.values.docSpanish ? " checked" : ""}>${esc(w.fields.docSpanish as string)}</label>
</fieldset>
<fieldset><legend>${esc(w.sections.address)}</legend>
${select("country", countries)}${input("street", "text", 'maxlength="100"')}${input("postalCode", "text", 'maxlength="20"')}${input("locality", "text", 'maxlength="100"')}
</fieldset>
<fieldset><legend>${esc(w.sections.contact)}</legend><p class="hint">${esc(w.hints.contact as string)}</p>
${input("phone", "tel", 'maxlength="20"')}${input("email", "email", 'maxlength="100"')}
</fieldset>
${first ? `<fieldset><legend>${esc(w.sections.payment)}</legend>${select("payment", PAYMENT_TYPES.map((p) => [p, w.payment[p]]))}<p class="hint">${esc(w.paymentNote)}</p></fieldset>` : ""}
<button type="submit">${esc(w.save)}</button>
</form>`;
}

/** The guest object from the posted form; unknown fields are never read. */
function guestInput(f: URLSearchParams): Record<string, unknown> {
  const g = (k: string) => f.get(k) ?? "";
  return {
    givenName: g("givenName"),
    surname1: g("surname1"),
    surname2: g("surname2"),
    birthDate: g("birthDate"),
    sex: g("sex"),
    nationality: g("nationality"),
    kinship: g("kinship"),
    document: { type: g("docType"), number: g("docNumber"), support: g("docSupport"), issuedOn: g("docIssued"), spanish: f.get("docSpanish") === "1" && g("docType") === "passport" },
    address: { country: g("country"), street: g("street"), postalCode: g("postalCode"), locality: g("locality") },
    phone: g("phone"),
    email: g("email"),
  };
}

const FORM_KEYS = ["givenName", "surname1", "surname2", "birthDate", "sex", "nationality", "kinship", "docType", "docNumber", "docSupport", "docIssued", "docSpanish", "country", "street", "postalCode", "locality", "phone", "email", "payment"];

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function tooManyFailures(ctx: CheckinContext, ip: string): boolean {
  const f = ctx.failures.get(ip);
  return !!f && Date.now() - f.since < FAILURE_WINDOW_MS && f.count >= MAX_FAILURES;
}

function noteFailure(ctx: CheckinContext, ip: string): void {
  const f = ctx.failures.get(ip);
  if (!f || Date.now() - f.since >= FAILURE_WINDOW_MS) ctx.failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

/** Handles /checkin/<code>; returns false for any other path. */
export async function handleCheckin(req: IncomingMessage, res: ServerResponse, url: URL, ctx: CheckinContext, nonce: string): Promise<boolean> {
  const m = /^\/checkin\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url.pathname);
  if (!m && url.pathname !== "/checkin" && !url.pathname.startsWith("/checkin/")) return false;
  const lang = pickLang(url.searchParams.get("lang"), req.headers["accept-language"]);
  const w = WORDS[lang];
  if (!fromLocalNetwork(req)) {
    send(res, 403, page(lang, w.forbidden, `<p>${esc(w.forbiddenText)}</p>`, nonce), nonce);
    return true;
  }
  const ip = req.socket.remoteAddress ?? "?";
  if (tooManyFailures(ctx, ip)) {
    send(res, 429, page(lang, w.tooMany, `<p>${esc(w.tooMany)}</p>`, nonce), nonce, { "retry-after": "600" });
    return true;
  }
  const code = m?.[1] ?? "";
  const now = ctx.io.now();
  const today = localDateTime(now).slice(0, 10);
  const config = loadHostConfig(ctx.dir);
  const db = openDb(dbPath(ctx.dir));
  try {
    const row = guestsEnabled(db)
      ? ((db.prepare("SELECT * FROM guest_stays WHERE code = ? AND erased_at IS NULL AND cancelled_at IS NULL AND check_out >= ?").get(code, today) as StayRow | undefined) ?? null)
      : null;
    const listing = row ? config.listings.find((l) => l.name === row.listing) : undefined;
    if (!row || !listing?.fairguest) {
      noteFailure(ctx, ip);
      send(res, 404, page(lang, w.notFound, `<p>${esc(w.notFoundText)}</p>`, nonce), nonce);
      return true;
    }
    const action = `/checkin/${code}`;
    const langLink = (l: Lang) => `${action}?lang=${l}`;
    const registered = peopleCount(db, row.id);
    const header = `<div class="stay"><b>${esc(listing.pricing.name ?? listing.name)}</b>${esc(w.stay)}: ${esc(row.check_in)} → ${esc(row.check_out)}<div class="muted">${esc(w.registered(registered))}</div></div>`;
    const intro = `<p>${esc(w.intro)}</p>`;
    const privacy = `<p class="privacy">${esc(w.privacy)}</p>`;
    const tok = token(ctx.secret, code);

    if (req.method === "GET") {
      const saved = Number(url.searchParams.get("saved"));
      const banner = Number.isInteger(saved) && saved > 0 ? `<div class="banner ok">${esc(w.saved(saved))} ${esc(w.finished)}</div>` : "";
      const body = registered >= MAX_GUESTS ? header : header + banner + intro + renderForm(w, lang, action, tok, registered, { values: {}, errors: new Map() }) + privacy;
      send(res, 200, page(lang, w.title, body, nonce, langLink), nonce);
      return true;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "GET, POST" }).end();
      return true;
    }
    if (!String(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
      res.writeHead(415).end();
      return true;
    }
    const raw = await readBody(req);
    if (raw === null) {
      res.writeHead(413).end();
      return true;
    }
    const form = new URLSearchParams(raw);
    const postLang = pickLang(form.get("lang"), req.headers["accept-language"]);
    const pw = WORDS[postLang];
    if (!tokenOk(ctx.secret, code, form.get("t")) || registered >= MAX_GUESTS) {
      send(res, 403, page(postLang, pw.notFound, `<p>${esc(pw.notFoundText)}</p>`, nonce), nonce);
      return true;
    }
    const parsed = parseGuest(guestInput(form), today);
    const problems = [...parsed.problems];
    const docAge = listing.fairguest.country === "ES-CT" ? 14 : 18;
    problems.push(...guestRules(parsed.draft, registered, row.check_in, docAge, { skipMunicipalityCode: true }));
    const payment = form.get("payment") ?? "";
    if (registered === 0 && !isPaymentType(payment)) problems.push({ path: "payment", message: "the type of payment is required" });
    if (problems.length > 0 || !parsed.guest) {
      const values: Record<string, string> = {};
      for (const k of FORM_KEYS) values[k] = form.get(k) ?? "";
      const body =
        header +
        `<div class="banner bad">${esc(pw.fix)}</div>` +
        renderForm(pw, postLang, action, tok, registered, { values, errors: errorsByField(problems, pw) }) +
        privacy;
      send(res, 422, page(postLang, pw.title, body, nonce, (l) => `${action}?lang=${l}`), nonce);
      return true;
    }
    addPerson(db, row.id, registered === 0 && isPaymentType(payment) ? { guest: parsed.guest, payment } : { guest: parsed.guest }, "form", now);
    res.writeHead(303, { location: `${action}?lang=${postLang}&saved=${registered + 1}`, "cache-control": "no-store" }).end();
    return true;
  } finally {
    db.close();
  }
}
