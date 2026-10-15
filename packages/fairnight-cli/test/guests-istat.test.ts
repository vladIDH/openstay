/**
 * Istat in Italy from the command line: the residence in the form, the record
 * kept before Alloggiati Web erases the guests, ROSS1000 (a fake service), the
 * files of Trento and Umbria, the figures of a manual region, retention.
 * Invented data and tables only.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import type { SmoobuFetchLike } from "../src/io.js";
import { main } from "../src/main.js";
import { startServer } from "../src/serve.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

const PASS = "frase segreta di prova";
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const ICAL = "https://cal.example.org/airbnb/casa-istat.ics";
const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
const TABLE_URLS = { municipalities: "https://t.example.invalid/c.csv", states: "https://t.example.invalid/s.csv", documents: "https://t.example.invalid/d.csv" };
const TABLES = {
  [TABLE_URLS.municipalities]: ["Codice,Descrizione,Provincia,DataFineVal", "900000001,BORGO DI PROVA,ZZ,", "900000002,SANT'ESEMPIO,ZZ,", ...many(1000, (i) => `${910000000 + i},RIEMPITIVO ${i},ZX,`)].join("\r\n"),
  [TABLE_URLS.states]: ["Codice,Descrizione,Provincia,DataFineVal", "100000100,ITALIA,ES,", "100000216,GERMANIA,ES,", ...many(100, (i) => `${190000000 + i},RIEMPITIVO ${i},ES,`)].join("\r\n"),
  [TABLE_URLS.documents]: ["Codice,Descrizione", "IDENT,CARTA DI IDENTITA'", "IDELE,CARTA IDENTITA' ELETTRONICA", "PASOR,PASSAPORTO ORDINARIO"].join("\r\n"),
};

const servers: Server[] = [];
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) if (d.open) d.close();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A fake ROSS1000: accepts every guest, records the calls. */
function fakeRoss() {
  const calls: { headers: Record<string, string>; body: string }[] = [];
  const fetchFn: SmoobuFetchLike = async (_url, init) => {
    calls.push({ headers: init.headers, body: init.body ?? "" });
    const days = (init.body ?? "").match(/<movimento>/g)?.length ?? 0;
    const ids = (chunk: string, tag: string) => [...chunk.matchAll(new RegExp(`<${tag}><idswh>([^<]+)</idswh>`, "g"))].map((m) => m[1]);
    const results = (init.body ?? "")
      .split("<movimento>")
      .slice(1)
      .map((m) => `<risultatiGiorno><arrivi>${ids(m, "arrivo").map((id) => `<arrivo><idswh>${id}</idswh><successo>true</successo></arrivo>`).join("")}</arrivi></risultatiGiorno>`);
    const body = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:inviaMovimentazioneResponse xmlns:ns2="http://checkin.ws.service.turismo5.gies.it/"><return>${results.join("")}</return></ns2:inviaMovimentazioneResponse></soap:Body></soap:Envelope>`;
    expect(results).toHaveLength(days);
    return { status: 200, headers: { get: () => null }, text: async () => body };
  };
  return { fetchFn, calls };
}

async function ready(istat: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify({
      listings: [
        {
          name: "casa-istat",
          calendars: [{ source: "airbnb", url: ICAL }],
          pricing: { name: "Casa di Prova", currency: "EUR", basePrice: 100, defaultMinStay: 1, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 } } },
          fairguest: { country: "IT", establishment: "ZZ00000000", checkInTime: "16:00", checkOutTime: "10:00", rooms: 2, beds: 4, istat, ...extra },
        },
      ],
    }),
  );
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nBEGIN:VEVENT\r\nDTEND;VALUE=DATE:20990612\r\nDTSTART;VALUE=DATE:20990610\r\nUID:istat-1@airbnb.example\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const ross = fakeRoss();
  const fetch = fakeFetch({ [ICAL]: ics, ...TABLES });
  const io = (now = "2099-06-01T09:00:00", more: Partial<TestIo> = {}) =>
    Object.assign(testIo(dir, fetch, now), { scryptCost: FAST, env: { FAIRGUEST_FRASE: PASS }, alloggiatiTableUrls: TABLE_URLS, istatFetch: ross.fetchFn, istatUrl: "https://ross.example.invalid/ws/checkinV2", ...more });
  expect(await main(["ospiti", "attiva"], io())).toBe(0);
  expect(await main(["sync"], io())).toBe(0);
  const db = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(db);
  const stay = db.prepare("SELECT id, code FROM guest_stays").get() as { id: string; code: string };
  return { dir, io, db, stay, ross };
}

const HOLDER = {
  givenName: "Ospite",
  surname1: "Prova",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  birthCountry: "ITA",
  birthPlace: "Borgo di Prova",
  country: "ITA",
  locality: "Sant'Esempio",
  docType: "passport",
  docNumber: "ZZ0000000",
  docCountry: "ITA",
  docPlace: "Borgo di Prova",
};
const FRIEND = { givenName: "Amica", surname1: "Prova", birthDate: "2061-01-01", sex: "male", nationality: "DEU", birthCountry: "DEU", country: "DEU", locality: "Musterstadt" };

async function post(base: string, code: string, fields: Record<string, string>) {
  const form = await fetch(`${base}/checkin/${code}?lang=it`);
  const t = /name="t" value="([^"]+)"/.exec(await form.text())?.[1] ?? "";
  return fetch(`${base}/checkin/${code}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, lang: "it", ...fields }).toString() });
}

async function withGuests(r: Awaited<ReturnType<typeof ready>>) {
  const server = await startServer({ dir: r.dir, io: r.io(), days: 30, port: 0, lan: false });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  expect((await post(base, r.stay.code, HOLDER)).status).toBe(303);
  expect((await post(base, r.stay.code, FRIEND)).status).toBe(303);
  return base;
}

describe("the residence in the form", () => {
  it("is asked only when the listing sends Istat data, and required", async () => {
    const r = await ready({ region: "lazio", code: "ZZ0001P" });
    const server = await startServer({ dir: r.dir, io: r.io(), days: 30, port: 0, lan: false });
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const html = await (await fetch(`${base}/checkin/${r.stay.code}?lang=it`)).text();
    expect(html).toContain("Residenza");
    expect(html).toContain('name="province"');
    const bad = await post(base, r.stay.code, { ...HOLDER, locality: "" });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toMatch(/id="locality-err">Obbligatorio/);
  });
});

describe("fairnight ospiti istat, ROSS1000", () => {
  it("writes the month's file, sends it with --applica, records each day, and lets the record go", async () => {
    const r = await ready({ region: "lazio", code: "ZZ0001P" });
    await withGuests(r);
    const dry = r.io("2099-07-02T09:00:00");
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], dry)).toBe(0);
    expect(dry.lines.join("\n")).toMatch(/30 days ready \(2 arrivals, 2 departures\)/);
    expect(r.ross.calls).toEqual([]);
    const file = path.join(r.dir, "data", "fairguest", "istat", "ross1000-casa-istat-2099-06.xml");
    const xml = readFileSync(file, "utf8");
    expect(xml).not.toMatch(/Ospite|Amica|ZZ0000000/);
    expect(xml).toContain("<luogoresidenza>900000002</luogoresidenza>");
    expect(xml).toContain("<luogoresidenza>Musterstadt</luogoresidenza>");
    expect(xml).toContain("<data>20990610</data><struttura><apertura>SI</apertura><camereoccupate>2</camereoccupate><cameredisponibili>2</cameredisponibili><lettidisponibili>4</lettidisponibili>");
    // Without credentials nothing leaves.
    const noCred = r.io("2099-07-02T09:00:00");
    expect(await main(["ospiti", "istat", "--mese", "2099-06", "--applica"], noCred)).toBe(1);
    expect(r.ross.calls).toEqual([]);
    const answers = ["utente-prova", "pass-0000-not-real"];
    expect(await main(["ospiti", "credenziali", "--istat"], r.io("2099-07-02T09:00:00", { prompt: async () => answers.shift() as string }))).toBe(0);
    const send = r.io("2099-07-02T09:00:00");
    expect(await main(["ospiti", "istat", "--mese", "2099-06", "--applica"], send)).toBe(0);
    expect(send.lines.join("\n")).toMatch(/ROSS1000 accepted 30 of 30 days/);
    expect(r.ross.calls[0]?.headers.authorization).toBe(`Basic ${btoa("utente-prova:pass-0000-not-real")}`);
    expect(r.db.prepare("SELECT COUNT(*) AS n FROM guest_istat_days WHERE status = 'accepted'").get()).toEqual({ n: 30 });
    expect(existsSync(file)).toBe(false);
    // Arrival and departure accepted: the Istat record goes at the next command.
    await main(["ospiti"], r.io("2099-07-02T10:00:00"));
    expect(r.db.prepare("SELECT istat_data FROM guest_stays").get()).toEqual({ istat_data: null });
    // Nothing is sent twice.
    const again = r.io("2099-07-02T11:00:00");
    expect(await main(["ospiti", "istat", "--mese", "2099-06", "--applica"], again)).toBe(0);
    expect(again.lines.join("\n")).toMatch(/already accepted/);
    expect(r.ross.calls).toHaveLength(1);
  });

  it("keeps the record when Alloggiati Web erases the guests", async () => {
    const r = await ready({ region: "lazio", code: "ZZ0001P" });
    await withGuests(r);
    const db = r.db;
    // The record is made (as "ospiti invia --applica" does after an accepted Send), then Alloggiati Web's retention erases the guests.
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], r.io("2099-06-11T09:00:00"))).toBe(0);
    expect(await main(["ospiti", "inviato", r.stay.id], r.io("2099-06-11T09:10:00"))).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT istat_data IS NOT NULL AS kept FROM guest_stays").get()).toEqual({ kept: 1 });
    const t = r.io("2099-07-02T09:00:00");
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/2 arrivals, 2 departures/);
  });

  it("reminds the previous month in the first days", async () => {
    const r = await ready({ region: "lazio", code: "ZZ0001P" });
    const t = r.io("2099-07-03T09:00:00");
    await main(["ospiti"], t);
    expect(t.lines.join("\n")).toMatch(/Istat Lazio \(casa-istat\): 30 days of 2099-06 not sent yet, within the month after the arrival: fairnight ospiti istat --mese 2099-06 --applica/);
  });
});

describe("an erasure on request", () => {
  it("takes the Istat record too", async () => {
    const r = await ready({ region: "lazio", code: "ZZ0001P" });
    await withGuests(r);
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], r.io("2099-06-11T09:00:00"))).toBe(0);
    expect(await main(["ospiti", "cancella", r.stay.id, "--applica"], r.io("2099-06-11T09:10:00"))).toBe(0);
    expect(r.db.prepare("SELECT istat_data FROM guest_stays").get()).toEqual({ istat_data: null });
  });
});

describe("fairnight ospiti istat, other regions", () => {
  it("Trento: the CSV of the month", async () => {
    const r = await ready({ region: "trento", code: "022001-AT-000000" });
    await withGuests(r);
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], r.io("2099-07-02T09:00:00"))).toBe(0);
    const csv = readFileSync(path.join(r.dir, "data", "fairguest", "istat", "istat-trento-casa-istat-2099-06.csv"), "utf8");
    expect(csv.split("\r\n")).toEqual(["022001-AT-000000;20990610;20990612;ZZ;1", "022001-AT-000000;20990610;20990612;DEU;1"]);
  });

  it("Umbria: one C/59 file per day", async () => {
    const r = await ready({ region: "umbria", code: "Casa di Prova" });
    await withGuests(r);
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], r.io("2099-07-02T09:00:00"))).toBe(0);
    const files = readdirSync(path.join(r.dir, "data", "fairguest", "istat", "umbria-casa-istat-2099-06"));
    expect(files).toHaveLength(30);
    expect(files).toContain("10062099.txt");
  });

  it("a region by hand: the month's arrivals and nights by provenance", async () => {
    const r = await ready({ region: "campania", code: "Casa di Prova" });
    await withGuests(r);
    const t = r.io("2099-07-02T09:00:00");
    expect(await main(["ospiti", "istat", "--mese", "2099-06"], t)).toBe(0);
    expect(t.lines.join("\n")).toMatch(/Germania\s+arrivals {3}1 · nights {4}2/);
    expect(t.lines.join("\n")).toMatch(/Nights the listing was occupied: 2\./);
  });
});
