/**
 * The calendar page served by `fairnight serve`: one file, no external
 * resources, no framework. Data comes from /api/data and is only ever put in
 * the page as text (textContent), never as HTML.
 *
 * In Italian, Spanish or English: the texts are in page-texts.ts, dates and
 * prices are formatted by the browser (Intl) in the chosen language.
 */
import type { Language } from "./lingua.js";
import { PAGE_TEXTS } from "./page-texts.js";

const STYLE = `
/* Dark by default ("Notte"), light when the system asks for it. Text contrast
   is at least 4.5:1 on its background in both themes. */
:root {
  color-scheme: dark;
  --bg: #0f1318; --card: #171c23; --card-2: #1c222a; --raised: #1d232c; --line: #28303a; --track: #262d37;
  --text: #eef1f4; --muted: #a3adb8; --faint: #7f8a96;
  --accent: #7cc4ff; --on-accent: #08131d;
  --up: #f2b35b; --down: #4fd1b5;
  --up-tint: rgba(242, 179, 91, .20); --up-tint-2: rgba(242, 179, 91, .05);
  --down-tint: rgba(79, 209, 181, .20); --down-tint-2: rgba(79, 209, 181, .05);
  --reserved: #2a323d; --blocked-a: #1a1f26; --blocked-b: #242b34;
  --shadow: 0 -12px 32px rgba(0, 0, 0, .45);
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --bg: #f3f5f8; --card: #ffffff; --card-2: #edf1f6; --raised: #ffffff; --line: #dde3ea; --track: #e6ebf0;
    --text: #141b22; --muted: #55606c; --faint: #6b7682;
    --accent: #1d5f99; --on-accent: #ffffff;
    --up: #a2580d; --down: #0d7462;
    --up-tint: rgba(214, 140, 40, .22); --up-tint-2: rgba(214, 140, 40, .05);
    --down-tint: rgba(28, 160, 135, .20); --down-tint-2: rgba(28, 160, 135, .04);
    --reserved: #e3e8ee; --blocked-a: #eef1f5; --blocked-b: #e1e6ec;
    --shadow: 0 -10px 28px rgba(20, 27, 34, .16);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); overflow-x: hidden; }
body { font: 15px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
button, select { font: inherit; color: inherit; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 22px 20px 48px; transition: margin .18s ease; }
@media (min-width: 1160px) { body.panel-open .wrap { margin-right: 440px; } }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
.brand { font-weight: 700; font-size: 17px; margin-right: auto; letter-spacing: .01em; }
.brand span { color: var(--muted); font-weight: 400; font-size: 14px; }
select, .btn { background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; }
select { max-width: 240px; }
select.lang { padding: 8px 10px; font-size: 13px; color: var(--muted); }
.btn { cursor: pointer; }
.btn:hover { border-color: var(--faint); }
.btn:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 700; }
.status { color: var(--muted); font-size: 13px; margin: -4px 0 14px; min-height: 18px; }
.status.error { color: #f0a0a0; }
.reminder { background: var(--card); border: 1px solid var(--line); border-left: 4px solid #e0a43a; border-radius: 10px; padding: 10px 14px; margin: -4px 0 14px; font-size: 14px; }
.reminder[hidden] { display: none; }
@media (prefers-color-scheme: light) { .status.error { color: #b42318; } }
.summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 24px; padding: 14px 18px; margin-bottom: 18px;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.summary b { display: block; font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
.summary span { color: var(--muted); font-size: 13px; }
.suggest { padding: 14px 18px; margin-bottom: 18px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.suggest h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; color: var(--muted); }
.suggest .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.suggest p { margin: 6px 0 0; font-size: 14px; }
.suggest .sub { color: var(--muted); font-size: 13px; }
.suggest .warn { color: var(--accent); }
.suggest .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.suggest code { font-size: 12px; overflow-wrap: anywhere; }
.monthbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.monthbar h2 { font-size: 22px; font-weight: 650; margin: 0 auto 0 0; }
.monthbar .btn { width: 38px; height: 38px; padding: 0; display: grid; place-items: center; }
.grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; }
.dow { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; padding: 0 6px 4px; }
.dow.we { color: var(--accent); }
.cell { position: relative; min-width: 0; overflow: hidden; min-height: 84px; background: var(--card); border: 1px solid transparent; border-radius: 10px;
  padding: 7px 9px 8px; display: flex; flex-direction: column; text-align: left; cursor: pointer; }
.cell.we { background: var(--card-2); }
.cell:hover { border-color: var(--faint); }
.cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cell.empty { background: transparent; cursor: default; }
.cell.past { opacity: .4; cursor: default; }
.cell.up { background: linear-gradient(0deg, var(--up-tint), var(--up-tint-2)); }
.cell.down { background: linear-gradient(0deg, var(--down-tint), var(--down-tint-2)); }
.cell.reserved { background: var(--reserved); }
.cell.blocked { background: repeating-linear-gradient(135deg, var(--blocked-a) 0 7px, var(--blocked-b) 7px 14px); }
.cell.today { border-color: var(--accent); }
.cell.today .day { color: var(--accent); font-weight: 700; }
.cell.selected { border-color: var(--text); }
.cell.held { box-shadow: inset 0 0 0 2px var(--up); }
.cell.confirmed { box-shadow: inset 0 0 0 2px var(--down); }
.day { font-size: 13px; color: var(--muted); }
.price { font-size: 23px; font-weight: 700; margin-top: auto; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.min { font-size: 12px; color: var(--muted); }
.mark { font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mark.held { color: var(--up); } .mark.confirmed { color: var(--down); }
.cell.reserved .price, .cell.blocked .price { font-size: 13px; font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); font-size: 13px; margin-top: 12px; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; margin-right: 6px; }
.legend .l-res { background: var(--reserved); }
.legend .l-blk { background: repeating-linear-gradient(135deg, var(--blocked-a) 0 3px, var(--faint) 3px 4px); }
.legend .l-up { background: var(--up); opacity: .7; } .legend .l-down { background: var(--down); opacity: .7; }
.legend .l-today { border: 1.5px solid var(--accent); }
.legend .l-held { box-shadow: inset 0 0 0 2px var(--up); } .legend .l-confirmed { box-shadow: inset 0 0 0 2px var(--down); }
.panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100%); background: var(--raised);
  border-left: 1px solid var(--line); padding: 22px 22px 28px; overflow-y: auto; transform: translateX(100%);
  transition: transform .18s ease, box-shadow .18s ease; box-shadow: none; }
.panel.open { transform: none; box-shadow: -12px 0 32px rgba(0, 0, 0, .3); }
.panel .close { float: right; width: 38px; height: 38px; padding: 0; }
.panel h3 { margin: 6px 0 2px; font-size: 15px; font-weight: 500; color: var(--muted); }
.panel .big { font-size: 46px; font-weight: 750; margin: 8px 0 2px; font-variant-numeric: tabular-nums; letter-spacing: -.02em; line-height: 1.1; }
.panel .sub { color: var(--muted); margin-bottom: 6px; }
.steps { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 14px; }
.steps li { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; }
.steps .lbl { font-weight: 550; }
.steps .val { text-align: right; font-weight: 650; font-variant-numeric: tabular-nums; }
.steps .track { grid-column: 1 / -1; height: 8px; border-radius: 4px; background: var(--track); position: relative; overflow: hidden; }
.steps .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--faint); }
.steps li.neg .fill { background: var(--down); } .steps li.pos .fill { background: var(--up); } .steps li.final .fill { background: var(--accent); }
.steps .chg { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.steps .chg.neg { color: var(--down); } .steps .chg.pos { color: var(--up); }
.steps .note { color: var(--muted); font-size: 13px; text-align: right; }
a.source { color: inherit; text-decoration: underline; }
.panel .raw { margin-top: 18px; color: var(--faint); font-size: 12px; }
.panel details.raw summary { cursor: pointer; }
.panel details.raw div { margin-top: 6px; }
.capbox { margin-top: 14px; padding: 12px 14px; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--up); border-radius: 10px; font-size: 14px; }
.capbox.confirmed { border-left-color: var(--down); }
.capbox b { display: block; font-weight: 650; }
.capbox p { margin: 6px 0 0; }
.capbox .muted { color: var(--muted); font-size: 13px; }
.capbox label { display: block; margin-top: 10px; color: var(--muted); font-size: 13px; }
.capbox input { display: block; margin-top: 4px; font: inherit; color: inherit; background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
.capbox .btn { margin-top: 10px; }
.pilot { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 18px 14px; margin-bottom: 18px; }
.pilot-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pilot-head b { font-weight: 650; }
.pilot-head .spacer { flex: 1; }
.chip { font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.chip.on { color: var(--down); border-color: var(--down); }
.chip.paused { color: var(--up); border-color: var(--up); }
.pilot p { margin: 8px 0 0; font-size: 14px; }
.pilot .muted { color: var(--muted); }
.pilot .warn { color: var(--up); }
.pilot details { margin-top: 8px; font-size: 14px; }
.pilot summary { cursor: pointer; }
.pilot-nights { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; max-height: 320px; overflow-y: auto; }
.pilot-nights li { display: grid; grid-template-columns: 8.5em auto 1fr; gap: 2px 12px; font-size: 13px; align-items: baseline; }
.pilot-nights .chg { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.pilot-nights .why { color: var(--muted); }
.pilot-nights .bad { color: var(--up); }
.pilot-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
@media (max-width: 600px) {
  .wrap { padding: 14px 10px 40px; }
  .pilot { padding: 10px 14px 12px; }
  .pilot-nights li { grid-template-columns: auto 1fr; }
  .pilot-nights .why { grid-column: 1 / -1; }
  header { gap: 8px; }
  .brand { width: 100%; }
  select { flex: 1; max-width: none; }
  select.lang { flex: 0 0 auto; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px 14px; }
  .summary b { font-size: 22px; }
  .monthbar h2 { font-size: 18px; }
  .grid { gap: 3px; }
  .dow { padding: 0 2px 4px; font-size: 11px; letter-spacing: .02em; text-align: center; }
  .cell { min-height: 62px; padding: 4px 5px 5px; border-radius: 8px; }
  .day { font-size: 11px; }
  .price { font-size: 16px; }
  .min { font-size: 10px; }
  .mark { font-size: 10px; line-height: 1.15; white-space: normal; }
  /* A narrow cell has no room for the word: the numbers stay, the panel says it in full. */
  .mark .word { display: none; }
  /* No room for the word on a phone: the colour says it, the legend explains it, screen readers read the label. */
  .cell.reserved .price, .cell.blocked .price { visibility: hidden; }
  .legend { font-size: 12px; gap: 6px 12px; }
  .panel { top: auto; width: 100%; max-height: 85vh; border-left: 0; border-top: 1px solid var(--line);
    border-radius: 18px 18px 0 0; transform: translateY(100%); padding: 18px 18px 26px; }
  .panel.open { box-shadow: var(--shadow); }
  .panel::before { content: ""; display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--line); margin: -6px auto 10px; }
  .panel .big { font-size: 38px; }
}
@media (prefers-reduced-motion: reduce) { .panel, .wrap { transition: none; } }
`;

const SCRIPT = `
"use strict";
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// AirROI's data is always shown with "Powered by AirROI" as a link to its site.
const AIRROI_NAME = "Powered by AirROI";
const AIRROI_URL = "https://www.airroi.com";
const withSourceLinks = (tag, cls, text) => {
  const e = el(tag, cls);
  let rest = String(text == null ? "" : text);
  for (;;) {
    const at = rest.indexOf(AIRROI_NAME);
    if (at < 0) { e.append(rest); return e; }
    e.append(rest.slice(0, at));
    rest = rest.slice(at + AIRROI_NAME.length);
    const spelled = " (" + AIRROI_URL + ")";
    if (rest.startsWith(spelled)) rest = rest.slice(spelled.length);
    const a = el("a", "source", AIRROI_NAME);
    a.href = AIRROI_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    e.append(a);
  }
};
const LANGS = ["it", "es", "en"];
const STORE = "fairnight.language";
const state = { data: null, listing: 0, month: null, selected: null, lang: "en", pilot: null, preview: null };

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
  const cells = [0, 1, 2, 3, 4, 5, 6].map((i) => el("div", i >= 5 ? "dow we" : "dow", weekdayName(i, "short")));
  for (let i = 0; i < lead; i++) cells.push(el("div", "cell empty"));
  for (let d = 1; d <= daysIn; d++) {
    const iso = state.month + "-" + String(d).padStart(2, "0");
    const n = byDate.get(iso);
    const c = el(n ? "button" : "div", "cell");
    if ((lead + d - 1) % 7 >= 5) c.classList.add("we");
    if (iso === state.data.today) c.classList.add("today");
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
      // Above or below the base price: the cell is tinted warm or cool.
      if (n.price > l.basePrice) c.classList.add("up");
      else if (n.price < l.basePrice) c.classList.add("down");
      c.setAttribute("aria-label", tn("aria_night_for_sale", n.minStay, { date: dayTitle(iso), price: money(n.price, l.currency) }));
    }
    if (n.held) {
      c.classList.add("held");
      const mark = el("div", "mark held");
      mark.append(el("span", "word", t("cell_channel") + " "), num(n.held.sent) + " (" + (n.held.difference > 0 ? "+" : "−") + num(Math.abs(n.held.difference)) + ")");
      c.append(mark);
    }
    if (n.confirmation) {
      c.classList.add("confirmed");
      const mark = el("div", "mark confirmed", "✓ ");
      mark.append(el("span", "word", t("cell_confirmed")));
      c.append(mark);
    }
    if (n.held || n.confirmation) c.setAttribute("aria-label", c.getAttribute("aria-label") + ". " + nightMarkText(n, l));
    // A room type of a small hotel: how many rooms are still free that night.
    if (n.units) c.append(el("div", "min", n.units.free + "/" + n.units.total));
    if (state.selected === iso) c.classList.add("selected");
    c.addEventListener("click", () => openNight(iso));
    cells.push(c);
  }
  grid.replaceChildren(...cells);

  // The month at a glance, from today on: blocked nights are neither for sale nor booked.
  const forSale = nights.filter((n) => n.price != null);
  const reserved = nights.filter((n) => n.status === "reserved").length;
  const avg = forSale.length ? forSale.reduce((a, n) => a + n.price, 0) / forSale.length : null;
  const sellable = forSale.length + reserved;
  $("#sum-for-sale").textContent = num(forSale.length);
  $("#sum-reserved").textContent = num(reserved);
  $("#sum-average").textContent = avg == null ? "—" : money(Math.round(avg), l.currency);
  $("#sum-occupancy").textContent = sellable === 0 ? "—" : new Intl.NumberFormat(state.lang, { style: "percent" }).format(reserved / sellable);
  renderGuests();
  renderPilot();
  renderSuggestion(l);
  if (message) setStatus(t(message.key, message.vars), message.isError);
  else setStatus(l.lastSync ? t("status_read", { when: new Intl.DateTimeFormat(state.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(l.lastSync)) }) : t("status_not_read"));
}

// Guest communications late or due within 24 hours: how many, and the command to run.
function renderGuests() {
  const g = state.data.guests;
  const box = $("#guests");
  if (!g) { box.hidden = true; return; }
  const parts = [];
  if (g.late) parts.push(tn("guests_late", g.late));
  if (g.soon) parts.push(tn("guests_soon", g.soon));
  parts.push(t(g.italy ? "guests_hint_italy" : "guests_hint"));
  box.textContent = parts.join(" ");
  box.hidden = false;

}

// ---- suggested base price: facts from the server, sentences written here
function homesText(sg) {
  const h = sg.homes || {};
  const parts = [];
  if (h.bedrooms != null) parts.push(tn("homes_bedrooms", h.bedrooms));
  if (h.guests != null) parts.push(tn("homes_guests", h.guests));
  else if (h.guestsFrom != null) parts.push(h.guestsTo != null ? t("homes_guests_range", { from: num(h.guestsFrom), to: num(h.guestsTo) }) : t("homes_guests_from", { from: num(h.guestsFrom) }));
  if (h.roomType) parts.push(h.roomType);
  if (h.neighbourhood) parts.push(h.neighbourhood);
  const who = sg.comparables != null ? tn("homes_count", sg.comparables) : t("homes_some");
  return who + " " + (parts.length ? t("homes_with", { list: parts.join(", ") }) : t("homes_whole_zone"));
}
function zoneGuestsText(h) {
  if (h && h.guests != null) return tn("homes_guests", h.guests);
  if (h && h.guestsFrom != null) return h.guestsTo != null ? t("homes_guests_range", { from: num(h.guestsFrom), to: num(h.guestsTo) }) : t("homes_guests_from", { from: num(h.guestsFrom) });
  return "";
}
function warningText(w, sg, currency) {
  switch (w.kind) {
    case "whole-zone": return t("suggest_warn_whole_zone");
    case "guests-differ": return t("suggest_warn_guests_differ", { zone: zoneGuestsText(sg.homes), listing: num(w.listing) });
    case "guests-unknown": return t("suggest_warn_guests_unknown", { listing: num(w.listing) });
    case "below-floor": return t("suggest_warn_below_floor", { floor: money(w.floor, currency) });
    case "above-ceiling": return t("suggest_warn_above_ceiling", { ceiling: money(w.ceiling, currency) });
    default: return "";
  }
}
let confirming = false;
function renderSuggestion(l) {
  const box = $("#suggest");
  const sg = l.suggestion;
  if (!sg) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const m = (n) => money(n, l.currency);
  const parts = [el("h3", null, t("suggest_title")), el("div", "big", m(sg.suggested))];
  const monthName = (k) => dateFmt({ month: "long", year: "numeric" }).format(utc(k));
  parts.push(el("p", null, t("suggest_why", { homes: homesText(sg), area: sg.area || "", from: monthName(sg.from), to: monthName(sg.to), n: num(sg.months), low: m(sg.low), high: m(sg.high) })));
  const diff = sg.differencePercent === 0 ? t("suggest_same") : (sg.differencePercent > 0 ? "+" : "") + num(sg.differencePercent) + "%";
  parts.push(el("p", null, t("suggest_current", { current: m(sg.current), diff: diff })));
  if (sg.farOff) parts.push(el("p", "warn", t("suggest_far_off")));
  for (const w of sg.warnings) { const text = warningText(w, sg, l.currency); if (text) parts.push(el("p", "warn", text)); }
  const source = [sg.attribution + (sg.estimated ? ", " + t("note_estimated") : "")];
  if (sg.readOn) source.push(t("note_read_on", { date: shortDate(sg.readOn) }));
  parts.push(withSourceLinks("p", "sub", t("suggest_source", { source: source.join(" · ") }) + ". " + t("suggest_nothing_changes")));
  if (sg.suggested !== sg.current) {
    const actions = el("div", "actions");
    if (!state.data.local) {
      const c = el("code", null, "fairnight mercato prezzo-base --listing " + l.name + " --applica");
      const line = el("p", "sub", t("suggest_remote", { command: "" }));
      line.append(c);
      actions.append(line);
    } else if (!confirming) {
      const use = el("button", "btn", t("suggest_use"));
      use.type = "button";
      use.addEventListener("click", () => { confirming = true; renderSuggestion(l); });
      actions.append(use);
    } else {
      actions.append(el("span", null, t("suggest_confirm", { listing: l.title, price: m(sg.suggested) })));
      const yes = el("button", "btn primary", t("suggest_yes"));
      yes.type = "button";
      yes.addEventListener("click", () => useSuggestion(l, sg, yes));
      const no = el("button", "btn", t("suggest_cancel"));
      no.type = "button";
      no.addEventListener("click", () => { confirming = false; renderSuggestion(l); });
      actions.append(yes, no);
    }
    parts.push(actions);
  }
  box.replaceChildren(...parts);
}
async function useSuggestion(l, sg, btn) {
  btn.disabled = true;
  try {
    const res = await fetch("/api/base-price", { method: "POST", headers: { "X-Fairnight": "1", "Content-Type": "application/json" }, body: JSON.stringify({ listing: l.name, price: sg.suggested }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    confirming = false;
    await load();
    say("suggest_done", { before: money(body.before, l.currency), after: money(body.basePrice, l.currency) });
  } catch (e) {
    confirming = false;
    say("suggest_failed", { error: e.message }, true);
    renderSuggestion(l);
  }
}

// ---- the daily cap: the mark of a night held back, and the host's confirmation
function nightMarkText(n, l) {
  const parts = [];
  if (n.held) parts.push(t("held_line", { sent: money(n.held.sent, l.currency), calculated: money(n.held.calculated, l.currency) }));
  if (n.confirmation) parts.push(t("confirmed_line", { by: n.confirmation.by, when: when(n.confirmation.at), price: money(n.confirmation.price, l.currency) }));
  return parts.join(". ");
}
function capBox(n, l) {
  if (!n.held && !n.confirmation) return null;
  const m = (v) => money(v, l.currency);
  const box = el("div", n.confirmation ? "capbox confirmed" : "capbox");
  if (n.held) {
    box.append(el("b", null, t("held_line", { sent: m(n.held.sent), calculated: m(n.held.calculated) })));
    box.append(el("p", null, t("held_detail", { calculated: m(n.held.calculated), sent: m(n.held.sent), difference: m(Math.abs(n.held.difference)), p: num(n.held.maxChange) })));
    box.append(el("p", "muted", t("held_run", { when: when(n.held.at) })));
  }
  if (n.confirmation) {
    box.append(el("p", null, t("confirmed_line", { by: n.confirmation.by, when: when(n.confirmation.at), price: m(n.confirmation.price) })));
    if (n.held && n.confirmation.exceeded) {
      const seen = { confirmed: m(n.confirmation.price), calculated: m(n.held.calculated) };
      box.append(el("b", null, t("confirmed_exceeded", seen)), el("p", null, t("confirmed_exceeded_detail", seen)));
    } else if (n.held) {
      box.append(el("p", null, t("confirmed_pending", { calculated: m(n.held.calculated) })));
    }
    box.append(el("p", "muted", t("confirmed_expires")));
  }
  if (!state.data.local) { box.append(el("p", "muted", t("confirm_local_only"))); return box; }
  if (n.confirmation) {
    if (n.held && n.confirmation.exceeded) box.append(capButton("confirm_again", () => capPost("confirm", { from: n.date }), { calculated: m(n.held.calculated) }));
    box.append(capButton("confirm_remove", () => capPost("unconfirm", { from: n.date })));
    return box;
  }
  box.append(el("p", "muted", t("confirm_explain", { calculated: m(n.held.calculated) })));
  const label = el("label", null, t("confirm_until"));
  const until = el("input");
  until.type = "date";
  until.min = n.date;
  label.append(until);
  box.append(label, capButton("confirm_button", () => capPost("confirm", { from: n.date, to: until.value || n.date }), { calculated: m(n.held.calculated) }));
  return box;
}
function capButton(key, action, vars) {
  const b = el("button", "btn", t(key, vars));
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}
async function capPost(action, extra) {
  try {
    await pilotRequest("/api/pilot/" + action, Object.assign({ listing: current().name }, extra));
    const iso = state.selected;
    await load();
    await loadPilot();
    if (iso) openNight(iso);
  } catch (e) {
    say("confirm_failed", { error: e.message }, true);
  }
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
    const capNote = capBox(n, l);
    if (capNote) parts.push(capNote);
    // A small ladder from the base price to the final one: one bar per step, as long as its price.
    const list = el("ul", "steps");
    const top = Math.max(...n.steps.map((s) => Math.max(s.before, s.after))) * 1.08;
    n.steps.forEach((s, i) => {
      const text = stepText(s, l.currency);
      const li = el("li", i === n.steps.length - 1 ? "final" : s.after < s.before ? "neg" : s.after > s.before ? "pos" : null);
      li.append(el("div", "lbl", text.label));
      li.append(el("div", "val", money(s.after, l.currency)));
      const track = el("div", "track");
      const fill = el("div", "fill");
      fill.style.width = Math.max(2, Math.min(100, (s.after / top) * 100)).toFixed(1) + "%";
      track.append(fill);
      li.append(track);
      let change = "";
      if (s.percent != null) change = (s.percent >= 0 ? "+" : "−") + num(Math.abs(s.percent)) + "%";
      else if (s.before !== s.after) change = (s.after > s.before ? "+" : "−") + num(Math.abs(Math.round((s.after - s.before) * 100) / 100));
      const chg = el("div", "chg", change);
      if (s.after < s.before) chg.classList.add("neg"); else if (s.after > s.before) chg.classList.add("pos");
      li.append(chg, withSourceLinks("div", "note", text.note || ""));
      list.append(li);
    });
    parts.push(list);
  }
  // The engine's own sentence, in English: handy in a screenshot sent for help.
  const raw = el("details", "raw");
  raw.append(el("summary", null, t("raw_summary")), withSourceLinks("div", null, n.explanation));
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
    await loadPilot();
    if (failed.length) {
      say("status_not_read_list", { list: failed.map((r) => r.listing + " · " + r.feed + " (" + r.error + ")").join("; ") }, true);
    }
  } catch (e) {
    say("status_refresh_failed", { error: e.message }, true);
  } finally {
    btn.disabled = false;
  }
}

// ---- the autopilot: on, off or paused for this listing, the last run and why each night changed
async function loadPilot() {
  try {
    const res = await fetch("/api/pilot");
    state.pilot = res.ok ? await res.json() : null;
  } catch { state.pilot = null; }
  renderPilot();
}

function pilotOf(l) { return state.pilot ? state.pilot.listings.find((x) => x.name === l.name) : null; }
function when(iso) { return new Intl.DateTimeFormat(state.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); }
function nightDate(iso) { return cap(dateFmt({ weekday: "short", day: "numeric", month: "short" }).format(utc(iso))); }

// Why a night changed: the steps of the engine that moved its price, said like on the night panel.
function reasons(steps, currency) {
  return steps.filter((x) => x.factor !== "base" && x.factor !== "rounding" && x.before !== x.after).map((x) => {
    const label = stepText(x, currency).label;
    return x.percent != null ? label + " " + (x.percent >= 0 ? "+" : "−") + num(Math.abs(x.percent)) + "%" : label;
  }).join(" · ") || t("step_base");
}

function nightList(nights, s, l) {
  const list = el("ul", "pilot-nights");
  for (const n of nights) {
    const li = el("li");
    li.append(el("span", null, nightDate(n.date)));
    li.append(el("span", "chg", (n.oldPrice == null ? "—" : money(n.oldPrice, l.currency)) + " → " + money(n.newPrice, l.currency)));
    let why = reasons(n.steps, l.currency);
    if (n.confirmedBy) why += " · " + t("pilot_confirmed_night", { by: n.confirmedBy });
    if (n.limited === "cap") why += " · " + t("pilot_held_cap", { p: num(s.maxChange), target: money(n.target, l.currency) });
    if (n.limited === "floor") why += " · " + t("pilot_held_floor");
    if (n.limited === "ceiling") why += " · " + t("pilot_held_ceiling");
    li.append(el("span", "why", why));
    if (n.verified === false) li.append(el("span", "bad", t("pilot_mismatch_night", { channel: s.channel })));
    list.append(li);
  }
  return list;
}

function lastRunView(s, l) {
  const r = s.last;
  if (!r) return null;
  const vars = { when: when(r.at), channel: s.channel };
  let text;
  if (r.status === "written") text = tn("pilot_last", r.nights, vars) + " · " + (r.wrong > 0 ? tn("pilot_mismatch", r.wrong, vars) : t("pilot_checked"));
  else if (r.status === "nothing") text = t("pilot_last_none", vars);
  else if (r.status === "not-read") text = t("pilot_not_read", vars);
  else if (r.status === "error") text = t("pilot_error", Object.assign({ error: r.error || "" }, vars));
  else return null;
  if (!s.changes.length) return el("p", null, text);
  const box = el("details");
  box.append(el("summary", null, text), nightList(s.changes, s, l));
  return box;
}

function pilotButton(label, primary, action) {
  const b = el("button", primary ? "btn primary" : "btn", t(label));
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}

function renderPilot() {
  const box = $("#pilot");
  const l = state.data ? current() : null;
  const s = l ? pilotOf(l) : null;
  if (!s) { box.hidden = true; return; }
  box.hidden = false;
  const chip = $("#pilot-state");
  const parts = [];
  const actions = el("div", "pilot-actions");
  const m = (v) => money(v, l.currency);
  if (!s.channel) {
    chip.textContent = t("pilot_off");
    chip.className = "chip";
    $("#pilot-body").replaceChildren(el("p", "muted", t("pilot_no_channel")));
    return;
  }
  const st = s.paused ? "paused" : s.enabled ? "on" : "off";
  chip.textContent = t("pilot_" + st);
  chip.className = "chip " + st;
  const preview = state.preview && state.preview.listing === s.name ? state.preview : null;
  if (s.paused) parts.push(el("p", "warn", t("pilot_paused_reason", { reason: s.paused.reason || "" })));
  if (s.floor == null) parts.push(el("p", "muted", t("pilot_no_limits")));
  else parts.push(el("p", "muted", t("pilot_explain", { days: num(s.days), channel: s.channel, p: num(s.maxChange), floor: m(s.floor), ceiling: m(s.ceiling) })));
  if (preview) {
    if (preview.loading) parts.push(el("p", null, t("pilot_preparing", { channel: s.channel })));
    else {
      parts.push(el("p", null, preview.nights.length ? tn("pilot_preview", preview.nights.length, { channel: s.channel }) : t("pilot_preview_none", { channel: s.channel })));
      if (preview.nights.length) parts.push(nightList(preview.nights, s, l));
      actions.append(pilotButton("pilot_confirm", true, () => pilotPost("on", { token: preview.token })), pilotButton("pilot_cancel", false, () => { state.preview = null; renderPilot(); }));
    }
  } else {
    if (s.enabled && state.pilot.stale) parts.push(el("p", "warn", state.pilot.hoursSinceRun == null ? t("pilot_never") : t("pilot_stale", { h: num(state.pilot.hoursSinceRun) })));
    const last = lastRunView(s, l);
    if (last) parts.push(last);
    if (state.pilot.control) {
      if (s.paused) actions.append(pilotButton("pilot_resume", true, () => pilotPost("resume", {})));
      if (s.enabled) actions.append(pilotButton("pilot_turn_off", false, () => pilotPost("off", {})));
      else if (s.floor != null) actions.append(pilotButton("pilot_turn_on", false, pilotPreview));
    } else parts.push(el("p", "muted", t("pilot_local_only")));
  }
  if (actions.childElementCount) parts.push(actions);
  $("#pilot-body").replaceChildren(...parts);
}

function pilotError(code) {
  if (code === "no-limits") return t("pilot_no_limits");
  if (code === "no-channel") return t("pilot_no_channel");
  if (code === "busy") return t("error_busy");
  if (code.startsWith("confirm_err_")) return t(code);
  return code;
}

async function pilotRequest(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "X-Fairnight": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(pilotError(data.error || res.statusText));
  return data;
}

async function pilotPreview() {
  const listing = current().name;
  state.preview = { listing: listing, loading: true };
  renderPilot();
  try {
    const r = await pilotRequest("/api/pilot/preview", { listing: listing });
    state.preview = Object.assign({ listing: listing }, r);
  } catch (e) {
    state.preview = null;
    say("pilot_preview_failed", { error: e.message }, true);
  }
  renderPilot();
}

async function pilotPost(action, extra) {
  try {
    await pilotRequest("/api/pilot/" + action, Object.assign({ listing: current().name }, extra));
    state.preview = null;
  } catch (e) {
    say("pilot_failed", { error: e.message }, true);
  }
  await loadPilot();
}

$("#lang").addEventListener("change", (e) => {
  state.lang = e.target.value;
  saveLang(state.lang);
  applyLang();
  if (!state.data) { if (message) setStatus(t(message.key, message.vars), message.isError); return; }
  if (state.selected) openNight(state.selected); else render();
});
$("#listing").addEventListener("change", (e) => { state.listing = Number(e.target.value); state.month = null; state.preview = null; confirming = false; closePanel(); });
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
state.lang = savedLang() || START_LANG;
applyLang();
load().then(loadPilot).catch((e) => say("status_load_failed", { error: e.message }, true));
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** The texts as a script literal: "<" escaped so no text can close the script tag. */
const textsJson = () => JSON.stringify(PAGE_TEXTS).replace(/</g, "\\u003c");

/**
 * The page already in the folder's language (the config's `language`), so the tab
 * title and the first texts are right before the script runs; a language saved in
 * the browser still wins once the script starts.
 */
export function renderPage(nonce: string, lang: Language = "en"): string {
  const T = PAGE_TEXTS[lang];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${esc(T.page_title)}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">Fairnight <span>· <span data-t="brand_sub">${esc(T.brand_sub)}</span></span></div>
    <select id="lang" class="lang" data-t-label="language" aria-label="${esc(T.language)}">
      <option value="it">IT</option>
      <option value="es">ES</option>
      <option value="en">EN</option>
    </select>
    <select id="listing" data-t-label="listing" aria-label="${esc(T.listing)}"></select>
    <button class="btn primary" id="refresh" type="button" data-t="recalculate">${esc(T.recalculate)}</button>
  </header>
  <div class="status" id="status" role="status"></div>
  <div class="reminder" id="guests" role="status" hidden></div>
  <section class="pilot" id="pilot" hidden aria-live="polite">
    <div class="pilot-head"><b data-t="pilot_title">${esc(T.pilot_title)}</b><span class="chip" id="pilot-state"></span><span class="spacer"></span></div>
    <div id="pilot-body"></div>
  </section>
  <section class="summary" aria-live="polite">
    <div><b id="sum-for-sale">—</b><span data-t="summary_for_sale">${esc(T.summary_for_sale)}</span></div>
    <div><b id="sum-reserved">—</b><span data-t="summary_reserved">${esc(T.summary_reserved)}</span></div>
    <div><b id="sum-average">—</b><span data-t="summary_average">${esc(T.summary_average)}</span></div>
    <div><b id="sum-occupancy">—</b><span data-t="summary_occupancy">${esc(T.summary_occupancy)}</span></div>
  </section>
  <section class="suggest" id="suggest" hidden aria-live="polite"></section>
  <div class="monthbar">
    <button class="btn" id="prev" type="button" data-t-label="previous_month" aria-label="${esc(T.previous_month)}">‹</button>
    <h2 id="month"></h2>
    <button class="btn" id="next" type="button" data-t-label="next_month" aria-label="${esc(T.next_month)}">›</button>
  </div>
  <div class="grid" id="grid"></div>
  <div class="legend">
    <span><i class="l-res"></i><span data-t="legend_reserved">${esc(T.legend_reserved)}</span></span>
    <span><i class="l-blk"></i><span data-t="legend_blocked">${esc(T.legend_blocked)}</span></span>
    <span><i class="l-up"></i><span data-t="legend_above">${esc(T.legend_above)}</span></span>
    <span><i class="l-down"></i><span data-t="legend_below">${esc(T.legend_below)}</span></span>
    <span><i class="l-today"></i><span data-t="legend_today">${esc(T.legend_today)}</span></span>
    <span><i class="l-held"></i><span data-t="legend_held">${esc(T.legend_held)}</span></span>
    <span><i class="l-confirmed"></i><span data-t="legend_confirmed">${esc(T.legend_confirmed)}</span></span>
    <span data-t="legend_hint">${esc(T.legend_hint)}</span>
  </div>
</div>
<aside class="panel" id="panel" aria-hidden="true" data-t-label="night_details" aria-label="${esc(T.night_details)}">
  <button class="btn close" id="close" type="button" data-t-label="close" aria-label="${esc(T.close)}">✕</button>
  <div id="panel-body"></div>
</aside>
<script nonce="${nonce}">const TEXTS = ${textsJson()};
const START_LANG = ${JSON.stringify(lang)};
${SCRIPT}</script>
</body>
</html>
`;
}
