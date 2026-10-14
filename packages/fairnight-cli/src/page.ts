/**
 * The calendar page served by `fairnight serve`: one file, no external
 * resources, no framework. Data comes from /api/data and is only ever put in
 * the page as text (textContent), never as HTML.
 *
 * In Italian, Spanish or English: the texts are in page-texts.ts, dates and
 * prices are formatted by the browser (Intl) in the chosen language.
 */
import { PAGE_TEXTS } from "./page-texts.js";

const STYLE = `
:root {
  --bg: #0e1013; --surface: #161a20; --surface-2: #1c2128; --line: #262c35;
  --text: #e7e9ec; --muted: #8b939f; --faint: #5d6570;
  --accent: #8cc8ff; --up: #e2b35f; --down: #5fc7b0;
  --reserved: #232a33; --blocked: #191c21;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
button, select { font: inherit; color: inherit; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 20px 16px 48px; transition: margin .18s ease; }
@media (min-width: 1100px) { body.panel-open .wrap { margin-right: 440px; } }
html, body { overflow-x: hidden; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 18px; }
.brand { font-weight: 650; letter-spacing: .02em; margin-right: auto; }
.brand span { color: var(--muted); font-weight: 400; }
select, .btn { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; }
select { max-width: 220px; }
select.lang { padding: 7px 6px; font-size: 12px; color: var(--muted); }
.panel details.raw summary { cursor: pointer; }
.panel details.raw div { margin-top: 6px; }
.btn { cursor: pointer; }
.btn:hover { border-color: #3a4350; }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { border-color: #34506a; color: var(--accent); }
.monthbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.monthbar h2 { font-size: 18px; font-weight: 600; margin: 0 8px; min-width: 150px; text-align: center; }
.monthbar .stats { margin-left: auto; color: var(--muted); font-size: 13px; }
.status { color: var(--muted); font-size: 12px; margin: -8px 0 14px; min-height: 16px; }
.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.dow { color: var(--faint); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; padding: 0 6px 4px; }
.cell { position: relative; min-width: 0; overflow: hidden; min-height: 78px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
  padding: 6px 7px 10px; display: flex; flex-direction: column; text-align: left; cursor: pointer; }
.cell:hover { border-color: #3a4350; }
.cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cell.empty { background: transparent; border-color: transparent; cursor: default; }
.cell.past { opacity: .35; cursor: default; }
.cell.selected { border-color: var(--accent); }
.day { font-size: 12px; color: var(--muted); }
.price { font-size: 17px; font-weight: 600; margin-top: auto; font-variant-numeric: tabular-nums; }
.min { font-size: 11px; color: var(--faint); }
.cell.reserved { background: var(--reserved); }
.cell.blocked { background: var(--blocked);
  background-image: repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,.03) 6px 12px); }
.cell.reserved .price, .cell.blocked .price { font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell .bar { position: absolute; left: 7px; right: 7px; bottom: 4px; height: 2px; border-radius: 2px; }
.bar.up { background: var(--up); opacity: .8; }
.bar.down { background: var(--down); opacity: .8; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: 12px; margin-top: 12px; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 6px; border: 1px solid var(--line); }
.legend .l-res { background: var(--reserved); } .legend .l-blk { background: var(--blocked); }
.legend .l-up { background: var(--up); border: 0; height: 3px; } .legend .l-down { background: var(--down); border: 0; height: 3px; }
.panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100%); background: var(--surface-2);
  border-left: 1px solid var(--line); padding: 20px; overflow-y: auto; transform: translateX(100%);
  transition: transform .18s ease; box-shadow: -12px 0 32px rgba(0,0,0,.35); }
.panel.open { transform: none; }
.panel .close { float: right; }
.panel h3 { margin: 4px 0 2px; font-size: 18px; }
.panel .big { font-size: 28px; font-weight: 650; margin: 10px 0 2px; font-variant-numeric: tabular-nums; }
.panel .sub { color: var(--muted); margin-bottom: 16px; }
.steps { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.steps li { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.steps .lbl { font-weight: 500; }
.steps .val { text-align: right; font-variant-numeric: tabular-nums; }
.steps .chg { color: var(--muted); font-size: 12px; text-align: right; }
.steps .note { grid-column: 1 / -1; color: var(--muted); font-size: 12px; }
.chg.neg { color: var(--down); } .chg.pos { color: var(--up); }
.panel .raw { margin-top: 16px; color: var(--faint); font-size: 12px; }
.error { color: #f0a0a0; }
@media (max-width: 640px) {
  .wrap { padding: 14px 10px 40px; }
  header { gap: 8px; }
  .brand { width: 100%; }
  select { flex: 1; max-width: none; }
  select.lang { flex: 0 0 auto; }
  .monthbar h2 { font-size: 16px; min-width: 0; flex: 1; }
  .monthbar .stats { display: none; }
  .grid { gap: 3px; }
  .cell { min-height: 58px; padding: 4px 5px 8px; border-radius: 6px; }
  .cell .bar { left: 5px; right: 5px; bottom: 3px; }
  .price { font-size: 14px; }
  .min { font-size: 10px; }
  .cell.reserved .price, .cell.blocked .price { font-size: 9px; letter-spacing: -.01em; }
  .steps li { padding: 8px 0; }
  .panel { top: auto; width: 100%; max-height: 78vh; border-left: 0; border-top: 1px solid var(--line);
    border-radius: 14px 14px 0 0; transform: translateY(100%); }
}
`;

const SCRIPT = `
"use strict";
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const LANGS = ["it", "es", "en"];
const STORE = "fairnight.language";
const state = { data: null, listing: 0, month: null, selected: null, lang: "en" };

// ---- language: the texts come from page-texts.ts, numbers and dates from Intl
function savedLang() { try { const v = localStorage.getItem(STORE); return LANGS.includes(v) ? v : null; } catch { return null; } }
function saveLang(v) { try { localStorage.setItem(STORE, v); } catch { /* private window: only for this visit */ } }
function t(key, vars) {
  const table = TEXTS[state.lang] || TEXTS.en;
  let s = table[key] != null ? table[key] : TEXTS.en[key] != null ? TEXTS.en[key] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}
function tn(key, n, vars) {
  const form = new Intl.PluralRules(state.lang).select(n) === "one" ? "_one" : "_other";
  return t(key + form, Object.assign({ n: n }, vars || {}));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function num(n) { return new Intl.NumberFormat(state.lang, { maximumFractionDigits: 2 }).format(n); }
function money(n, currency) {
  const digits = Number.isInteger(n) ? 0 : 2;
  try { return new Intl.NumberFormat(state.lang, { style: "currency", currency: currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n); }
  catch { return num(n) + " " + currency; }
}
function utc(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d || 1)); }
function dateFmt(opts) { return new Intl.DateTimeFormat(state.lang, Object.assign({ timeZone: "UTC" }, opts)); }
function monthTitle(key) { return cap(dateFmt({ month: "long", year: "numeric" }).format(utc(key))); }
function dayTitle(iso) { return cap(dateFmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(utc(iso))); }
function shortDate(iso) { return dateFmt({ day: "numeric", month: "long", year: "numeric" }).format(utc(iso)); }
// 2026-11-02 is a Monday: the week starts on Monday.
function weekdayName(i, style) { return dateFmt({ weekday: style }).format(new Date(Date.UTC(2026, 10, 2 + i))); }
const WEEKDAY_INDEX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

function applyLang() {
  document.documentElement.lang = state.lang;
  document.title = t("page_title");
  for (const node of document.querySelectorAll("[data-t]")) node.textContent = t(node.dataset.t);
  for (const node of document.querySelectorAll("[data-t-label]")) node.setAttribute("aria-label", t(node.dataset.tLabel));
  $("#lang").value = state.lang;
}

// ---- the steps of a price, said from their facts (params), not from the engine's English
function stepText(s, currency) {
  const p = s.params || {};
  const m = (v) => money(v, currency);
  const pct = (v) => num(v);
  switch (s.factor) {
    case "base": return { label: t("step_base") };
    case "season": return { label: t("step_season", { name: p.name }), note: p.fixed ? t("note_fixed_price") : null };
    case "dayOfWeek": return { label: cap(weekdayName(WEEKDAY_INDEX[p.weekday], "long")) };
    case "lastMinute": {
      const notes = [p.daysAhead === 0 ? t("note_tonight") : tn("note_days_ahead", p.daysAhead)];
      if (p.gapNotAdded) notes.push(t("note_gap_not_added", { p: pct(p.gapNotAdded) }));
      return { label: tn("step_last_minute", p.withinDays), note: notes.join(" · ") };
    }
    case "farOut": return { label: tn("step_far_out", p.fromDays), note: tn("note_days_ahead", p.daysAhead) };
    case "gap": return { label: tn("step_gap", p.nights), note: p.lastMinuteNotAdded ? t("note_last_minute_not_added", { p: pct(p.lastMinuteNotAdded) }) : null };
    case "occupancy": return { label: t(p.kind === "busy" ? "step_busy_month" : "step_quiet_month"), note: t("note_month_booked", { p: pct(p.monthPercent) }) };
    case "scarcity": {
      const notes = [tn("rooms_free", p.free, { total: p.total }), t("note_taken", { p: pct(p.takenNow) })];
      if (p.cap != null) notes.push(t("note_capped", { p: pct(p.cap) }));
      return { label: t("step_scarcity"), note: notes.join(" · ") };
    }
    case "market": {
      const notes = [p.signal === "occupancy"
        ? t("note_market_occupancy", { value: pct(p.value), average: pct(p.average) })
        : t("note_market_price", { value: m(p.value), average: m(p.average) })];
      if (p.cap != null) notes.push(t("note_capped", { p: pct(p.cap) }));
      if (p.comparables != null) notes.push(tn("note_comparables", p.comparables));
      notes.push(String(p.attribution) + (p.estimated ? ", " + t("note_estimated") : ""));
      if (p.readOn) notes.push(t("note_read_on", { date: shortDate(p.readOn) }));
      return { label: p.area ? t("step_market_area", { area: p.area }) : t("step_market"), note: notes.join(" · ") };
    }
    case "event": return { label: t("step_event", { name: p.name, impact: p.impact }), note: p.others ? tn("note_other_events", p.others) : null };
    case "limits":
      if (p.kind === "floor") return { label: t("step_floor"), note: t("note_floor", { floor: m(p.floor) }) };
      if (p.kind === "ceiling") return { label: t("step_ceiling"), note: t("note_ceiling", { ceiling: m(p.ceiling) }) };
      return { label: t("step_limits"), note: t("note_within", { floor: m(p.floor), ceiling: m(p.ceiling) }) };
    case "staleCalendar": return { label: t("step_stale"), note: tn("note_idle", p.idleDays) };
    case "historicalFloor": return {
      label: t("step_history_floor"),
      note: t("note_history", { p: pct(p.percent), month: dateFmt({ month: "long", year: "numeric" }).format(utc(p.month)), average: m(p.average), n: p.nights }),
    };
    case "rounding": return { label: t("step_rounding", { step: m(p.step) }) };
    case "override": return { label: t("step_override"), note: s.note || null };
    default: return { label: t("step_unknown", { label: s.label }), note: s.note || null };
  }
}

function monthsOf(nights) { return [...new Set(nights.map((n) => n.date.slice(0, 7)))]; }

async function load() {
  say("status_loading");
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  state.data = await res.json();
  message = null;
  if (!savedLang() && LANGS.includes(state.data.language)) { state.lang = state.data.language; applyLang(); }
  const sel = $("#listing");
  sel.replaceChildren(...state.data.listings.map((l, i) => { const o = el("option", null, l.title); o.value = String(i); return o; }));
  fromHash();
  sel.value = String(state.listing);
  render();
}

function current() { return state.data.listings[state.listing]; }

// A message (reading, errors) stays until the next load; otherwise the line says when the calendars were read.
// It is kept as a key so a change of language says it again.
let message = null;
function setStatus(text, isError) { const s = $("#status"); s.textContent = text; s.classList.toggle("error", !!isError); }
function say(key, vars, isError) { message = { key: key, vars: vars, isError: isError }; setStatus(t(key, vars), isError); }

function render() {
  const l = current();
  const months = monthsOf(l.nights);
  if (!state.month || !months.includes(state.month)) state.month = months[0];
  const idx = months.indexOf(state.month);
  $("#prev").disabled = idx <= 0;
  $("#next").disabled = idx >= months.length - 1;
  $("#month").textContent = monthTitle(state.month);

  const nights = l.nights.filter((n) => n.date.startsWith(state.month));
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const [y, m] = state.month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first

  const grid = $("#grid");
  const cells = [0, 1, 2, 3, 4, 5, 6].map((i) => el("div", "dow", weekdayName(i, "short")));
  for (let i = 0; i < lead; i++) cells.push(el("div", "cell empty"));
  for (let d = 1; d <= daysIn; d++) {
    const iso = state.month + "-" + String(d).padStart(2, "0");
    const n = byDate.get(iso);
    const c = el(n ? "button" : "div", "cell");
    c.append(el("div", "day", num(d)));
    if (!n) { c.classList.add("past"); cells.push(c); continue; }
    c.type = "button";
    c.dataset.date = iso;
    if (n.status !== "available") {
      c.classList.add(n.status);
      c.append(el("div", "price", t(n.status === "reserved" ? "cell_reserved" : "cell_blocked")));
      c.setAttribute("aria-label", t(n.status === "reserved" ? "aria_night_reserved" : "aria_night_blocked", { date: dayTitle(iso) }));
    } else {
      c.append(el("div", "price", num(n.price)));
      c.append(el("div", "min", t("cell_min", { n: n.minStay })));
      const bar = n.price > l.basePrice ? "up" : n.price < l.basePrice ? "down" : null;
      if (bar) c.append(el("div", "bar " + bar));
      c.setAttribute("aria-label", tn("aria_night_for_sale", n.minStay, { date: dayTitle(iso), price: money(n.price, l.currency) }));
    }
    // A room type of a small hotel: how many rooms are still free that night.
    if (n.units) c.append(el("div", "min", n.units.free + "/" + n.units.total));
    if (state.selected === iso) c.classList.add("selected");
    c.addEventListener("click", () => openNight(iso));
    cells.push(c);
  }
  grid.replaceChildren(...cells);

  const forSale = nights.filter((n) => n.price != null);
  const reserved = nights.filter((n) => n.status === "reserved").length;
  const avg = forSale.length ? forSale.reduce((a, n) => a + n.price, 0) / forSale.length : null;
  $("#stats").textContent = t("stats", { forSale: forSale.length, reserved: reserved }) + (avg == null ? "" : " · " + t("stats_average", { price: money(Math.round(avg), l.currency) }));
  if (message) setStatus(t(message.key, message.vars), message.isError);
  else setStatus(l.lastSync ? t("status_read", { when: new Intl.DateTimeFormat(state.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(l.lastSync)) }) : t("status_not_read"));
}

function openNight(iso) {
  const l = current();
  const n = l.nights.find((x) => x.date === iso);
  if (!n) return;
  state.selected = iso;
  history.replaceState(null, "", "#" + encodeURIComponent(l.name) + "/" + iso);
  const p = $("#panel");
  const body = $("#panel-body");
  const parts = [el("h3", null, dayTitle(iso))];
  const rooms = n.units ? el("div", "sub", tn("rooms_free", n.units.free, { total: n.units.total })) : null;
  if (n.price == null) {
    parts.push(el("div", "big", t(n.status === "reserved" ? "big_reserved" : "big_blocked")));
    parts.push(el("div", "sub", t("not_for_sale")));
    if (rooms) parts.push(rooms);
  } else {
    parts.push(el("div", "big", money(n.price, l.currency)));
    parts.push(el("div", "sub", tn("min_stay", n.minStay, { why: t("min_" + n.minStaySource) })));
    if (rooms) parts.push(rooms);
    const list = el("ul", "steps");
    for (const s of n.steps) {
      const text = stepText(s, l.currency);
      const li = el("li");
      li.append(el("div", "lbl", text.label));
      li.append(el("div", "val", money(s.after, l.currency)));
      let change = "";
      if (s.percent != null) change = (s.percent >= 0 ? "+" : "−") + num(Math.abs(s.percent)) + "%";
      else if (s.before !== s.after) change = (s.after > s.before ? "+" : "−") + num(Math.abs(Math.round((s.after - s.before) * 100) / 100));
      const chg = el("div", "chg", change);
      if (s.after < s.before) chg.classList.add("neg"); else if (s.after > s.before) chg.classList.add("pos");
      li.append(el("div"), chg);
      if (text.note) li.append(el("div", "note", text.note));
      list.append(li);
    }
    parts.push(list);
  }
  // The engine's own sentence, in English: handy in a screenshot sent for help.
  const raw = el("details", "raw");
  raw.append(el("summary", null, t("raw_summary")), el("div", null, n.explanation));
  parts.push(raw);
  body.replaceChildren(...parts);
  p.classList.add("open");
  document.body.classList.add("panel-open");
  p.setAttribute("aria-hidden", "false");
  render();
}

function closePanel() {
  state.selected = null;
  $("#panel").classList.remove("open");
  document.body.classList.remove("panel-open");
  $("#panel").setAttribute("aria-hidden", "true");
  history.replaceState(null, "", location.pathname);
  render();
}

function fromHash() {
  const m = /^#([^/]+)\\/(\\d{4}-\\d{2}-\\d{2})$/.exec(location.hash);
  if (!m) return;
  const i = state.data.listings.findIndex((l) => l.name === decodeURIComponent(m[1]));
  if (i < 0) return;
  state.listing = i;
  state.month = m[2].slice(0, 7);
  setTimeout(() => openNight(m[2]), 0);
}

async function refresh() {
  const btn = $("#refresh");
  btn.disabled = true;
  say("status_reading");
  try {
    const res = await fetch("/api/refresh", { method: "POST", headers: { "X-Fairnight": "1" } });
    const body = await res.json();
    if (res.status === 409) throw new Error(t("error_busy"));
    if (!res.ok) throw new Error(body.error || res.statusText);
    const failed = body.reports.filter((r) => !r.ok);
    await load();
    if (failed.length) {
      say("status_not_read_list", { list: failed.map((r) => r.listing + " · " + r.feed + " (" + r.error + ")").join("; ") }, true);
    }
  } catch (e) {
    say("status_refresh_failed", { error: e.message }, true);
  } finally {
    btn.disabled = false;
  }
}

$("#lang").addEventListener("change", (e) => {
  state.lang = e.target.value;
  saveLang(state.lang);
  applyLang();
  if (!state.data) { if (message) setStatus(t(message.key, message.vars), message.isError); return; }
  if (state.selected) openNight(state.selected); else render();
});
$("#listing").addEventListener("change", (e) => { state.listing = Number(e.target.value); state.month = null; closePanel(); });
$("#prev").addEventListener("click", () => { const ms = monthsOf(current().nights); state.month = ms[Math.max(0, ms.indexOf(state.month) - 1)]; render(); });
$("#next").addEventListener("click", () => { const ms = monthsOf(current().nights); state.month = ms[Math.min(ms.length - 1, ms.indexOf(state.month) + 1)]; render(); });
$("#refresh").addEventListener("click", refresh);
$("#close").addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
  if (e.target.tagName === "SELECT") return;
  if (e.key === "ArrowLeft" && !$("#prev").disabled) $("#prev").click();
  if (e.key === "ArrowRight" && !$("#next").disabled) $("#next").click();
});
state.lang = savedLang() || "en";
applyLang();
load().catch((e) => say("status_load_failed", { error: e.message }, true));
`;

/** The texts as a script literal: "<" escaped so no text can close the script tag. */
const textsJson = () => JSON.stringify(PAGE_TEXTS).replace(/</g, "\\u003c");

export function renderPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${PAGE_TEXTS.en.page_title}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">Fairnight <span>· <span data-t="brand_sub">${PAGE_TEXTS.en.brand_sub}</span></span></div>
    <select id="lang" class="lang" data-t-label="language" aria-label="${PAGE_TEXTS.en.language}">
      <option value="it">IT</option>
      <option value="es">ES</option>
      <option value="en">EN</option>
    </select>
    <select id="listing" data-t-label="listing" aria-label="${PAGE_TEXTS.en.listing}"></select>
    <button class="btn primary" id="refresh" type="button" data-t="recalculate">${PAGE_TEXTS.en.recalculate}</button>
  </header>
  <div class="status" id="status" role="status"></div>
  <div class="monthbar">
    <button class="btn" id="prev" type="button" data-t-label="previous_month" aria-label="${PAGE_TEXTS.en.previous_month}">‹</button>
    <h2 id="month"></h2>
    <button class="btn" id="next" type="button" data-t-label="next_month" aria-label="${PAGE_TEXTS.en.next_month}">›</button>
    <div class="stats" id="stats"></div>
  </div>
  <div class="grid" id="grid"></div>
  <div class="legend">
    <span><i class="l-res"></i><span data-t="legend_reserved">${PAGE_TEXTS.en.legend_reserved}</span></span>
    <span><i class="l-blk"></i><span data-t="legend_blocked">${PAGE_TEXTS.en.legend_blocked}</span></span>
    <span><i class="l-up"></i><span data-t="legend_above">${PAGE_TEXTS.en.legend_above}</span></span>
    <span><i class="l-down"></i><span data-t="legend_below">${PAGE_TEXTS.en.legend_below}</span></span>
    <span data-t="legend_hint">${PAGE_TEXTS.en.legend_hint}</span>
  </div>
</div>
<aside class="panel" id="panel" aria-hidden="true" data-t-label="night_details" aria-label="${PAGE_TEXTS.en.night_details}">
  <button class="btn close" id="close" type="button" data-t-label="close" aria-label="${PAGE_TEXTS.en.close}">✕</button>
  <div id="panel-body"></div>
</aside>
<script nonce="${nonce}">const TEXTS = ${textsJson()};
${SCRIPT}</script>
</body>
</html>
`;
}
