import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { apri } from "../src/apri.js";
import { loadHostConfig, type HostListing } from "../src/config.js";
import { parseAmount } from "../src/configura.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { startServer } from "../src/serve.js";
import { languageOfCity, languageOfLocale, proposedLanguage, setupLanguage, systemLocale } from "../src/lingua.js";
import { describeSeason, parseDayMonth, proposedSeasons, regionOf } from "../src/stagioni.js";
import { LOCAL_README } from "../src/template.js";
import type { FetchLike } from "../src/io.js";
import { fakeFetch, fixture, tempDir, testIo, type TestIo } from "./helpers.js";

const AIRBNB = "https://www.airbnb.example/calendar/ical/1234.ics?s=abc";
const BOOKING = "https://admin.booking.example/hotel/hoteladmin/ical.html?t=abc";
const BROKEN = "https://www.airbnb.example/rooms/1234";

/** A host who answers the questions in order; an empty answer is Invio. */
function host(dir: string, answers: string[], fetch: FetchLike = fakeFetch({ [AIRBNB]: fixture("airbnb-esempio.ics"), [BOOKING]: fixture("booking-esempio.ics"), [BROKEN]: "<html>listing page</html>" })) {
  const io = testIo(dir, fetch) as TestIo & { questions: string[]; opened: string[] };
  io.questions = [];
  io.opened = [];
  const queue = [...answers];
  io.prompt = async (q) => {
    io.questions.push(q);
    if (queue.length === 0) throw new Error(`no answer left for "${q}"`);
    return queue.shift() as string;
  };
  io.openUrl = (url) => io.opened.push(url);
  return { io, left: () => queue.length };
}

const firstListing = (dir: string) => loadHostConfig(dir).listings[0] as HostListing;
const rawConfig = (dir: string) => JSON.parse(readFileSync(path.join(dir, "fairnight.config.json"), "utf8"));

describe("fairnight configura, first time", () => {
  it("asks name, town, links, prices and seasons, checks each link and writes a valid config", async () => {
    const dir = tempDir();
    const { io, left } = host(dir, [
      "Casa Limone", // name
      "Costa Adeje", // town → Canary seasons
      AIRBNB, // Airbnb link
      "", // no Booking
      "", // no Vrbo
      "90", // base
      "", // floor: proposed 54
      "", // ceiling: proposed 225
      "s", // seasons as proposed
      "", // no other house
      "", // calendar language: Costa Adeje proposes Español
    ]);
    expect(await main(["configura"], io)).toBe(0);
    expect(left()).toBe(0);

    const config = loadHostConfig(dir);
    expect(config.listings).toHaveLength(1);
    const l = config.listings[0] as HostListing;
    expect(l.name).toBe("casa-limone");
    expect(l.city).toBe("Costa Adeje");
    expect(l.pricing.name).toBe("Casa Limone");
    expect(l.calendars).toEqual([{ source: "airbnb", url: AIRBNB }]);
    expect(l.pricing.basePrice).toBe(90);
    expect(l.pricing.factors.limits).toEqual({ enabled: true, floorPrice: 54, ceilingPrice: 225 });
    expect(l.pricing.factors.seasons).toEqual({ enabled: true, periods: proposedSeasons("canarie") });

    expect(io.lines).toContain("    ✓ Letto: 2 prenotazioni, 1 periodo bloccato.");
    expect(io.lines.some((x) => x.includes("Canarie: alta stagione in inverno"))).toBe(true);
    expect(io.lines.some((x) => x.includes("Natale e Capodanno · dal 20 dic al 6 gen · +35%"))).toBe(true);
    // The calendars were read into the database at the end.
    const db = openDb(path.join(dir, "data", "fairnight.db"));
    expect((db.prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE listing = 'casa-limone'").get() as { n: number }).n).toBe(3);
    db.close();
    expect(io.lines).toContain("  ✓ Casa Limone · Airbnb: 3 tra prenotazioni e periodi bloccati, 3 nuovi");
    expect(existsSync(path.join(dir, "fairnight.config.json.bak"))).toBe(false);
  });

  it("says when a link does not work and lets the host paste it again or skip it", async () => {
    const dir = tempDir();
    const { io } = host(dir, [
      "Casa al mare",
      "Palermo",
      "not a link",
      BROKEN, // the listing page, not the calendar
      "n", // do not keep it
      "", // skip Airbnb after all
      BOOKING, // a Booking link pasted in the Booking question
      AIRBNB.replace("https://", "webcal://"), // Vrbo question gets an Airbnb link
      "s", // keep it anyway, it reads fine
      "100",
      "80",
      "200",
      "s",
      "",
      "", // calendar language: Palermo proposes Italiano
    ]);
    expect(await main(["configura"], io)).toBe(0);
    expect(io.lines).toContain("    Questo non è un link: deve cominciare con https:// (oppure webcal://). Riprova, o premi Invio per saltare.");
    expect(io.lines).toContain("    ✗ Non riesco a leggerlo: a questo indirizzo non c'è un calendario iCal. Controlla di aver copiato tutto il link.");
    expect(io.lines).toContain("    Attenzione: sembra un link di Airbnb, non di Vrbo.");
    const l = firstListing(dir);
    expect(l.calendars).toEqual([
      { source: "booking", url: BOOKING },
      { source: "vrbo", url: AIRBNB },
    ]);
    // Palermo: summer seasons plus Christmas.
    expect(l.pricing.factors.seasons?.periods).toEqual(proposedSeasons("estate"));
  });

  it("asks the prices again when the lowest is above the base", async () => {
    const dir = tempDir();
    const { io } = host(dir, ["Casa", "", "", "", "", "100", "120", "300", "100", "€ 70", "250,50", "n", "", ""]);
    expect(await main(["configura"], io)).toBe(0);
    expect(io.lines.some((x) => x.startsWith("    Il minimo (120 EUR) deve essere sotto il base (100 EUR)"))).toBe(true);
    const l = firstListing(dir);
    expect(l.pricing.factors.limits).toEqual({ enabled: true, floorPrice: 70, ceilingPrice: 250.5 });
    expect(l.pricing.factors.seasons?.enabled).toBe(false);
    expect(l.city).toBeUndefined();
  });

  it("lets the host change, drop and add seasons", async () => {
    const dir = tempDir();
    const { io } = host(dir, [
      "Casa",
      "Firenze",
      "",
      "",
      "",
      "100",
      "",
      "",
      "c",
      // Natale e Capodanno: new dates and +30%
      "22/12",
      "7/1",
      "30",
      // Giugno: dropped
      "",
      "",
      "0",
      // Luglio e agosto: kept
      "",
      "",
      "",
      // Settembre: lower
      "",
      "15/9",
      "5",
      "s", // another one
      "Pasqua",
      "1/4",
      "8/4",
      "20",
      "n",
      "",
      "", // calendar language: the proposed one
    ]);
    expect(await main(["configura"], io)).toBe(0);
    expect(firstListing(dir).pricing.factors.seasons).toEqual({
      enabled: true,
      periods: [
        { name: "Natale e Capodanno", start: "12-22", end: "01-07", multiplier: 1.3 },
        { name: "Luglio e agosto", start: "07-01", end: "08-31", multiplier: 1.25 },
        { name: "Settembre", start: "09-01", end: "09-15", multiplier: 1.05 },
        { name: "Pasqua", start: "04-01", end: "04-08", multiplier: 1.2 },
      ],
    });
  });

  it("adds a second house with its own short name", async () => {
    const dir = tempDir();
    const { io } = host(dir, ["Casa Sole", "", "", "", "", "80", "", "", "n", "s", "Casa Sole", "", "", "", "", "60", "", "", "n", "", ""]);
    expect(await main(["configura"], io)).toBe(0);
    expect(loadHostConfig(dir).listings.map((l) => l.name)).toEqual(["casa-sole", "casa-sole-2"]);
  });

  it("stops after too many wrong answers instead of asking forever", async () => {
    const dir = tempDir();
    const { io } = host(dir, ["Casa", "", "", "", "", "tanti", "molti", "boh", "?", "x"]);
    expect(await main(["configura"], io)).toBe(1);
    expect(io.errors).toContain("Configurazione interrotta: troppe risposte non valide.");
    expect(existsSync(path.join(dir, "fairnight.config.json"))).toBe(false);
  });
});

describe("fairnight configura, run again", () => {
  it("shows the current values, changes only what the host changes and keeps the rest of the file", async () => {
    const dir = tempDir();
    await main(["configura"], host(dir, ["Casa Limone", "Adeje", AIRBNB, "", "", "90", "", "", "s", "", "1"]).io);
    const before = rawConfig(dir);
    before.listings[0].pricing.factors.dayOfWeek.adjustments.sat = 25; // edited by hand
    before.listings[0].pricing.defaultMinStay = 4;
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(before, null, 2));

    const { io, left } = host(dir, [
      "1", // change house 1
      "Casa Limone Adeje", // new display name
      "", // town kept
      "", // Airbnb kept
      BOOKING, // Booking added
      "",
      "95",
      "",
      "",
      "s", // seasons kept as they are
      "f",
    ]);
    expect(await main(["configura"], io)).toBe(0);
    expect(left()).toBe(0);
    expect(io.questions).toContain("  Nome della casa [Casa Limone]: ");
    expect(io.questions).toContain("  Città o paese [Adeje]: ");
    expect(io.questions).toContain("  Prezzo minimo [54]: ");
    expect(io.lines).toContain("  Stagioni di adesso:");

    const after = rawConfig(dir);
    const l = after.listings[0];
    expect(l.name).toBe("casa-limone"); // bookings stay filed under the same name
    expect(l.pricing.name).toBe("Casa Limone Adeje");
    expect(l.pricing.basePrice).toBe(95);
    expect(l.pricing.defaultMinStay).toBe(4);
    expect(l.pricing.factors.dayOfWeek.adjustments.sat).toBe(25);
    expect(l.calendars).toEqual([
      { source: "airbnb", url: AIRBNB },
      { source: "booking", url: BOOKING },
    ]);
    expect(JSON.parse(readFileSync(path.join(dir, "fairnight.config.json.bak"), "utf8"))).toEqual(before);
  });

  it("asks rooms and beds only for a house in Italy that sends Istat data to ROSS1000", async () => {
    const dir = tempDir();
    await main(["configura"], host(dir, ["Casa Limone", "Adeje", AIRBNB, "", "", "90", "", "", "s", "", "1"]).io);
    const before = rawConfig(dir);
    before.listings[0].fairguest = { country: "IT", establishment: "ZZ00000000", rooms: 1, beds: 2, istat: { region: "lazio", code: "ZZ0001P" } };
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify(before, null, 2));
    const { io, left } = host(dir, ["1", "", "", "", "", "", "", "", "", "s", "2", "5", "f"]);
    expect(await main(["configura"], io)).toBe(0);
    expect(left()).toBe(0);
    expect(io.questions).toContain("  Camere [1]: ");
    expect(io.questions).toContain("  Letti (quante persone può ospitare) [2]: ");
    expect(rawConfig(dir).listings[0].fairguest).toMatchObject({ rooms: 2, beds: 5 });
  });

  it("removes a link when the host writes a dash", async () => {
    const dir = tempDir();
    await main(["configura"], host(dir, ["Casa", "", AIRBNB, BOOKING, "", "90", "", "", "n", "", ""]).io);
    const { io } = host(dir, ["1", "", "", "-", "", "", "", "", "", "n", "f", ""]);
    expect(await main(["configura"], io)).toBe(0);
    expect(firstListing(dir).calendars).toEqual([{ source: "booking", url: BOOKING }]);
  });

  it("does not touch a config with mistakes in it", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "fairnight.config.json"), '{"listings": []}');
    const { io } = host(dir, []);
    expect(await main(["configura"], io)).toBe(1);
    expect(readFileSync(path.join(dir, "fairnight.config.json"), "utf8")).toBe('{"listings": []}');
  });
});

describe("seasons, prices and dates as the host types them", () => {
  it("recognises the Canary Islands from the town, with or without accents", () => {
    for (const town of ["Adeje", "Playa de las Américas", "Corralejo (Fuerteventura)", "LAS PALMAS DE GRAN CANARIA", "Mogán"]) expect(regionOf(town)).toBe("canarie");
    for (const town of ["Palermo", "Valencia", "La Spezia", "Lampedusa", undefined]) expect(regionOf(town)).toBe("estate");
  });

  it("reads day and month, and refuses days that do not exist", () => {
    expect(parseDayMonth("20/12")).toBe("12-20");
    expect(parseDayMonth("1.4")).toBe("04-01");
    expect(parseDayMonth("29-02-2028")).toBe("02-29");
    expect(parseDayMonth("31/4")).toBeNull();
    expect(parseDayMonth("12/20")).toBeNull();
    expect(parseDayMonth("domani")).toBeNull();
  });

  it("reads prices with euro signs and commas", () => {
    expect(parseAmount("95")).toBe(95);
    expect(parseAmount("€ 95,50")).toBe(95.5);
    expect(parseAmount("120 euro")).toBe(120);
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("cento")).toBeNull();
  });

  it("describes a season in one line", () => {
    expect(describeSeason({ name: "Bassa", start: "11-01", end: "11-30", multiplier: 0.9 })).toBe("Bassa · dal 1 nov al 30 nov · -10%");
    expect(describeSeason({ name: "Fiera", start: "04-14", end: "04-19", fixedPrice: 180 })).toBe("Fiera · dal 14 apr al 19 apr · prezzo fisso 180");
  });
});

describe("fairnight apri", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  });
  const port = () => 40000 + Math.floor(Math.random() * 20000);

  it("runs the setup when there is no config, reads the calendars and opens the browser", async () => {
    const dir = tempDir();
    const { io } = host(dir, ["Casa", "", AIRBNB, "", "", "90", "", "", "n", "", ""]);
    const p = port();
    const r = await apri(dir, io, { port: p, days: 30, browser: true });
    if (r.server) servers.push(r.server);
    expect(r.code).toBe(0);
    expect(io.lines[0]).toBe("Fairnight non è ancora configurato: bastano poche domande.");
    expect(io.lines).toContain(`Fairnight è acceso: http://localhost:${p}`);
    expect(io.opened).toEqual([`http://localhost:${p}`]);
    const ping = await fetch(`http://127.0.0.1:${p}/api/ping`);
    expect(await ping.json()).toMatchObject({ app: "fairnight" });
    const data = (await (await fetch(`http://127.0.0.1:${p}/api/data`)).json()) as { listings: { name: string }[] };
    expect(data.listings.map((l) => l.name)).toEqual(["casa"]);
  });

  it("only opens the browser again when Fairnight is already running for the same folder", async () => {
    const dir = tempDir();
    await main(["configura"], host(dir, ["Casa", "", "", "", "", "90", "", "", "n", "", ""]).io);
    const p = port();
    const running = await startServer({ dir, io: testIo(dir), days: 30, port: p, lan: false, quiet: true });
    servers.push(running);
    const { io } = host(dir, [], (url) => fetch(url));
    const r = await apri(dir, io, { port: p, days: 30, browser: true });
    expect(r).toEqual({ code: 0 });
    expect(io.lines).toEqual([`Fairnight è già acceso: http://localhost:${p}`, "Ho aperto di nuovo il calendario nel browser. Questa finestra si può chiudere."]);
    expect(io.opened).toEqual([`http://localhost:${p}`]);
  });

  it("moves to the next port when another folder's Fairnight is using it", async () => {
    const other = tempDir();
    await main(["configura"], host(other, ["Altra", "", "", "", "", "90", "", "", "n", "", ""]).io);
    const dir = tempDir();
    await main(["configura"], host(dir, ["Casa", "", "", "", "", "90", "", "", "n", "", ""]).io);
    const p = port();
    servers.push(await startServer({ dir: other, io: testIo(other), days: 30, port: p, lan: false, quiet: true }));
    const { io } = host(dir, [], (url) => fetch(url));
    const r = await apri(dir, io, { port: p, days: 30, browser: false });
    if (r.server) servers.push(r.server);
    expect(io.lines).toContain(`Fairnight è acceso: http://localhost:${p + 1}`);
    expect(io.opened).toEqual([]);
  });
});

describe("language of the calendar page", () => {
  it("is proposed from the town: Spain and the Canary Islands Spanish, Italy Italian, anything else nothing", () => {
    expect(languageOfCity("Costa Adeje")).toBe("es");
    expect(languageOfCity("Málaga")).toBe("es");
    expect(languageOfCity("Palma de Mallorca")).toBe("es");
    expect(languageOfCity("Firenze")).toBe("it");
    expect(languageOfCity("Polignano a Mare, Puglia")).toBe("it");
    expect(languageOfCity("Lisboa")).toBeNull();
    expect(languageOfCity(undefined)).toBeNull();
  });

  it("comes first from the computer's language, then from the town", () => {
    expect(proposedLanguage(["Costa Adeje"], "it-IT")).toBe("it");
    expect(proposedLanguage(["Firenze"], "es_ES.UTF-8")).toBe("es");
    expect(proposedLanguage(["Lisboa", "Sevilla"], "en-US")).toBe("es");
    expect(proposedLanguage(["Lisboa"], "it_IT.UTF-8")).toBe("it");
    expect(proposedLanguage([undefined], "de-DE")).toBeNull();
    expect(languageOfLocale("es-ES")).toBe("es");
    expect(systemLocale({ LANG: "it_IT.UTF-8" })).toBe("it_IT.UTF-8");
    expect(systemLocale({ LC_ALL: "C" })).toBe(Intl.DateTimeFormat().resolvedOptions().locale);
  });

  it("is written when the host confirms the proposal", async () => {
    const dir = tempDir();
    const { io } = host(dir, ["Casa Limone", "Adeje", "", "", "", "90", "", "", "n", "", ""]);
    expect(await main(["configura"], io)).toBe(0);
    expect(io.questions.at(-1)).toBe("Scegli 1, 2 o 3 [2]: ");
    expect(io.lines).toContain("  1 Italiano · 2 Español · 3 English");
    expect(io.lines).toContain("  Ti propongo lo spagnolo, per la città della casa: premi Invio per tenerlo.");
    expect(rawConfig(dir).language).toBe("es");
  });

  it("uses the computer's language when the town says nothing, and the host can choose another", async () => {
    const dir = tempDir();
    const { io } = host(dir, ["Casa", "Lisboa", "", "", "", "90", "", "", "n", "", "3"]);
    io.locale = "it-IT";
    expect(await main(["configura"], io)).toBe(0);
    expect(io.questions.at(-1)).toBe("Scegli 1, 2 o 3 [1]: ");
    expect(io.lines).toContain("  Ti propongo l'italiano, la lingua di questo computer: premi Invio per tenerlo.");
    expect(rawConfig(dir).language).toBe("en");
  });

  it("with nothing to propose, Invio leaves it out and the page stays in English; it is not asked again once set", async () => {
    const dir = tempDir();
    const first = host(dir, ["Casa", "Lisboa", "", "", "", "90", "", "", "n", "", ""]);
    expect(await main(["configura"], first.io)).toBe(0);
    expect(first.io.questions.at(-1)).toBe("Scegli 1, 2 o 3 (Invio per saltare: il calendario resta in inglese): ");
    expect(rawConfig(dir).language).toBeUndefined();
    const second = host(dir, ["f", "2"]);
    expect(await main(["configura"], second.io)).toBe(0);
    expect(rawConfig(dir).language).toBe("es");
    const third = host(dir, ["f"]);
    expect(await main(["configura"], third.io)).toBe(0);
    expect(third.left()).toBe(0);
  });

  it("leaves the host's guide in Italian, or in Spanish for a Spanish calendar, instead of the English README", async () => {
    const italian = tempDir();
    writeFileSync(path.join(italian, "README.txt"), LOCAL_README);
    const first = host(italian, ["Casa", "Lisboa", "", "", "", "90", "", "", "n", "", "1"]);
    expect(await main(["configura"], first.io)).toBe(0);
    expect(readFileSync(path.join(italian, "LEGGIMI.txt"), "utf8")).toContain("Scrivici a hello@khlumen.com e allega il file installazione.log.");
    expect(existsSync(path.join(italian, "README.txt"))).toBe(false);

    const es = tempDir();
    const second = host(es, ["Casa", "Lisboa", "", "", "", "90", "", "", "n", "", "2"]);
    expect(await main(["configura"], second.io)).toBe(0);
    expect(readFileSync(path.join(es, "LEEME.txt"), "utf8")).toContain("Escríbenos a hello@khlumen.com");
    expect(existsSync(path.join(es, "LEGGIMI.txt"))).toBe(false);
  });

  it("keeps a README.txt the host changed", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "README.txt"), "my notes");
    const { io } = host(dir, ["Casa", "Lisboa", "", "", "", "90", "", "", "n", "", ""]);
    expect(await main(["configura"], io)).toBe(0);
    expect(readFileSync(path.join(dir, "README.txt"), "utf8")).toBe("my notes");
  });

  it("speaks Spanish for a Spanish calendar, or the first time on a Spanish computer", () => {
    expect(setupLanguage("es", "it-IT")).toBe("es");
    expect(setupLanguage("it", "es-ES")).toBe("it");
    expect(setupLanguage(undefined, "es_ES.UTF-8")).toBe("es");
    expect(setupLanguage(undefined, "en-US")).toBe("it");
    expect(setupLanguage("en", "es-ES")).toBe("it");
  });

  it("asks everything in Spanish on a Spanish computer, with the seasons named in Spanish", async () => {
    const dir = tempDir();
    const { io, left } = host(dir, ["Casa Naranja", "Valencia", "", "", "", "90", "", "", "s", "", ""]);
    io.locale = "es-ES";
    expect(await main(["configura"], io)).toBe(0);
    expect(left()).toBe(0);
    expect(io.lines).toContain("Configuración de Fairnight");
    expect(io.questions).toContain("  Nombre del alojamiento [Alojamiento 1]: ");
    expect(io.questions).toContain("¿Quieres añadir otro alojamiento? [s/N]: ");
    expect(io.lines).toContain("    3. Julio y agosto · del 1 jul al 31 ago · +25%");
    expect(io.lines).toContain("  Te propongo el español, el idioma de este ordenador: pulsa Intro para dejarlo.");
    expect(io.lines).toContain("Guardado. Estos son tus alojamientos:");
    // "EUR" and never "€": the classic Windows console shows the sign as "?".
    expect(io.lines.some((x) => x.startsWith("    precio base 90 EUR"))).toBe(true);
    expect([...io.lines, ...io.questions].join(" ")).not.toContain("€");
    expect(rawConfig(dir).language).toBe("es");
    expect(existsSync(path.join(dir, "LEEME.txt"))).toBe(true);
    // Run again ("Cambia impostazioni"): Spanish because the calendar is, whatever the computer.
    const again = host(dir, ["f"]);
    again.io.locale = "it-IT";
    expect(await main(["configura"], again.io)).toBe(0);
    expect(again.io.lines).toContain("Tus alojamientos:");
  });

  it("only it, es or en in the config", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ language: "fr", listings: [{ name: "casa", calendars: [], pricing: { currency: "EUR", basePrice: 90, defaultMinStay: 2, factors: {} } }] }));
    expect(() => loadHostConfig(dir)).toThrow('config.language: must be "it", "es" or "en", got "fr"');
  });
});
