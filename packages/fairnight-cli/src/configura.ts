/**
 * `fairnight configura`: the guided setup, in Italian or Spanish (see
 * configura-testi.ts), for hosts who never
 * open fairnight.config.json. It asks for the name of each house, its town,
 * its Airbnb, Booking and Vrbo iCal links (reading each one to check it),
 * the base, lowest and highest price and the seasons, then writes the config.
 *
 * - Run again, it shows the current values as defaults: that is how the host
 *   changes them later. Rules it does not ask about are kept as they are.
 * - Seasons are proposed from the town and shown with their dates; nothing is
 *   applied unless the host confirms it.
 * - The previous config is kept as fairnight.config.json.bak.
 * - Houses linked to Smoobu or Beds24 get the autopilot question (off unless
 *   the host says yes); a house turned on now shows its preview and is kept on
 *   only when the host confirms it. Then the computer's daily run is set up,
 *   or removed when no house has it on any more.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConfigError, formatAmount, type ListingConfig, type SeasonPeriod } from "fairnight";
import { ISTAT_REGIONS } from "fairguest";
import { slugify } from "./channel.js";
import { PILOT_DAYS, PILOT_MAX_CHANGE, PILOT_TIME, SetupError, normaliseCalendarUrl, validateHostConfig, type HostConfig, type IcalSource } from "./config.js";
import { openDb } from "./db.js";
import { classify, parseIcal } from "./ical.js";
import { initFolder } from "./init.js";
import { configPath, dbPath, localToday, stripBom, type Io } from "./io.js";
import { installSchedule, isScheduled, removeSchedule } from "./pianifica.js";
import { writeListingPilot } from "./pilota-comandi.js";
import { DEFAULT_MAX_CHANGE, DEFAULT_PILOT_TIME, runPilot } from "./pilota.js";
import { describeSeason, multiplierOf, parseDayMonth, percentOf, proposedSeasons, regionOf, typedDayMonth } from "./stagioni.js";
import { isLanguage, languageProposal, setupLanguage, systemLocale, type Language } from "./lingua.js";
import { SETUP_TEXTS, type SetupTexts } from "./configura-testi.js";
import { download } from "./sync.js";
import { syncEverything } from "./sync-all.js";
import { HOST_README, LOCAL_README } from "./template.js";
import type { FeedReport } from "./sync.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The platforms the setup asks about; where to find each link is in the texts (`where`). */
export const PLATFORMS: { source: IcalSource; label: string; looksLike: RegExp }[] = [
  {
    source: "airbnb",
    label: "Airbnb",
    looksLike: /airbnb\./,
  },
  {
    source: "booking",
    label: "Booking",
    looksLike: /booking\.com/,
  },
  {
    source: "vrbo",
    label: "Vrbo",
    looksLike: /vrbo\.|homeaway\.|abritel\.|fewo-direkt\./,
  },
];

/** Price rules for a new house: the ones the setup asks about, plus sensible defaults the host can change in the file. */
export function newListingPricing(name: string, title: string, base: number, floor: number, ceiling: number, seasons: SeasonPeriod[] | null): Obj {
  return {
    listingId: name,
    name: title,
    currency: "EUR",
    basePrice: base,
    defaultMinStay: 2,
    factors: {
      limits: { enabled: true, floorPrice: floor, ceilingPrice: ceiling },
      seasons: { enabled: seasons !== null && seasons.length > 0, periods: seasons ?? [] },
      dayOfWeek: { enabled: true, adjustments: { fri: 10, sat: 15, sun: -5 } },
      lastMinute: {
        enabled: true,
        steps: [
          { withinDays: 3, discountPercent: 15, minStay: 1 },
          { withinDays: 7, discountPercent: 8, minStay: 2 },
        ],
      },
      farOut: { enabled: true, steps: [{ fromDays: 180, premiumPercent: 8, minStay: 3 }] },
      gaps: { enabled: true, maxNights: 2, discountPercent: 12, lowerMinStay: true },
      occupancy: { enabled: true, highThresholdPercent: 75, raisePercent: 8, lowThresholdPercent: 25, lowerPercent: 6, withinDays: 60 },
      events: { enabled: true, list: [] },
      rounding: { enabled: true, step: 1 },
      overrides: { enabled: true, dates: [] },
    },
  };
}

/** "120", "120,50", "€ 120" or "120 euro" → 120 / 120.5; null when it is not a price. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/€|eur(o)?/gi, "").replace(/\s/g, "");
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned.replace(",", "."));
  return n > 0 ? n : null;
}

const euro = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")} €`;

class Asker {
  constructor(
    private readonly io: Io,
    private readonly ask: NonNullable<Io["prompt"]>,
    readonly w: SetupTexts,
  ) {}

  /** Too many wrong answers in a row (or no more input): stop instead of asking forever. */
  private static readonly TRIES = 5;

  async text(question: string, current?: string): Promise<string> {
    const shown = current !== undefined && current !== "" ? ` [${current}]` : "";
    const answer = (await this.ask(`${question}${shown}: `, { hidden: false })).trim();
    return answer === "" ? (current ?? "") : answer;
  }

  async amount(question: string, current: number): Promise<number> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = await this.text(question, String(current).replace(".", ","));
      const n = parseAmount(raw);
      if (n !== null) return n;
      this.io.out(this.w.notAPrice(raw));
    }
    throw new SetupError(this.w.tooMany);
  }

  async percent(question: string, current: number): Promise<number> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.text(question, String(current))).replace("%", "").replace("+", "").trim();
      const n = Number(raw.replace(",", "."));
      if (raw !== "" && Number.isInteger(n) && n >= -50 && n <= 300) return n;
      this.io.out(this.w.percentRange);
    }
    throw new SetupError(this.w.tooMany);
  }

  async dayMonth(question: string, current: string): Promise<string> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = await this.text(question, typedDayMonth(current));
      const md = parseDayMonth(raw);
      if (md !== null) return md;
      this.io.out(this.w.dayMonthHint);
    }
    throw new SetupError(this.w.tooMany);
  }

  async yes(question: string, byDefault: boolean): Promise<boolean> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.ask(`${question} ${this.w.yesNo(byDefault)}: `, { hidden: false })).trim().toLowerCase();
      if (raw === "") return byDefault;
      if (["s", "si", "sì", "y", "yes"].includes(raw)) return true;
      if (["n", "no"].includes(raw)) return false;
      this.io.out(this.w.yesNoHint);
    }
    throw new SetupError(this.w.tooMany);
  }

  /** A whole number in a range. */
  async count(question: string, current: number | undefined, max: number): Promise<number> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = await this.text(question, current !== undefined ? String(current) : undefined);
      const n = Number(raw);
      if (raw !== "" && Number.isInteger(n) && n >= 1 && n <= max) return n;
      this.io.out(this.w.wholeRange(1, max));
    }
    throw new SetupError(this.w.tooMany);
  }

  async whole(question: string, current: number, range: { min: number; max: number }): Promise<number> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.text(question, String(current))).replace("%", "").trim();
      const n = Number(raw);
      if (raw !== "" && Number.isInteger(n) && n >= range.min && n <= range.max) return n;
      this.io.out(this.w.wholeRange(range.min, range.max));
    }
    throw new SetupError(this.w.tooMany);
  }

  async time(question: string, current: string): Promise<string> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.text(question, current)).replace(".", ":");
      const padded = /^\d:\d\d$/.test(raw) ? `0${raw}` : raw;
      if (PILOT_TIME.test(padded)) return padded;
      this.io.out(this.w.timeHint);
    }
    throw new SetupError(this.w.tooMany);
  }

  /** One letter among the given ones. */
  async choice(question: string, letters: string[], byDefault: string): Promise<string> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.text(question, byDefault)).toLowerCase();
      if (letters.includes(raw)) return raw;
      this.io.out(this.w.lettersHint(letters));
    }
    throw new SetupError(this.w.tooMany);
  }
}

export interface LinkCheck {
  ok: boolean;
  reservations: number;
  blocked: number;
  error?: string;
}

/** Read one iCal link now, the way `sync` will, to tell the host at once whether it works. */
export async function checkLink(url: string, source: IcalSource, io: Io, w: SetupTexts = SETUP_TEXTS.it): Promise<LinkCheck> {
  try {
    const parsed = parseIcal(await download(url, { fetch: io.fetch, now: io.now(), timeoutMs: 20_000 }));
    let reservations = 0;
    let blocked = 0;
    for (const ev of parsed.events) {
      if (classify(ev.summary, source) === "reservation") reservations++;
      else blocked++;
    }
    return { ok: true, reservations, blocked };
  } catch (e) {
    const message = (e as Error).message;
    const why = /BEGIN:VCALENDAR/.test(message)
      ? w.noCalendar
      : /HTTP (\d+)/.test(message)
        ? w.httpError(`${/HTTP (\d+)/.exec(message)?.[1]}`)
        : /timeout|aborted/i.test(message)
          ? w.timeout
          : w.offline;
    return { ok: false, reservations: 0, blocked: 0, error: why };
  }
}


async function askLinks(a: Asker, io: Io, calendars: Obj[]): Promise<Obj[]> {
  const w = a.w;
  const result = [...calendars];
  for (const p of PLATFORMS) {
    const index = result.findIndex((c) => c.source === p.source);
    const current = index >= 0 && typeof result[index]?.url === "string" ? (result[index]?.url as string) : undefined;
    io.out("");
    io.out(w.linkTitle(p.label));
    io.out(`    ${w.where[p.source] ?? ""}`);
    io.out(current === undefined ? w.linkPaste(p.label) : w.linkKeep);
    for (let attempt = 0; ; attempt++) {
      const raw = (await a.text(w.link, current)).trim();
      if (raw === "" || (current !== undefined && raw === current)) break;
      if (raw === "-") {
        if (index >= 0) result.splice(index, 1);
        io.out(w.linkRemoved(p.label));
        break;
      }
      const url = normaliseCalendarUrl(raw);
      if (url === null) {
        io.out(w.notALink);
        if (attempt >= 4) throw new SetupError(w.tooMany);
        continue;
      }
      const other = PLATFORMS.find((q) => q.source !== p.source && q.looksLike.test(new URL(url).hostname));
      if (other) io.out(w.otherPlatform(other.label, p.label));
      io.out(w.reading);
      const check = await checkLink(url, p.source, io, w);
      if (check.ok) {
        io.out(w.read(check.reservations, check.blocked));
      } else {
        io.out(w.notRead(check.error ?? ""));
        if (!(await a.yes(w.saveAnyway, false))) {
          if (attempt >= 4) throw new SetupError(w.tooMany);
          io.out(w.pasteAgain);
          continue;
        }
      }
      const link: Obj = { source: p.source, url };
      if (index >= 0) result[index] = { ...result[index], ...link };
      else result.push(link);
      break;
    }
  }
  return result;
}

async function askSeasons(a: Asker, io: Io, city: string | undefined, current: SeasonPeriod[] | null): Promise<SeasonPeriod[] | null> {
  const w = a.w;
  const lang = w === SETUP_TEXTS.es ? "es" : "it";
  let periods: SeasonPeriod[];
  io.out("");
  if (current !== null && current.length > 0) {
    periods = current;
    io.out(w.seasonsNow);
  } else {
    const region = regionOf(city);
    periods = proposedSeasons(region, lang);
    io.out(w.seasonsProposed(city, w.regionLabel[region]));
  }
  periods.forEach((p, i) => io.out(`    ${i + 1}. ${describeSeason(p, lang)}`));
  io.out(w.seasonsExplain);
  const what = await a.choice(w.seasonsChoice, ["s", "c", "n"], "s");
  if (what === "n") return [];
  if (what === "s") return periods;

  const changed: SeasonPeriod[] = [];
  for (const p of periods) {
    io.out(`  ${p.name}:`);
    const start = await a.dayMonth(w.from, p.start);
    const end = await a.dayMonth(w.to, p.end);
    const pct = await a.percent(w.raise, p.multiplier !== undefined ? percentOf(p.multiplier) : 0);
    if (pct !== 0) changed.push({ name: p.name, start, end, multiplier: multiplierOf(pct) });
  }
  while (await a.yes(w.anotherSeason, false)) {
    const name = (await a.text(w.seasonName)) || w.seasonDefault(changed.length + 1);
    const start = await a.dayMonth(w.from, "04-01");
    const end = await a.dayMonth(w.to, "04-30");
    const pct = await a.percent(w.raiseSigned, 10);
    if (pct !== 0) changed.push({ name, start, end, multiplier: multiplierOf(pct) });
  }
  io.out(changed.length === 0 ? w.noSeasons : w.seasonsSaved);
  changed.forEach((p, i) => io.out(`    ${i + 1}. ${describeSeason(p, lang)}`));
  return changed;
}

/** Ask everything about one house; `raw` is its entry in the file (null for a new one). */
async function askListing(a: Asker, io: Io, raw: Obj | null, taken: Set<string>, number: number): Promise<Obj> {
  const pricing: Obj = isObj(raw?.pricing) ? (raw?.pricing as Obj) : {};
  const factors: Obj = isObj(pricing.factors) ? (pricing.factors as Obj) : {};
  const limits: Obj = isObj(factors.limits) ? (factors.limits as Obj) : {};
  const seasons: Obj | null = isObj(factors.seasons) ? (factors.seasons as Obj) : null;
  const w = a.w;

  const title = await a.text(w.houseName, typeof pricing.name === "string" ? pricing.name : w.houseDefault(number));
  const cityRaw = await a.text(w.city, typeof raw?.city === "string" ? raw.city : undefined);
  const city = cityRaw === "" ? undefined : cityRaw.slice(0, 100);
  const calendars = await askLinks(a, io, Array.isArray(raw?.calendars) ? (raw?.calendars as Obj[]) : []);

  io.out("");
  io.out(w.pricesIntro);
  let base: number;
  let floor: number;
  let ceiling: number;
  for (let attempt = 0; ; attempt++) {
    base = await a.amount(w.base, typeof pricing.basePrice === "number" ? pricing.basePrice : 100);
    floor = await a.amount(w.floor, typeof limits.floorPrice === "number" ? limits.floorPrice : Math.round(base * 0.6));
    ceiling = await a.amount(w.ceiling, typeof limits.ceilingPrice === "number" ? limits.ceilingPrice : Math.round(base * 2.5));
    if (floor <= base && base <= ceiling) break;
    io.out(w.pricesOrder(euro(floor), euro(base), euro(ceiling)));
    if (attempt >= 4) throw new SetupError(w.tooMany);
  }

  const currentSeasons = seasons !== null && seasons.enabled === true && Array.isArray(seasons.periods) ? (seasons.periods as SeasonPeriod[]) : null;
  const chosen = await askSeasons(a, io, city, currentSeasons);

  let entry: Obj;
  if (raw === null) {
    const name = slugify(title, taken, `casa-${number}`);
    entry = { name, calendars, pricing: newListingPricing(name, title, base, floor, ceiling, chosen) };
  } else {
    // An existing house keeps its short name (the database files its bookings under it) and every rule not asked about.
    const newFactors: Obj = {
      ...factors,
      limits: { ...limits, enabled: true, floorPrice: floor, ceilingPrice: ceiling },
      seasons: chosen && chosen.length > 0 ? { enabled: true, periods: chosen } : { enabled: false, periods: Array.isArray(seasons?.periods) ? seasons?.periods : [] },
    };
    entry = { ...raw, calendars, pricing: { ...pricing, name: title, basePrice: base, factors: newFactors } };
  }
  if (city !== undefined) entry.city = city;
  else delete entry.city;
  await askRoomsAndBeds(a, io, entry);
  return entry;
}

/**
 * Rooms and beds are asked only for a house in Italy whose Istat data goes to
 * ROSS1000: every day sent there carries them. Nobody else is bothered.
 */
async function askRoomsAndBeds(a: Asker, io: Io, entry: Obj): Promise<void> {
  const fg = isObj(entry.fairguest) ? (entry.fairguest as Obj) : null;
  const istat = fg && isObj(fg.istat) ? (fg.istat as Obj) : null;
  const region = istat && typeof istat.region === "string" ? (ISTAT_REGIONS as Record<string, { name: string; mode: string }>)[istat.region] : undefined;
  if (!fg || fg.country !== "IT" || region?.mode !== "ross1000") return;
  io.out("");
  io.out(a.w.istat(region.name));
  fg.rooms = await a.count(a.w.rooms, typeof fg.rooms === "number" ? fg.rooms : undefined, 999);
  fg.beds = await a.count(a.w.beds, typeof fg.beds === "number" ? fg.beds : undefined, 9999);
}

function summary(listing: Obj, w: SetupTexts): string[] {
  const p = listing.pricing as ListingConfig & Obj;
  const limits = p.factors.limits;
  const links = (listing.calendars as Obj[]).filter((c) => typeof c.url === "string").map((c) => PLATFORMS.find((q) => q.source === c.source)?.label ?? String(c.source));
  return [
    `  ${p.name ?? String(listing.name)}${typeof listing.city === "string" ? ` · ${listing.city}` : ""}`,
    w.calendars(links.length > 0 ? links.join(", ") : w.none),
    w.priceLine(euro(p.basePrice), limits ? { floor: euro(limits.floorPrice), ceiling: euro(limits.ceilingPrice) } : null),
  ];
}

/** One line per calendar read, in the setup's language, for the setup and for `apri`. */
export function feedLineIt(r: FeedReport, titles: Map<string, string>, w: SetupTexts = SETUP_TEXTS.it): string {
  const house = titles.get(r.listing) ?? r.listing;
  const where = PLATFORMS.find((p) => r.feed === p.source || r.feed.startsWith(`${p.source}-`))?.label ?? r.feed;
  if (!r.ok) return w.feedFailed(house, where, r.error ?? w.error);
  // The same words as the check of each link ("3 prenotazioni, 1 periodo bloccato"): the feed does not tell them apart.
  return `  ✓ ${house} · ${where}: ${w.feedSeen(r.seen)}${r.added > 0 ? w.feedAdded(r.added) : ""}${r.removed > 0 ? w.feedRemoved(r.removed) : ""}`;
}

const LANGUAGE_CHOICES: { key: string; language: Language; label: string }[] = [
  { key: "1", language: "it", label: "Italiano" },
  { key: "2", language: "es", label: "Español" },
  { key: "3", language: "en", label: "English" },
];

/**
 * The language of the calendar page, asked once when the config has none.
 * Proposed from this computer, then from the towns, saying why; with nothing
 * clear there is no proposal, and Enter leaves it empty (the page is then in English).
 */
async function askLanguage(a: Asker, io: Io, cities: (string | undefined)[]): Promise<Language | null> {
  const w = a.w;
  const proposal = languageProposal(cities, io.locale ?? systemLocale(io.env ?? {}));
  io.out("");
  io.out(w.languageTitle);
  io.out(`  ${LANGUAGE_CHOICES.map((c) => `${c.key} ${c.label}`).join(" · ")}`);
  const keys = LANGUAGE_CHOICES.map((c) => c.key);
  if (proposal !== null) {
    io.out(w.languagePropose(w.languageNames[proposal.language], proposal.from === "computer"));
    const key = await a.choice(w.languageChoose, keys, LANGUAGE_CHOICES.find((c) => c.language === proposal.language)?.key as string);
    return LANGUAGE_CHOICES.find((c) => c.key === key)?.language ?? null;
  }
  const key = await a.choice(w.languageSkip, [...keys, ""], "");
  return LANGUAGE_CHOICES.find((c) => c.key === key)?.language ?? null;
}

const channelLabel = (l: Obj): string | null => {
  const calendars = Array.isArray(l.calendars) ? (l.calendars as Obj[]) : [];
  if (calendars.some((c) => c.source === "smoobu")) return "Smoobu";
  if (calendars.some((c) => c.source === "beds24")) return "Beds24";
  return null;
};
const titleOf = (l: Obj) => (isObj(l.pricing) && typeof l.pricing.name === "string" ? l.pricing.name : String(l.name));

/**
 * The autopilot of the houses linked to Smoobu or Beds24: on or off, and how
 * much a price may move in a day. Returns the houses turned on now (they get a
 * preview after saving) and whether any house has it on.
 */
async function askPilot(a: Asker, io: Io, listings: Obj[], next: Obj): Promise<{ turnedOn: string[]; anyOn: boolean }> {
  const linked = listings.filter((l) => channelLabel(l) !== null);
  if (linked.length === 0) return { turnedOn: [], anyOn: false };
  const w = a.w;
  io.out("");
  io.out(w.pilotTitle);
  io.out(w.pilotExplain1);
  io.out(w.pilotExplain2);
  const turnedOn: string[] = [];
  for (const l of linked) {
    const before: Obj = isObj(l.pilot) ? (l.pilot as Obj) : {};
    const wasOn = before.enabled === true;
    const on = await a.yes(w.pilotAsk(titleOf(l), channelLabel(l) ?? ""), wasOn);
    if (!on) {
      if (isObj(l.pilot)) l.pilot = { ...before, enabled: false };
      continue;
    }
    const current = typeof before.maxDailyChangePercent === "number" ? before.maxDailyChangePercent : DEFAULT_MAX_CHANGE;
    const pct = await a.whole(w.pilotMax, current, PILOT_MAX_CHANGE);
    const pilot: Obj = { ...before, enabled: true };
    if (pct !== DEFAULT_MAX_CHANGE || before.maxDailyChangePercent !== undefined) pilot.maxDailyChangePercent = pct;
    if (typeof pilot.days === "number" && (pilot.days < PILOT_DAYS.min || pilot.days > PILOT_DAYS.max)) delete pilot.days;
    l.pilot = pilot;
    if (!wasOn) turnedOn.push(String(l.name));
  }
  const anyOn = listings.some((l) => isObj(l.pilot) && l.pilot.enabled === true);
  if (anyOn) {
    const time = await a.time(w.pilotTime, isObj(next.pilot) && typeof next.pilot.time === "string" ? next.pilot.time : DEFAULT_PILOT_TIME);
    next.pilot = { time };
  }
  return { turnedOn, anyOn };
}

/** After saving: show each house just turned on what it would write, and keep it on only if the host confirms. */
async function confirmPilot(a: Asker, io: Io, dir: string, config: HostConfig, names: string[]): Promise<void> {
  const w = a.w;
  for (const name of names) {
    const listing = config.listings.find((l) => l.name === name);
    if (!listing) continue;
    const title = listing.pricing.name ?? name;
    io.out("");
    io.out(w.previewLooking(title));
    let ok = false;
    try {
      const r = await runPilot(dir, io, { trigger: "manual", dryRun: true, includeOff: true, only: [name] }, config);
      const res = r.listings[0];
      if (res?.status === "preview") {
        const label = res.feed === "beds24" ? "Beds24" : "Smoobu";
        io.out(
          res.nights.length === 0
            ? w.previewNone(label)
            : w.previewSome(res.nights.length, label),
        );
        for (const n of res.nights.slice(0, 5)) {
          io.out(`      ${n.date}: ${n.oldPrice === null ? "—" : formatAmount(n.oldPrice)} → ${formatAmount(n.newPrice)}${n.limited === "cap" ? w.previewStep(formatAmount(n.target)) : ""}`);
        }
        ok = await a.yes(w.pilotConfirm(title), true);
      } else {
        io.out(w.previewFailed(res?.error ?? w.noAnswer));
      }
    } catch (e) {
      io.out(w.previewFailed((e as Error).message));
    }
    if (!ok) {
      writeListingPilot(dir, name, { enabled: false });
      io.out(w.pilotOff(title));
    } else io.out(w.pilotOn(title));
  }
}

/** Set up the daily run when some house has the autopilot on; remove it when none has. */
function scheduleOrRemove(io: Io, dir: string, config: HostConfig, w: SetupTexts): void {
  const anyOn = config.listings.some((l) => l.pilot?.enabled === true);
  try {
    if (anyOn) {
      const time = config.pilot?.time ?? DEFAULT_PILOT_TIME;
      installSchedule(dir, io, time, localToday(io.now()));
      io.out(w.scheduled(time));
    } else if (isScheduled(dir, io) === true) {
      removeSchedule(dir, io);
      io.out(w.unscheduled);
    }
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
    io.out(w.notScheduled(e.message));
    io.out(w.pageRuns);
  }
}

/** The config as saved, after the confirmations changed it. */
function readConfigAfter(dir: string): HostConfig {
  const checked = validateHostConfig(readRawConfig(dir));
  if (!checked.ok) throw new ConfigError("configurazione", checked.issues);
  return checked.value;
}

export function readRawConfig(dir: string): Obj | null {
  const file = configPath(dir);
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch (e) {
    throw new SetupError(`Il file ${file} non si legge (${(e as Error).message}). Correggilo, oppure spostalo altrove e rifai la configurazione.`);
  }
  const r = validateHostConfig(parsed);
  if (!r.ok) throw new ConfigError(file, r.issues);
  return parsed as Obj;
}

export async function configura(dir: string, io: Io): Promise<number> {
  const raw = readRawConfig(dir);
  const w = SETUP_TEXTS[setupLanguage(raw?.language, io.locale ?? systemLocale(io.env ?? {}))];
  if (!io.prompt) throw new SetupError(w.needsWindow);
  const a = new Asker(io, io.prompt, w);
  const listings: Obj[] = raw ? [...(raw.listings as Obj[])] : [];
  const taken = new Set(listings.map((l) => String(l.name)));

  io.out(w.title);
  io.out(w.howTo);

  if (listings.length === 0) {
    for (let n = 1; ; n++) {
      io.out("");
      io.out(w.house(n));
      const entry = await askListing(a, io, null, taken, n);
      listings.push(entry);
      io.out("");
      if (!(await a.yes(w.anotherHouse, false))) break;
    }
  } else {
    for (;;) {
      io.out("");
      io.out(w.yourHouses);
      listings.forEach((l, i) => io.out(`  ${i + 1}. ${isObj(l.pricing) && typeof l.pricing.name === "string" ? l.pricing.name : String(l.name)}`));
      const letters = [...listings.map((_, i) => String(i + 1)), "a", "f"];
      const what = await a.choice(w.whichHouse, letters, "f");
      if (what === "f") break;
      io.out("");
      if (what === "a") {
        io.out(w.house(listings.length + 1));
        listings.push(await askListing(a, io, null, taken, listings.length + 1));
      } else {
        const i = Number(what) - 1;
        listings[i] = await askListing(a, io, listings[i] as Obj, taken, i + 1);
      }
    }
  }

  const next: Obj = { ...(raw ?? { market: { airroi: { enabled: false } } }), listings };
  const pilot = await askPilot(a, io, listings, next);
  if (!isLanguage(next.language)) {
    const language = await askLanguage(
      a,
      io,
      listings.map((l) => (typeof l.city === "string" ? l.city : undefined)),
    );
    if (language !== null) next.language = language;
  }
  const checked = validateHostConfig(next);
  if (!checked.ok) throw new ConfigError("configurazione", checked.issues);

  const file = configPath(dir);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  // The host's guide in Italian, or in Spanish for a Spanish calendar, and the database; the config just written is kept.
  initFolder(dir, HOST_README[next.language === "es" ? "es" : "it"]);
  // The English README of earlier versions, left untouched by the host: the guide above takes its place.
  const oldReadme = path.join(dir, "README.txt");
  if (existsSync(oldReadme) && readFileSync(oldReadme, "utf8") === LOCAL_README) unlinkSync(oldReadme);

  io.out("");
  io.out(w.saved);
  for (const l of listings) for (const line of summary(l, w)) io.out(line);
  io.out(w.savedIn(file, raw !== null));

  const db = openDb(dbPath(dir));
  try {
    const { reports } = await syncEverything(db, dir, checked.value.listings, io);
    if (reports.length > 0) {
      io.out("");
      io.out(w.calendarsRead);
      const titles = new Map(checked.value.listings.map((l) => [l.name, l.pricing.name ?? l.name]));
      for (const r of reports) io.out(feedLineIt(r, titles, w));
    }
  } finally {
    db.close();
  }

  if (pilot.turnedOn.length > 0 || pilot.anyOn || isObj(raw?.pilot)) {
    await confirmPilot(a, io, dir, checked.value, pilot.turnedOn);
    io.out("");
    scheduleOrRemove(io, dir, readConfigAfter(dir), w);
  }
  return 0;
}
