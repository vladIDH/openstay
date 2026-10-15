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
 * - The questions follow the country of the listing: in Spain address, contact
 *   and the TYPE of payment; in Italy the places of birth and of issue, and the
 *   document only for the holder. Any other field sent is ignored.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIPv4, isIPv6 } from "node:net";
import { errorsByField, esc, FORM_KEYS, guestInput, isPaymentType, localDateTime, LOCK, page, parseGuest, registryFor, renderForm, stayDay, stepsBar, TICK, type Words } from "fairguest";
import { loadHostConfig } from "../config.js";
import { openDb } from "../db.js";
import { dbPath, type Io } from "../io.js";
import { pickLang, WORDS, type Lang } from "./i18n.js";
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
    const country = listing.fairguest.country;
    const law = (wl: Words) => (country === "IT" ? wl.italy : wl);
    const action = `/checkin/${code}`;
    const langLink = (l: Lang) => `${action}?lang=${l}`;
    const registered = peopleCount(db, row.id);
    const stayBox = (l: Lang, wl: Words) =>
      `<div class="stay"><b>${esc(listing.pricing.name ?? listing.name)}</b><span>${esc(wl.stay)}: ${esc(stayDay(row.check_in, l))} → ${esc(stayDay(row.check_out, l))} · ${esc(wl.registered(registered))}</span></div>`;
    const privacyLine = (wl: Words) => `<p class="privacy-line">${LOCK}<span>${esc(law(wl).privacyShort)}</span></p>`;
    const header = (l: Lang, wl: Words, at: 1 | 2 | 3) => stayBox(l, wl) + stepsBar(wl, at) + privacyLine(wl);
    const intro = `<p class="intro">${esc(law(w).intro)}</p>`;
    const privacy = (wl: Words) => `<p class="privacy">${esc(law(wl).privacy)}</p>`;
    const tok = token(ctx.secret, code);

    if (req.method === "GET") {
      const saved = Number(url.searchParams.get("saved"));
      const form = renderForm(w, lang, country, action, tok, registered, { values: {}, errors: new Map() });
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
    problems.push(...registryFor(country).checkGuest(parsed.draft, registered, row.check_in));
    const payment = form.get("payment") ?? "";
    // Only Spain asks for the type of payment (RD 933/2021); Italy does not.
    if (country !== "IT" && registered === 0 && !isPaymentType(payment)) problems.push({ path: "payment", message: "the type of payment is required" });
    if (problems.length > 0 || !parsed.guest) {
      const values: Record<string, string> = {};
      for (const k of FORM_KEYS) values[k] = form.get(k) ?? "";
      const body =
        header(postLang, pw, 1) +
        `<div class="banner bad" role="alert">${esc(pw.fix)}</div>` +
        renderForm(pw, postLang, country, action, tok, registered, { values, errors: errorsByField(problems, pw) }) +
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
