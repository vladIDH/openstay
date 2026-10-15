/**
 * The page /risposte of `fairnight serve`: the drafts to approve, with the
 * conversation, the draft in a box the host can change, and two buttons.
 *
 * - Only from this computer: any other address (also with --lan) and any
 *   request that went through a proxy or a tunnel is refused. Guests on the
 *   same wifi never see it.
 * - Plain HTML forms, no JavaScript. Every form carries a token signed with a
 *   secret made at each start of the server, so another site cannot post them.
 * - The "Notte" look of the calendar: dark by default, light with the system.
 * - Fairnight's prices of the free nights around a stay are shown here, to
 *   the host only: they never go to the model.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Flag } from "fairhello";
import { loadHostConfig, type HostListing } from "../config.js";
import { openDb, type Db } from "../db.js";
import { dbPath, localToday, type Io } from "../io.js";
import { isLanguage, type Language } from "../lingua.js";
import { priceOne } from "../price.js";
import { nearbyNights } from "./drafts.js";
import { readAndDraft, sendDraft, type SendOutcome } from "./run.js";
import { conversation, discardDraft, flagsOf, helloTablesExist, lastRun, openDrafts, textToSend, type DraftView } from "./store.js";
import { HELLO_WORDS, type HelloWords } from "./texts.js";

export interface RepliesContext {
  dir: string;
  io: Io;
  /** Random per server start: signs the forms. */
  secret: Buffer;
  /** Fixed "today" (demos and tests). */
  today?: string;
}

const MAX_BODY = 64 * 1024;
const SHOWN_MESSAGES = 6;
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "cf-connecting-ip", "true-client-ip", "x-client-ip"];

/** This computer only: 127.0.0.0/8 or ::1, and no proxy in between. */
export function fromThisComputer(req: IncomingMessage): boolean {
  if (FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const a = req.socket.remoteAddress ?? "";
  const ip = a.startsWith("::ffff:") ? a.slice(7) : a;
  return ip === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function token(secret: Buffer, what: string): string {
  return createHmac("sha256", secret).update(`risposte:${what}`).digest("base64url");
}

function tokenOk(secret: Buffer, what: string, given: string | null): boolean {
  const want = Buffer.from(token(secret, what));
  const got = Buffer.from(given ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

const STYLE = `
:root{color-scheme:dark;--bg:#0f1318;--card:#171c23;--card-2:#1c222a;--line:#28303a;--text:#eef1f4;--muted:#a3adb8;--faint:#7f8a96;--accent:#7cc4ff;--on-accent:#08131d;--up:#f2b35b;--down:#4fd1b5;--bad:#f0a0a0;--input:#11161c}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f3f5f8;--card:#fff;--card-2:#edf1f6;--line:#dde3ea;--text:#141b22;--muted:#55606c;--faint:#6b7682;--accent:#1d5f99;--on-accent:#fff;--up:#a2580d;--down:#0d7462;--bad:#b42318;--input:#fff}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:22px 20px 48px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:6px}
.brand{font-weight:700;font-size:17px;margin-right:auto}.brand span{color:var(--muted);font-weight:400;font-size:14px}
nav{display:flex;gap:10px;font-size:13px}nav a{color:var(--muted);text-decoration:none}nav a[aria-current]{color:var(--text);font-weight:700}
a{color:var(--accent)}
.intro,.privacy{color:var(--muted);font-size:13px;margin:4px 0 14px}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 16px;margin-bottom:16px;background:var(--card);border:1px solid var(--line);border-radius:14px}
.bar b{font-size:20px;font-variant-numeric:tabular-nums}.bar .grow{margin-right:auto;color:var(--muted);font-size:13px}
.btn{font:inherit;cursor:pointer;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:999px;padding:8px 16px}
.btn:hover{border-color:var(--faint)}.btn:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:700}
.banner{border-radius:12px;padding:10px 14px;margin:0 0 14px;background:var(--card-2);border:1px solid var(--line)}.banner.bad{color:var(--bad)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:0 0 16px}
.card h2{font-size:17px;margin:0 0 2px}.meta{color:var(--muted);font-size:13px;margin:0 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.chip{font-size:12px;border-radius:999px;padding:3px 10px;border:1px solid var(--line);color:var(--muted)}
.chip.warn{border-color:var(--up);color:var(--up)}
.msgs{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.msg{max-width:88%;padding:8px 12px;border-radius:12px;background:var(--card-2);white-space:pre-wrap;overflow-wrap:anywhere}
.msg.host{align-self:flex-end;background:transparent;border:1px solid var(--line)}
.msg small{display:block;color:var(--faint);font-size:11px;margin-bottom:2px}
label{display:block;font-size:13px;color:var(--muted);margin:4px 0 6px}
textarea{width:100%;min-height:140px;resize:vertical;font:inherit;color:var(--text);background:var(--input);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.note{font-size:13px;color:var(--muted);margin:8px 0 0}
.free{font-size:13px;color:var(--muted);margin:10px 0 0;padding:8px 12px;border-left:3px solid var(--down)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.err{color:var(--bad);font-size:13px;margin:8px 0 0}
.stale{font-size:13px;color:var(--muted)}.stale li{margin:4px 0}.stale form{display:inline}
.stale .btn{padding:2px 10px;font-size:12px;margin-left:6px}
@media (max-width:600px){.wrap{padding:16px 16px 40px}.msg{max-width:100%}}
`;

function send(res: ServerResponse, status: number, html: string, nonce: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(html);
}

function shell(lang: Language, w: HelloWords, body: string, nonce: string): string {
  const nav = (["it", "es", "en"] as const)
    .map((l) => `<a href="/risposte?lang=${l}" hreflang="${l}"${l === lang ? ' aria-current="true"' : ""}>${HELLO_WORDS[l].langName}</a>`)
    .join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="dark light"><title>${esc(w.title)} · Fairnight</title><style nonce="${nonce}">${STYLE}</style></head><body><div class="wrap"><header><div class="brand">Fairnight <span>· ${esc(w.title)}</span></div><nav><a href="/">${esc(w.backToCalendar)}</a>${nav}</nav></header>${body}</div></body></html>`;
}

function day(iso: string, lang: Language): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function money(n: number, currency: string, lang: Language): string {
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n)} ${currency}`;
  }
}

/** The free nights around a stay with Fairnight's price, for the host only. */
function freeNights(db: Db, listing: HostListing | undefined, view: DraftView, today: string, lang: Language, w: HelloWords): string {
  if (!listing) return "";
  const nearby = nearbyNights(db, listing, view.stay, today);
  if (!nearby || nearby.freeBefore.length + nearby.freeAfter.length === 0) return "";
  const last = [...nearby.freeBefore, ...nearby.freeAfter].sort().at(-1) as string;
  const days = Math.min(400, Math.max(1, Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1));
  const result = priceOne(db, listing, today, days);
  const priceOf = new Map(result.nights.map((n) => [n.date, n.price]));
  const fmt = (dates: string[]) =>
    dates.length === 0
      ? w.noneFree
      : dates.map((d) => `${day(d, lang)}${priceOf.get(d) != null ? ` ${money(priceOf.get(d) as number, result.currency, lang)}` : ""}`).join(", ");
  return `<p class="free">${esc(w.free)}<br>${esc(w.freeBefore)}: ${esc(fmt(nearby.freeBefore))}<br>${esc(w.freeAfter)}: ${esc(fmt(nearby.freeAfter))}</p>`;
}

const OUTCOMES = new Set(["sent", "discarded", "price", "error", "not_found", "cancelled", "already_sent", "superseded", "host_turn", "newer_message", "no_message", "stay_ended"]);

function banner(url: URL, w: HelloWords): string {
  const o = url.searchParams.get("esito");
  if (o === "read") {
    const d = Number(url.searchParams.get("d")) || 0;
    const m = Number(url.searchParams.get("m")) || 0;
    return `<p class="banner" role="status">${esc(w.readDone(d, m))}</p>`;
  }
  if (o === "readfail") return `<p class="banner bad" role="alert">${esc(w.readFailed)} ${esc(w.reasons.error)}</p>`;
  if (!o || !OUTCOMES.has(o)) return "";
  if (o === "sent") return `<p class="banner" role="status">${esc(w.sent)}</p>`;
  if (o === "discarded") return `<p class="banner" role="status">${esc(w.discarded)}</p>`;
  return `<p class="banner bad" role="alert">${esc(w.reasons[o as keyof HelloWords["reasons"]])}</p>`;
}

function renderPage(ctx: RepliesContext, url: URL, lang: Language, nonce: string): string {
  const w = HELLO_WORDS[lang];
  const config = loadHostConfig(ctx.dir);
  const today = ctx.today ?? localToday(ctx.io.now());
  const db = openDb(dbPath(ctx.dir));
  try {
    const views = helloTablesExist(db) ? openDrafts(db, today) : [];
    const ready = views.filter((v) => v.freshness.sendable);
    const stale = views.filter((v) => !v.freshness.sendable);
    const run = lastRun(db);
    let body = `<p class="intro">${esc(w.intro)}</p>${banner(url, w)}`;
    body += `<form class="bar" method="post" action="/risposte/leggi?lang=${lang}"><input type="hidden" name="t" value="${esc(token(ctx.secret, "leggi"))}"><b>${ready.length}</b><span class="grow">${esc(w.waiting(ready.length))}${run ? ` · ${esc(run.at.replace("T", " "))}` : ""}${run?.error ? ` · <span class="err">${esc(run.error)}</span>` : ""}</span><button class="btn" type="submit">${esc(w.read)}</button></form>`;
    if (ready.length === 0) body += `<p class="intro">${esc(w.noDrafts)}</p>`;
    for (const v of ready) {
      const { draft, stay } = v;
      const listing = config.listings.find((l) => l.name === stay.listing);
      const title = listing?.pricing.name ?? stay.listing;
      const flags = flagsOf(draft);
      const msgs = conversation(db, stay.id).slice(-SHOWN_MESSAGES);
      const t = token(ctx.secret, String(draft.id));
      const chip = (f: Flag) => `<span class="chip${f === "price" || f === "emergency" ? " warn" : ""}">${esc(w.flags[f])}</span>`;
      body += `<article class="card" id="d${draft.id}">
<h2>${esc(title)}</h2>
<p class="meta">#${draft.id} · ${esc(w.stay)} ${esc(day(stay.check_in, lang))} → ${esc(day(stay.check_out, lang))}${stay.guests ? ` · ${esc(w.guests(stay.guests))}` : ""}${stay.channel ? ` · ${esc(stay.channel)}` : ""}${draft.language ?? stay.language ? ` · ${esc(w.language)}: ${esc((draft.language ?? stay.language) as string)}` : ""}</p>
${flags.length || draft.needs_host ? `<div class="chips">${draft.needs_host ? `<span class="chip warn">${esc(w.needsHost)}</span>` : ""}${flags.map(chip).join("")}</div>` : ""}
<div class="msgs" aria-label="${esc(w.conversation)}">${msgs
        .map((m) => `<div class="msg${m.sender === "guest" ? "" : " host"}"><small>${esc(m.sender === "guest" ? w.guest : m.sender === "host" ? w.host : w.channelNote)}</small>${esc(m.text)}</div>`)
        .join("")}</div>
<form method="post" action="/risposte/${draft.id}/invia?lang=${lang}">
<input type="hidden" name="t" value="${esc(t)}">
<label for="text${draft.id}">${esc(w.draft)}</label>
<textarea id="text${draft.id}" name="text" maxlength="5000">${esc(textToSend(draft))}</textarea>
${draft.note ? `<p class="note">${esc(w.note)}: ${esc(draft.note)}</p>` : ""}
${draft.error ? `<p class="err">${esc(w.failedBefore)} ${esc(draft.error)}</p>` : ""}
${freeNights(db, listing, v, today, lang, w)}
<div class="actions"><button class="btn primary" type="submit">${esc(w.send)}</button><button class="btn" type="submit" formaction="/risposte/${draft.id}/scarta?lang=${lang}">${esc(w.discard)}</button></div>
</form>
</article>`;
    }
    if (stale.length > 0) {
      body += `<details class="stale"><summary>${esc(w.stale(stale.length))}</summary><ul>${stale
        .map(
          (v) =>
            `<li>#${v.draft.id} · ${esc(v.stay.listing)} · ${esc(w.reasons[v.freshness.reason as keyof HelloWords["reasons"]])}<form method="post" action="/risposte/${v.draft.id}/scarta?lang=${lang}"><input type="hidden" name="t" value="${esc(token(ctx.secret, String(v.draft.id)))}"><button class="btn" type="submit">${esc(w.discard)}</button></form></li>`,
        )
        .join("")}</ul></details>`;
    }
    body += `<p class="privacy">${esc(w.privacy)} ${esc(w.priceHint)}</p>`;
    return shell(lang, w, body, nonce);
  } finally {
    db.close();
  }
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

function langOf(url: URL, config: { language?: Language }): Language {
  const q = url.searchParams.get("lang");
  return isLanguage(q) ? q : (config.language ?? "en");
}

function redirect(res: ServerResponse, lang: Language, outcome: string, anchor = "", extra = ""): void {
  res.writeHead(303, { location: `/risposte?lang=${lang}&esito=${outcome}${extra}${anchor}`, "cache-control": "no-store" }).end();
}

const outcomeCode = (o: SendOutcome) => (o.ok ? "sent" : o.reason);

/** Handles /risposte and its forms; returns false for any other path. */
export async function handleReplies(req: IncomingMessage, res: ServerResponse, url: URL, ctx: RepliesContext, nonce: string): Promise<boolean> {
  if (url.pathname !== "/risposte" && !url.pathname.startsWith("/risposte/")) return false;
  const config = loadHostConfig(ctx.dir);
  const lang = langOf(url, config);
  const w = HELLO_WORDS[lang];
  if (!fromThisComputer(req)) {
    send(res, 403, shell(lang, w, `<p class="banner bad">${esc(w.forbidden)}</p>`, nonce), nonce);
    return true;
  }
  if (req.method === "GET" && (url.pathname === "/risposte" || url.pathname === "/risposte/")) {
    send(res, 200, renderPage(ctx, url, lang, nonce), nonce);
    return true;
  }
  const m = /^\/risposte\/(?:(leggi)|(\d{1,9})\/(invia|scarta))$/.exec(url.pathname);
  if (!m) {
    send(res, 404, shell(lang, w, `<p class="banner bad">${esc(w.reasons.not_found)}</p>`, nonce), nonce);
    return true;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end();
    return true;
  }
  // Browsers say where a form comes from: only this page may post.
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "null" && new URL(origin).host !== req.headers.host) {
    res.writeHead(403).end();
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
  const what = m[1] ? "leggi" : (m[2] as string);
  if (!tokenOk(ctx.secret, what, form.get("t"))) {
    send(res, 403, shell(lang, w, `<p class="banner bad">${esc(w.forbidden)}</p>`, nonce), nonce);
    return true;
  }
  if (m[1]) {
    try {
      const s = await readAndDraft(ctx.dir, ctx.io, { drafts: true });
      const failed = s.reads.some((r) => r.error) || s.drafts?.stopped;
      if (failed) redirect(res, lang, "readfail");
      else redirect(res, lang, "read", "", `&d=${s.drafts?.written ?? 0}&m=${s.reads.reduce((n, r) => n + r.newMessages, 0)}`);
    } catch (e) {
      ctx.io.err(`risposte: ${(e as Error).message}`);
      redirect(res, lang, "readfail");
    }
    return true;
  }
  const id = Number(m[2]);
  if (m[3] === "scarta") {
    const db = openDb(dbPath(ctx.dir));
    let ok: boolean;
    try {
      ok = discardDraft(db, id, ctx.io.now());
    } finally {
      db.close();
    }
    redirect(res, lang, ok ? "discarded" : "not_found");
    return true;
  }
  const text = form.get("text");
  const outcome = await sendDraft(ctx.dir, ctx.io, id, text ?? undefined);
  redirect(res, lang, outcomeCode(outcome), outcome.ok ? "" : `#d${id}`);
  return true;
}
