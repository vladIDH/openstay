/**
 * The calendar page served by `fairnight serve`: one file, no external
 * resources, no framework. Data comes from /api/data and is only ever put in
 * the page as text (textContent), never as HTML.
 */

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
const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2);
const state = { data: null, listing: 0, month: null, selected: null };

function monthsOf(nights) { return [...new Set(nights.map((n) => n.date.slice(0, 7)))]; }
function monthTitle(key) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
function dayTitle(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

async function load() {
  setStatus("Loading prices…");
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  state.data = await res.json();
  const sel = $("#listing");
  sel.replaceChildren(...state.data.listings.map((l, i) => { const o = el("option", null, l.title); o.value = String(i); return o; }));
  fromHash();
  sel.value = String(state.listing);
  render();
}

function current() { return state.data.listings[state.listing]; }

function setStatus(text, isError) { const s = $("#status"); s.textContent = text; s.classList.toggle("error", !!isError); }

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
  const cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => el("div", "dow", d));
  for (let i = 0; i < lead; i++) cells.push(el("div", "cell empty"));
  for (let d = 1; d <= daysIn; d++) {
    const iso = state.month + "-" + String(d).padStart(2, "0");
    const n = byDate.get(iso);
    const c = el(n ? "button" : "div", "cell");
    c.append(el("div", "day", String(d)));
    if (!n) { c.classList.add("past"); cells.push(c); continue; }
    c.type = "button";
    c.dataset.date = iso;
    if (n.status !== "available") {
      c.classList.add(n.status);
      c.append(el("div", "price", n.status));
    } else {
      c.append(el("div", "price", fmt(n.price)));
      c.append(el("div", "min", "min " + n.minStay));
      const bar = n.price > l.basePrice ? "up" : n.price < l.basePrice ? "down" : null;
      if (bar) c.append(el("div", "bar " + bar));
    }
    // A room type of a small hotel: how many rooms are still free that night.
    if (n.units) c.append(el("div", "min", n.units.free + "/" + n.units.total));
    if (state.selected === iso) c.classList.add("selected");
    c.setAttribute("aria-label", iso + (n.price == null ? ", " + n.status : ", " + fmt(n.price) + " " + l.currency + ", minimum " + n.minStay + " nights"));
    c.addEventListener("click", () => openNight(iso));
    cells.push(c);
  }
  grid.replaceChildren(...cells);

  const forSale = nights.filter((n) => n.price != null);
  const reserved = nights.filter((n) => n.status === "reserved").length;
  const avg = forSale.length ? forSale.reduce((a, n) => a + n.price, 0) / forSale.length : null;
  $("#stats").textContent = forSale.length + " for sale · " + reserved + " reserved" + (avg == null ? "" : " · average " + fmt(Math.round(avg)) + " " + l.currency);
  setStatus(l.lastSync ? "Calendars read " + new Date(l.lastSync).toLocaleString() : "Calendars not read yet: press Recalculate.");
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
  const rooms = n.units ? el("div", "sub", n.units.free + (n.units.free === 1 ? " camera libera" : " camere libere") + " su " + n.units.total) : null;
  if (n.price == null) {
    parts.push(el("div", "big", n.status === "reserved" ? "Reserved" : "Blocked"));
    parts.push(el("div", "sub", "Not for sale: no price."));
    if (rooms) parts.push(rooms);
  } else {
    parts.push(el("div", "big", fmt(n.price) + " " + l.currency));
    const rule = { override: "date override", farOut: "far out", lastMinute: "last minute", default: "default", gap: "lowered to fill the gap" }[n.minStaySource];
    parts.push(el("div", "sub", "Minimum stay " + n.minStay + " night" + (n.minStay === 1 ? "" : "s") + " (" + rule + ")"));
    if (rooms) parts.push(rooms);
    const list = el("ul", "steps");
    for (const s of n.steps) {
      const li = el("li");
      li.append(el("div", "lbl", s.factor === "base" ? "Base price" : s.label));
      li.append(el("div", "val", fmt(s.after)));
      let change = "";
      if (s.percent != null) change = (s.percent >= 0 ? "+" : "") + fmt(s.percent) + "%";
      else if (s.before !== s.after) change = (s.after > s.before ? "+" : "−") + fmt(Math.abs(Math.round((s.after - s.before) * 100) / 100));
      const chg = el("div", "chg", change);
      if (s.after < s.before) chg.classList.add("neg"); else if (s.after > s.before) chg.classList.add("pos");
      li.append(el("div"), chg);
      if (s.note) li.append(el("div", "note", s.note));
      list.append(li);
    }
    parts.push(list);
  }
  parts.push(el("div", "raw", n.explanation));
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
  setStatus("Reading the calendars…");
  try {
    const res = await fetch("/api/refresh", { method: "POST", headers: { "X-Fairnight": "1" } });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    const failed = body.reports.filter((r) => !r.ok);
    await load();
    if (failed.length) setStatus("Not read: " + failed.map((r) => r.listing + " · " + r.feed + " (" + r.error + ")").join("; "), true);
  } catch (e) {
    setStatus("Recalculate failed: " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

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
load().catch((e) => setStatus("Could not load the prices: " + e.message, true));
`;

export function renderPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Fairnight calendar</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">Fairnight <span>· nightly prices</span></div>
    <select id="listing" aria-label="Listing"></select>
    <button class="btn primary" id="refresh" type="button">Recalculate</button>
  </header>
  <div class="status" id="status" role="status"></div>
  <div class="monthbar">
    <button class="btn" id="prev" type="button" aria-label="Previous month">‹</button>
    <h2 id="month"></h2>
    <button class="btn" id="next" type="button" aria-label="Next month">›</button>
    <div class="stats" id="stats"></div>
  </div>
  <div class="grid" id="grid"></div>
  <div class="legend">
    <span><i class="l-res"></i>reserved</span>
    <span><i class="l-blk"></i>blocked</span>
    <span><i class="l-up"></i>above base price</span>
    <span><i class="l-down"></i>below base price</span>
    <span>click a night to see why</span>
  </div>
</div>
<aside class="panel" id="panel" aria-hidden="true" aria-label="Night details">
  <button class="btn close" id="close" type="button" aria-label="Close">✕</button>
  <div id="panel-body"></div>
</aside>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>
`;
}
