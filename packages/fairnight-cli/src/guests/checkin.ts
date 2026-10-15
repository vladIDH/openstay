/**
 * The check-in form, served by `fairnight serve` at /checkin/<code>.
 *
 * - Only from this computer or the local network: any other address, and any
 *   request that went through a proxy or tunnel (forwarding headers), is refused.
 * - The code is random (96 bits) and works until the day of check-out.
 * - A guest's data is sealed with the public key as soon as it arrives: the
 *   server never knows the passphrase and cannot read back what was saved.
 * - Plain HTML, no JavaScript, no external file; Spanish, English, Italian.
 *   Light or dark with the guest's phone; three steps on screen (details,
 *   document, confirmation) over the same single form.
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
:root{color-scheme:light;--bg:#f6f4ef;--card:#fffdf9;--ink:#1d2024;--muted:#555c63;--line:#e3ded4;--field:#c9c2b5;--input:#fff;--accent:#24507a;--on-accent:#fff;--soft:#e9eef3;--bad:#a3262e;--bad-bg:#fdf3f3;--ok:#1e6b3a;--ok-bg:#e6f1e9}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#171512;--card:#211e1a;--ink:#f1ede6;--muted:#b9b1a5;--line:#36312a;--field:#5b5349;--input:#1b1916;--accent:#8db8e3;--on-accent:#10161c;--soft:#25303a;--bad:#ff9b94;--bad-bg:#3a2222;--ok:#8fd4a5;--ok-bg:#1f3326}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:600px;margin:0 auto;padding:18px 16px 32px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
h1{font-size:1.4rem;line-height:1.2;margin:4px 0 12px}
nav{display:flex;gap:4px 10px;flex-wrap:wrap;justify-content:flex-end;font-size:.9rem;padding-top:6px}
nav a{color:var(--muted);text-decoration:none}nav a[aria-current]{color:var(--ink);font-weight:700}
nav a:focus-visible,a.button:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.stay{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.stay b{display:block;font-size:1.05rem}.stay span{color:var(--muted);font-size:.95rem}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:16px 0 4px;padding:0;list-style:none;font-size:.82rem;color:var(--muted)}
.steps li{border-top:4px solid var(--line);padding-top:6px}
.steps li.done{border-color:var(--accent)}.steps li[aria-current]{border-color:var(--accent);color:var(--ink);font-weight:700}
.privacy-line{display:flex;gap:9px;align-items:flex-start;background:var(--soft);border-radius:12px;padding:10px 12px;margin:12px 0 4px;font-size:.92rem}
.privacy-line svg{flex:none;margin-top:3px;color:var(--accent)}
.intro{color:var(--muted);font-size:.95rem}
h2{font-size:1.15rem;margin:22px 0 6px}
.step{margin:14px 0}
.step h3{display:flex;align-items:center;gap:10px;font-size:1.1rem;margin:0 0 8px}
.n{flex:none;width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--on-accent);font-size:.9rem;display:grid;place-items:center}
fieldset{border:1px solid var(--line);border-radius:16px;background:var(--card);margin:10px 0;padding:6px 16px 16px;min-width:0}
legend{font-weight:700;padding:0 6px;font-size:1rem}
label{display:block;margin-top:14px;font-weight:600;font-size:.95rem}
input,select{display:block;width:100%;max-width:100%;min-width:0;margin-top:5px;padding:12px 13px;border:1.5px solid var(--field);border-radius:12px;font:inherit;background:var(--input);color:var(--ink);min-height:48px}
input:focus,select:focus{outline:3px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
input[type=checkbox]{display:inline;width:22px;height:22px;min-height:0;margin:0 10px 0 0;vertical-align:-5px;accent-color:var(--accent)}
.check{font-weight:400}
.hint{display:block;font-weight:400;color:var(--muted);font-size:.85rem;margin-top:2px}
.err{color:var(--bad);font-size:.9rem;font-weight:600;margin-top:6px}
.has-err input,.has-err select{border-color:var(--bad);background:var(--bad-bg)}
.banner{border-radius:12px;padding:12px 14px;margin:14px 0;font-weight:600}.banner.bad{background:var(--bad-bg);color:var(--bad)}
button,.button{display:block;width:100%;text-align:center;margin-top:18px;padding:15px 18px;border:0;border-radius:14px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.done-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 18px;margin:16px 0;text-align:center}
.done-card .tick{width:56px;height:56px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center;margin:0 auto 10px}
.done-card h2{margin:4px 0}.done-card p{color:var(--muted);margin:6px 0 0}
details.another>summary{list-style:none;display:block;text-align:center;margin-top:6px;padding:14px 18px;border-radius:14px;border:1.5px solid var(--accent);color:var(--accent);font-weight:700;cursor:pointer}
details.another>summary::-webkit-details-marker{display:none}
details.another[open]>summary{display:none}
.privacy{font-size:.85rem;color:var(--muted);margin-top:22px}
.message{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-top:12px}
@media (max-width:480px){.top{flex-direction:column-reverse;gap:2px}nav{align-self:flex-end;padding-top:0}}
`;

function page(lang: Lang, title: string, body: string, nonce: string, langLink?: (l: Lang) => string): string {
  const nav = langLink
    ? `<nav>${LANGS.map((l) => `<a href="${esc(langLink(l))}" hreflang="${l}"${l === lang ? ' aria-current="true"' : ""}>${WORDS[l].langName}</a>`).join("")}</nav>`
    : "";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><style nonce="${nonce}">${STYLE}</style></head><body><main><header class="top"><h1>${esc(title)}</h1>${nav}</header>${body}</main></body></html>`;
}

const LOCK = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z"/></svg>`;
const TICK = `<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/** The three steps at the top; `at` is the current one (1 details, 2 document, 3 confirmation). */
function stepsBar(w: Words, at: 1 | 2 | 3): string {
  const names = [w.steps.data, w.steps.document, w.steps.confirm];
  return `<ol class="steps" aria-label="${esc(w.stepLabel(at))}">${names
    .map((name, i) => `<li${i + 1 === at ? ' aria-current="step"' : i + 1 < at ? ' class="done"' : ""}>${i + 1} · ${esc(name)}</li>`)
    .join("")}</ol>`;
}

/** A day of the stay in the guest's language, like "10 giugno 2099". */
function stayDay(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
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
    // Problems about the whole guest land on "phone"; only the missing contact belongs there
    // (a missing name is already shown on the name fields).
    if (field === "phone" && !contact && !p.path.endsWith("phone")) continue;
    const required = /required|missing/.test(p.message);
    out.set(field, contact ? w.contactMissing : required ? w.required : (w.invalidFor[field] ?? w.invalid));
  }
  return out;
}

interface FormState {
  values: Record<string, string>;
  errors: Map<string, string>;
}

function renderForm(w: Words, lang: Lang, action: string, tok: string, registered: number, state: FormState): string {
  const v = (k: string) => esc(state.values[k] ?? "");
  const err = (k: string) => (state.errors.has(k) ? `<div class="err" id="${k}-err">${esc(state.errors.get(k) as string)}</div>` : "");
  const cls = (k: string) => (state.errors.has(k) ? ' class="has-err"' : "");
  const input = (k: string, type = "text", extra = "") =>
    `<div${cls(k)}><label for="${k}">${esc(w.fields[k] as string)}${w.hints[k] ? ` <span class="hint">${esc(w.hints[k] as string)}</span>` : ""}</label><input id="${k}" name="${k}" type="${type}" value="${v(k)}" ${extra}${state.errors.has(k) ? ` aria-invalid="true" aria-describedby="${k}-err"` : ""}>${err(k)}</div>`;
  const select = (k: string, options: [string, string][], hint?: string) =>
    `<div${cls(k)}><label for="${k}">${esc(w.fields[k] as string)}${hint ? ` <span class="hint">${esc(hint)}</span>` : ""}</label><select id="${k}" name="${k}"><option value="">${esc(w.choose)}</option>${options
      .map(([val, label]) => `<option value="${esc(val)}"${state.values[k] === val ? " selected" : ""}>${esc(label)}</option>`)
      .join("")}</select>${err(k)}</div>`;
  const countries = countryNames(lang).map((c): [string, string] => [c.code, c.name]);
  const first = registered === 0;
  // Step 1: the person, where they live, how to reach them. Step 2: the document (and, for the holder, the payment).
  return `<form method="post" action="${esc(action)}" autocomplete="off" id="form">
<input type="hidden" name="t" value="${esc(tok)}"><input type="hidden" name="lang" value="${lang}">
<h2>${esc(first ? w.firstGuest : w.nextGuest(registered + 1))}</h2>
<section class="step"><h3><span class="n">1</span>${esc(w.steps.data)}</h3>
<fieldset><legend>${esc(w.sections.person)}</legend>
${input("givenName", "text", 'maxlength="50" required autocomplete="given-name"')}${input("surname1", "text", 'maxlength="50" required')}${input("surname2", "text", 'maxlength="50"')}
${input("birthDate", "date")}
${select("sex", SEXES.map((s) => [s, w.sex[s]]))}
${select("nationality", countries)}
${first ? "" : select("kinship", KINSHIPS.map((k) => [k, w.kinship[k]]), w.hints.kinship)}
</fieldset>
<fieldset><legend>${esc(w.sections.address)}</legend>
${select("country", countries)}${input("street", "text", 'maxlength="100"')}${input("postalCode", "text", 'maxlength="20"')}${input("locality", "text", 'maxlength="100"')}
</fieldset>
<fieldset><legend>${esc(w.sections.contact)}</legend><p class="hint">${esc(w.hints.contact as string)}</p>
${input("phone", "tel", 'maxlength="20" inputmode="tel"')}${input("email", "email", 'maxlength="100" inputmode="email"')}
</fieldset>
</section>
<section class="step"><h3><span class="n">2</span>${esc(w.steps.document)}</h3>
<fieldset><legend>${esc(w.sections.document)}</legend>
${select("docType", DOCUMENT_TYPES.map((d) => [d, w.documentTypes[d]]))}
${input("docNumber", "text", 'maxlength="20" autocapitalize="characters"')}${input("docSupport", "text", 'maxlength="9" autocapitalize="characters"')}${input("docIssued", "date")}
<label class="check"><input type="checkbox" name="docSpanish" value="1"${state.values.docSpanish ? " checked" : ""}>${esc(w.fields.docSpanish as string)}</label>
</fieldset>
${first ? `<fieldset><legend>${esc(w.sections.payment)}</legend>${select("payment", PAYMENT_TYPES.map((p) => [p, w.payment[p]]))}<p class="hint">${esc(w.paymentNote)}</p></fieldset>` : ""}
</section>
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
    send(res, 403, page(lang, w.forbidden, `<p class="message">${esc(w.forbiddenText)}</p>`, nonce), nonce);
    return true;
  }
  const ip = req.socket.remoteAddress ?? "?";
  if (tooManyFailures(ctx, ip)) {
    send(res, 429, page(lang, w.tooMany, `<p class="message">${esc(w.tooMany)}</p>`, nonce), nonce, { "retry-after": "600" });
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
      send(res, 404, page(lang, w.notFound, `<p class="message">${esc(w.notFoundText)}</p>`, nonce), nonce);
      return true;
    }
    const action = `/checkin/${code}`;
    const langLink = (l: Lang) => `${action}?lang=${l}`;
    const registered = peopleCount(db, row.id);
    const stayBox = (l: Lang, wl: Words) =>
      `<div class="stay"><b>${esc(listing.pricing.name ?? listing.name)}</b><span>${esc(wl.stay)}: ${esc(stayDay(row.check_in, l))} → ${esc(stayDay(row.check_out, l))} · ${esc(wl.registered(registered))}</span></div>`;
    const privacyLine = (wl: Words) => `<p class="privacy-line">${LOCK}<span>${esc(wl.privacyShort)}</span></p>`;
    const header = (l: Lang, wl: Words, at: 1 | 2 | 3) => stayBox(l, wl) + stepsBar(wl, at) + privacyLine(wl);
    const intro = `<p class="intro">${esc(w.intro)}</p>`;
    const privacy = (wl: Words) => `<p class="privacy">${esc(wl.privacy)}</p>`;
    const tok = token(ctx.secret, code);

    if (req.method === "GET") {
      const saved = Number(url.searchParams.get("saved"));
      const form = renderForm(w, lang, action, tok, registered, { values: {}, errors: new Map() });
      let body: string;
      if (registered >= MAX_GUESTS) body = header(lang, w, 3);
      else if (Number.isInteger(saved) && saved > 0) {
        // Step 3: a clear confirmation; the form for the next guest opens only if asked for.
        body =
          header(lang, w, 3) +
          `<div class="done-card" role="status"><div class="tick">${TICK}</div><h2>${esc(w.saved(saved))}</h2><p>${esc(w.finished)}</p></div>` +
          `<details class="another"><summary>${esc(w.addAnother)}</summary>${form}</details>` +
          privacy(w);
      } else body = header(lang, w, 1) + intro + form + privacy(w);
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
        header(postLang, pw, 1) +
        `<div class="banner bad" role="alert">${esc(pw.fix)}</div>` +
        renderForm(pw, postLang, action, tok, registered, { values, errors: errorsByField(problems, pw) }) +
        privacy(pw);
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
