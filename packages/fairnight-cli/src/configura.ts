/**
 * `fairnight configura`: the guided setup, in Italian, for hosts who never
 * open fairnight.config.json. It asks for the name of each house, its town,
 * its Airbnb, Booking and Vrbo iCal links (reading each one to check it),
 * the base, lowest and highest price and the seasons, then writes the config.
 *
 * - Run again, it shows the current values as defaults: that is how the host
 *   changes them later. Rules it does not ask about are kept as they are.
 * - Seasons are proposed from the town and shown with their dates; nothing is
 *   applied unless the host confirms it.
 * - The previous config is kept as fairnight.config.json.bak.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ConfigError, type ListingConfig, type SeasonPeriod } from "fairnight";
import { slugify } from "./channel.js";
import { SetupError, normaliseCalendarUrl, validateHostConfig, type IcalSource } from "./config.js";
import { openDb } from "./db.js";
import { classify, parseIcal } from "./ical.js";
import { initFolder } from "./init.js";
import { configPath, dbPath, stripBom, type Io } from "./io.js";
import { describeSeason, multiplierOf, parseDayMonth, percentOf, proposedSeasons, REGION_LABEL, regionOf, typedDayMonth } from "./stagioni.js";
import { download } from "./sync.js";
import { syncEverything } from "./sync-all.js";
import type { FeedReport } from "./sync.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The platforms the setup asks about, with two lines on where to find the link. */
export const PLATFORMS: { source: IcalSource; label: string; where: string; looksLike: RegExp }[] = [
  {
    source: "airbnb",
    label: "Airbnb",
    where: "Dal sito di Airbnb: Calendario › scegli la casa › Disponibilità › Collega calendari › Collega a un altro sito web › copia il link.",
    looksLike: /airbnb\./,
  },
  {
    source: "booking",
    label: "Booking",
    where: "Dall'Extranet di Booking: Tariffe e disponibilità › Sincronizza calendari › Esporta calendario › copia il link.",
    looksLike: /booking\.com/,
  },
  {
    source: "vrbo",
    label: "Vrbo",
    where: "Dal sito di Vrbo per proprietari: Calendario › Importa ed esporta › Esporta calendario › copia il link.",
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
  constructor(private readonly io: Io, private readonly ask: NonNullable<Io["prompt"]>) {}

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
      this.io.out(`    «${raw}» non è un prezzo: scrivi solo il numero, per esempio 95.`);
    }
    throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
  }

  async percent(question: string, current: number): Promise<number> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.text(question, String(current))).replace("%", "").replace("+", "").trim();
      const n = Number(raw.replace(",", "."));
      if (raw !== "" && Number.isInteger(n) && n >= -50 && n <= 300) return n;
      this.io.out("    Scrivi un numero intero da -50 a 300, per esempio 20 (vuol dire +20%).");
    }
    throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
  }

  async dayMonth(question: string, current: string): Promise<string> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = await this.text(question, typedDayMonth(current));
      const md = parseDayMonth(raw);
      if (md !== null) return md;
      this.io.out("    Scrivi giorno e mese, per esempio 20/12.");
    }
    throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
  }

  async yes(question: string, byDefault: boolean): Promise<boolean> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.ask(`${question} ${byDefault ? "[S/n]" : "[s/N]"}: `, { hidden: false })).trim().toLowerCase();
      if (raw === "") return byDefault;
      if (["s", "si", "sì", "y", "yes"].includes(raw)) return true;
      if (["n", "no"].includes(raw)) return false;
      this.io.out("    Rispondi s (sì) oppure n (no).");
    }
    throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
  }

  /** One letter among the given ones. */
  async choice(question: string, letters: string[], byDefault: string): Promise<string> {
    for (let i = 0; i < Asker.TRIES; i++) {
      const raw = (await this.text(question, byDefault)).toLowerCase();
      if (letters.includes(raw)) return raw;
      this.io.out(`    Rispondi con una di queste lettere: ${letters.join(", ")}.`);
    }
    throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
  }
}

export interface LinkCheck {
  ok: boolean;
  reservations: number;
  blocked: number;
  error?: string;
}

/** Read one iCal link now, the way `sync` will, to tell the host at once whether it works. */
export async function checkLink(url: string, source: IcalSource, io: Io): Promise<LinkCheck> {
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
      ? "a questo indirizzo non c'è un calendario iCal"
      : /HTTP (\d+)/.test(message)
        ? `il sito ha risposto con l'errore ${/HTTP (\d+)/.exec(message)?.[1]}`
        : /timeout|aborted/i.test(message)
          ? "il sito non ha risposto in 20 secondi"
          : "non riesco a collegarmi (controlla la connessione a internet)";
    return { ok: false, reservations: 0, blocked: 0, error: why };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function askLinks(a: Asker, io: Io, calendars: Obj[]): Promise<Obj[]> {
  const result = [...calendars];
  for (const p of PLATFORMS) {
    const index = result.findIndex((c) => c.source === p.source);
    const current = index >= 0 && typeof result[index]?.url === "string" ? (result[index]?.url as string) : undefined;
    io.out("");
    io.out(`  Link iCal di ${p.label}`);
    io.out(`    ${p.where}`);
    io.out(
      current === undefined
        ? `    Incollalo qui; premi Invio se la casa non è su ${p.label}.`
        : "    Premi Invio per tenere quello di adesso, scrivi - per toglierlo, oppure incolla quello nuovo.",
    );
    for (let attempt = 0; ; attempt++) {
      const raw = (await a.text("    Link", current)).trim();
      if (raw === "" || (current !== undefined && raw === current)) break;
      if (raw === "-") {
        if (index >= 0) result.splice(index, 1);
        io.out(`    Tolto il link di ${p.label}.`);
        break;
      }
      const url = normaliseCalendarUrl(raw);
      if (url === null) {
        io.out("    Questo non è un link: deve cominciare con https:// (oppure webcal://). Riprova, o premi Invio per saltare.");
        if (attempt >= 4) throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
        continue;
      }
      const other = PLATFORMS.find((q) => q.source !== p.source && q.looksLike.test(new URL(url).hostname));
      if (other) io.out(`    Attenzione: sembra un link di ${other.label}, non di ${p.label}.`);
      io.out("    Lo leggo…");
      const check = await checkLink(url, p.source, io);
      if (check.ok) {
        io.out(`    ✓ Letto: ${plural(check.reservations, "prenotazione", "prenotazioni")}, ${plural(check.blocked, "periodo bloccato", "periodi bloccati")}.`);
      } else {
        io.out(`    ✗ Non riesco a leggerlo: ${check.error}. Controlla di aver copiato tutto il link.`);
        if (!(await a.yes("    Lo salvo lo stesso? (potrai correggerlo dopo)", false))) {
          if (attempt >= 4) throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
          io.out("    Incolla di nuovo il link, oppure premi Invio per saltare.");
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
  let periods: SeasonPeriod[];
  io.out("");
  if (current !== null && current.length > 0) {
    periods = current;
    io.out("  Stagioni di adesso:");
  } else {
    const region = regionOf(city);
    periods = proposedSeasons(region);
    io.out(`  Stagioni proposte${city ? ` per ${city}` : ""} (${REGION_LABEL[region]}):`);
  }
  periods.forEach((p, i) => io.out(`    ${i + 1}. ${describeSeason(p)}`));
  io.out("  In queste date il prezzo sale (o scende) della percentuale scritta.");
  const what = await a.choice("  s = usale così · c = cambiale · n = nessuna stagione", ["s", "c", "n"], "s");
  if (what === "n") return [];
  if (what === "s") return periods;

  const changed: SeasonPeriod[] = [];
  for (const p of periods) {
    io.out(`  ${p.name}:`);
    const start = await a.dayMonth("    dal (giorno/mese)", p.start);
    const end = await a.dayMonth("    al (giorno/mese)", p.end);
    const pct = await a.percent("    aumento in % (0 = togli questa stagione)", p.multiplier !== undefined ? percentOf(p.multiplier) : 0);
    if (pct !== 0) changed.push({ name: p.name, start, end, multiplier: multiplierOf(pct) });
  }
  while (await a.yes("  Aggiungo un'altra stagione?", false)) {
    const name = (await a.text("    nome (per esempio Pasqua)")) || `Stagione ${changed.length + 1}`;
    const start = await a.dayMonth("    dal (giorno/mese)", "04-01");
    const end = await a.dayMonth("    al (giorno/mese)", "04-30");
    const pct = await a.percent("    aumento in % (con il meno se il prezzo scende, per esempio -10)", 10);
    if (pct !== 0) changed.push({ name, start, end, multiplier: multiplierOf(pct) });
  }
  io.out(changed.length === 0 ? "  Nessuna stagione." : "  Stagioni salvate:");
  changed.forEach((p, i) => io.out(`    ${i + 1}. ${describeSeason(p)}`));
  return changed;
}

/** Ask everything about one house; `raw` is its entry in the file (null for a new one). */
async function askListing(a: Asker, io: Io, raw: Obj | null, taken: Set<string>, number: number): Promise<Obj> {
  const pricing: Obj = isObj(raw?.pricing) ? (raw?.pricing as Obj) : {};
  const factors: Obj = isObj(pricing.factors) ? (pricing.factors as Obj) : {};
  const limits: Obj = isObj(factors.limits) ? (factors.limits as Obj) : {};
  const seasons: Obj | null = isObj(factors.seasons) ? (factors.seasons as Obj) : null;

  const title = await a.text("  Nome della casa", typeof pricing.name === "string" ? pricing.name : `Casa ${number}`);
  const cityRaw = await a.text("  Città o paese", typeof raw?.city === "string" ? raw.city : undefined);
  const city = cityRaw === "" ? undefined : cityRaw.slice(0, 100);
  const calendars = await askLinks(a, io, Array.isArray(raw?.calendars) ? (raw?.calendars as Obj[]) : []);

  io.out("");
  io.out("  Prezzi a notte, in euro. Fairnight parte dal prezzo base e non va mai sotto il minimo né sopra il massimo.");
  let base: number;
  let floor: number;
  let ceiling: number;
  for (let attempt = 0; ; attempt++) {
    base = await a.amount("  Prezzo base", typeof pricing.basePrice === "number" ? pricing.basePrice : 100);
    floor = await a.amount("  Prezzo minimo", typeof limits.floorPrice === "number" ? limits.floorPrice : Math.round(base * 0.6));
    ceiling = await a.amount("  Prezzo massimo", typeof limits.ceilingPrice === "number" ? limits.ceilingPrice : Math.round(base * 2.5));
    if (floor <= base && base <= ceiling) break;
    io.out(`    Il minimo (${euro(floor)}) deve essere sotto il base (${euro(base)}) e il massimo (${euro(ceiling)}) sopra: riproviamo.`);
    if (attempt >= 4) throw new SetupError("Configurazione interrotta: troppe risposte non valide.");
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
  return entry;
}

function summary(listing: Obj): string[] {
  const p = listing.pricing as ListingConfig & Obj;
  const limits = p.factors.limits;
  const links = (listing.calendars as Obj[]).filter((c) => typeof c.url === "string").map((c) => PLATFORMS.find((q) => q.source === c.source)?.label ?? String(c.source));
  return [
    `  ${p.name ?? String(listing.name)}${typeof listing.city === "string" ? ` · ${listing.city}` : ""}`,
    `    calendari: ${links.length > 0 ? links.join(", ") : "nessuno"}`,
    `    prezzo base ${euro(p.basePrice)}${limits ? `, minimo ${euro(limits.floorPrice)}, massimo ${euro(limits.ceilingPrice)}` : ""}`,
  ];
}

/** One line per calendar read, in Italian, for the setup and for `apri`. */
export function feedLineIt(r: FeedReport, titles: Map<string, string>): string {
  const house = titles.get(r.listing) ?? r.listing;
  const where = PLATFORMS.find((p) => r.feed === p.source || r.feed.startsWith(`${p.source}-`))?.label ?? r.feed;
  if (!r.ok) return `  ✗ ${house} · ${where}: non letto (${r.error ?? "errore"}). I dati di prima restano com'erano.`;
  return `  ✓ ${house} · ${where}: ${plural(r.seen, "evento", "eventi")}${r.added > 0 ? `, ${r.added} nuovi` : ""}${r.removed > 0 ? `, ${r.removed} tolti` : ""}`;
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
  if (!io.prompt) throw new SetupError("La configurazione guidata ha bisogno di una finestra dove scrivere le risposte.");
  const a = new Asker(io, io.prompt);
  const raw = readRawConfig(dir);
  const listings: Obj[] = raw ? [...(raw.listings as Obj[])] : [];
  const taken = new Set(listings.map((l) => String(l.name)));

  io.out("Configurazione di Fairnight");
  io.out("Tra parentesi quadre c'è la risposta già pronta: premi Invio per tenerla, oppure scrivi la tua.");

  if (listings.length === 0) {
    for (let n = 1; ; n++) {
      io.out("");
      io.out(`Casa ${n}`);
      const entry = await askListing(a, io, null, taken, n);
      listings.push(entry);
      io.out("");
      if (!(await a.yes("Vuoi aggiungere un'altra casa?", false))) break;
    }
  } else {
    for (;;) {
      io.out("");
      io.out("Le tue case:");
      listings.forEach((l, i) => io.out(`  ${i + 1}. ${isObj(l.pricing) && typeof l.pricing.name === "string" ? l.pricing.name : String(l.name)}`));
      const letters = [...listings.map((_, i) => String(i + 1)), "a", "f"];
      const what = await a.choice("Scrivi il numero della casa da cambiare, a per aggiungerne una, f per finire", letters, "f");
      if (what === "f") break;
      io.out("");
      if (what === "a") {
        io.out(`Casa ${listings.length + 1}`);
        listings.push(await askListing(a, io, null, taken, listings.length + 1));
      } else {
        const i = Number(what) - 1;
        listings[i] = await askListing(a, io, listings[i] as Obj, taken, i + 1);
      }
    }
  }

  const next: Obj = { ...(raw ?? { market: { airroi: { enabled: false } } }), listings };
  const checked = validateHostConfig(next);
  if (!checked.ok) throw new ConfigError("configurazione", checked.issues);

  const file = configPath(dir);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  initFolder(dir); // the README and the database; the config just written is kept

  io.out("");
  io.out("Salvato. Ecco le tue case:");
  for (const l of listings) for (const line of summary(l)) io.out(line);
  io.out(`Le impostazioni sono nel file ${file}${raw ? " (quelle di prima in fairnight.config.json.bak)" : ""}.`);

  const db = openDb(dbPath(dir));
  try {
    const { reports } = await syncEverything(db, dir, checked.value.listings, io);
    if (reports.length > 0) {
      io.out("");
      io.out("Calendari letti:");
      const titles = new Map(checked.value.listings.map((l) => [l.name, l.pricing.name ?? l.name]));
      for (const r of reports) io.out(feedLineIt(r, titles));
    }
  } finally {
    db.close();
  }
  return 0;
}
