/**
 * Fairguest in Italy (Alloggiati Web) from the command line and the check-in
 * form. Invented data only: Ospite Prova, document ZZ0000000, stays in 2099,
 * code tables with invented codes, and a fake Alloggiati Web service that
 * answers like the examples of the manual. Nothing reaches the real service.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import type { SmoobuFetchLike } from "../src/io.js";
import { main } from "../src/main.js";
import { loadHostConfig } from "../src/config.js";
import { pricesPayload, startServer } from "../src/serve.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

const PASS = "frase segreta di prova";
/** A terminal: the passphrase still comes from FAIRGUEST_FRASE, but someone is there. */
const term = { prompt: async () => "" };
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const ICAL = "https://cal.example.org/airbnb/casa-prova-it.ics";
const ARRIVAL_DAY = "2099-06-10T18:00:00";

const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
const TABLE_URLS = {
  municipalities: "https://tabelle.example.invalid/comuni.csv",
  states: "https://tabelle.example.invalid/stati.csv",
  documents: "https://tabelle.example.invalid/documenti.csv",
};
const TABLES = {
  [TABLE_URLS.municipalities]: ["Codice,Descrizione,Provincia,DataFineVal", "900000001,BORGO DI PROVA,ZZ,", "900000002,SANT'ESEMPIO,ZZ,", ...many(1000, (i) => `${910000000 + i},RIEMPITIVO ${i},ZX,`)].join(
    "\r\n",
  ),
  [TABLE_URLS.states]: ["Codice,Descrizione,Provincia,DataFineVal", "100000100,ITALIA,ES,", "100000239,SPAGNA,ES,", ...many(100, (i) => `${190000000 + i},RIEMPITIVO ${i},ES,`)].join("\r\n"),
  [TABLE_URLS.documents]: ["Codice,Descrizione", "IDENT,CARTA DI IDENTITA'", "IDELE,CARTA IDENTITA' ELETTRONICA", "PASOR,PASSAPORTO ORDINARIO"].join("\r\n"),
};

const servers: Server[] = [];
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) if (d.open) d.close();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const ics = (start: string, end: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nBEGIN:VEVENT\r\nDTEND;VALUE=DATE:${end}\r\nDTSTART;VALUE=DATE:${start}\r\nUID:prova-it-1@airbnb.example\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

const ok = "<esito>true</esito><ErroreCod /><ErroreDes /><ErroreDettaglio />";
const env = (inner: string) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>${inner}</soap:Body></soap:Envelope>`;

/** A fake Alloggiati Web: records every call; refuses lines whose arrival is not today or yesterday. */
function fakeAlloggiati(today: string) {
  const calls: { method: string; body: string }[] = [];
  const fetchFn: SmoobuFetchLike = async (_url, init) => {
    const method = /action="AlloggiatiService\/(\w+)"/.exec(init.headers["content-type"] ?? "")?.[1] ?? "";
    calls.push({ method, body: init.body ?? "" });
    let body: string;
    if (method === "GenerateToken") {
      body = /<all:Password>pass-0000-not-real<\/all:Password>/.test(init.body ?? "")
        ? env(`<GenerateTokenResponse xmlns="AlloggiatiService"><GenerateTokenResult><expires>2099-06-10T19:00:00+02:00</expires><token>TOKEN-PROVA</token></GenerateTokenResult><result>${ok}</result></GenerateTokenResponse>`)
        : env(`<GenerateTokenResponse xmlns="AlloggiatiService"><result><esito>false</esito><ErroreCod>4</ErroreCod><ErroreDes>AUTENTICAZIONE</ErroreDes><ErroreDettaglio /></result></GenerateTokenResponse>`);
    } else if (method === "Authentication_Test") {
      body = env(`<Authentication_TestResponse xmlns="AlloggiatiService"><Authentication_TestResult>${ok}</Authentication_TestResult></Authentication_TestResponse>`);
    } else if (method === "Test" || method === "Send") {
      const lines = [...(init.body ?? "").matchAll(/<all:string>([^<]*)<\/all:string>/g)].map((m) => m[1] as string);
      const day = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`;
      const each = lines.map((l) =>
        l.length === 168 && l.slice(2, 12) === day
          ? `<EsitoOperazioneServizio>${ok}</EsitoOperazioneServizio>`
          : "<EsitoOperazioneServizio><esito>false</esito><ErroreCod>12</ErroreCod><ErroreDes>SCHEDINA_CAMPO_NON_CORRETTO</ErroreDes><ErroreDettaglio>Data di Arrivo Errata</ErroreDettaglio></EsitoOperazioneServizio>",
      );
      const valid = each.filter((e) => e.includes("<esito>true")).length;
      body = env(`<${method}Response xmlns="AlloggiatiService"><${method}Result>${ok}</${method}Result><result><SchedineValide>${valid}</SchedineValide><Dettaglio>${each.join("")}</Dettaglio></result></${method}Response>`);
    } else if (method === "Ricevuta") {
      body = env(`<RicevutaResponse xmlns="AlloggiatiService"><RicevutaResult>${ok}</RicevutaResult><PDF>${Buffer.from("%PDF-ricevuta-di-prova").toString("base64")}</PDF></RicevutaResponse>`);
    } else body = env(`<soap:Fault><soap:Reason><soap:Text>metodo sconosciuto</soap:Text></soap:Reason></soap:Fault>`);
    return { status: body.includes("Fault") ? 500 : 200, headers: { get: () => null }, text: async () => body };
  };
  return { fetchFn, calls };
}

async function setUp(alloggiati: Record<string, unknown> = {}, dates: [string, string] = ["20990610", "20990613"]) {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const fairguest = { country: "IT", establishment: "ZZ00000000", checkInTime: "16:00", checkOutTime: "10:00", alloggiati };
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify(
      {
        listings: [
          {
            name: "casa-prova",
            calendars: [{ source: "airbnb", url: ICAL }],
            pricing: { name: "Casa di Prova", currency: "EUR", basePrice: 100, defaultMinStay: 1, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 } } },
            fairguest,
          },
        ],
      },
      null,
      2,
    ),
  );
  return { dir, fetch: fakeFetch({ [ICAL]: ics(...dates), ...TABLES }) };
}

function io(dir: string, extra: Partial<TestIo> = {}, now = ARRIVAL_DAY, fetch = fakeFetch(TABLES)): TestIo {
  const service = fakeAlloggiati(now.slice(0, 10));
  return Object.assign(testIo(dir, fetch, now), {
    scryptCost: FAST,
    env: { FAIRGUEST_FRASE: PASS },
    alloggiatiTableUrls: TABLE_URLS,
    alloggiatiUrl: "https://alloggiati.example.invalid/service.asmx",
    alloggiatiFetch: service.fetchFn,
    service,
    ...extra,
  });
}

function db(dir: string) {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

async function ready(alloggiati: Record<string, unknown> = {}) {
  const { dir, fetch } = await setUp(alloggiati);
  const first = io(dir, {}, "2099-06-01T09:00:00", fetch);
  expect(await main(["ospiti", "attiva"], first)).toBe(0);
  expect(first.lines.join("\n")).toMatch(/Downloaded the Alloggiati Web code tables/);
  expect(await main(["sync"], io(dir, {}, "2099-06-01T09:00:00", fetch))).toBe(0);
  const stay = db(dir).prepare("SELECT id, code FROM guest_stays").get() as { id: string; code: string };
  return { dir, stay };
}

async function serve(dir: string): Promise<string> {
  const server = await startServer({ dir, io: io(dir, {}, "2099-06-01T09:00:00"), days: 30, port: 0, lan: false });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function postGuest(base: string, code: string, fields: Record<string, string>, lang = "it") {
  const form = await fetch(`${base}/checkin/${code}?lang=${lang}`);
  const t = /name="t" value="([^"]+)"/.exec(await form.text())?.[1] ?? "";
  return fetch(`${base}/checkin/${code}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t, lang, ...fields }).toString(),
  });
}

const HOLDER = {
  givenName: "Ospite",
  surname1: "Prova",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  birthCountry: "ITA",
  birthPlace: "Borgo di Prova",
  docType: "electronic_id",
  docNumber: "ZZ0000000",
  docCountry: "ITA",
  docPlace: "Sant'Esempio",
};
const CHILD = { givenName: "Esempio", surname1: "Prova", birthDate: "2092-07-01", sex: "male", nationality: "ESP", birthCountry: "ESP", kinship: "child" };

async function withGuests() {
  const r = await ready();
  const base = await serve(r.dir);
  expect((await postGuest(base, r.stay.code, HOLDER)).status).toBe(303);
  expect((await postGuest(base, r.stay.code, CHILD)).status).toBe(303);
  return r;
}

/** Save credentials through the hidden prompts. */
async function saveCredentials(dir: string, password = "pass-0000-not-real") {
  const answers = ["ZZ000000", password, "key-0000-not-real"];
  const asked: { q: string; hidden: boolean }[] = [];
  const t = io(dir, { prompt: async (q, o) => (asked.push({ q, hidden: o.hidden }), answers.shift() as string) });
  expect(await main(["ospiti", "credenziali"], t)).toBe(0);
  return { t, asked };
}

describe("the check-in form for a listing in Italy", () => {
  it("asks for the places of birth and of issue, and nothing about address, contact or payment", async () => {
    const { dir, stay } = await ready();
    const base = await serve(dir);
    const html = await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text();
    expect(html).toContain("Alloggiati Web");
    expect(html).toContain('name="birthCountry"');
    expect(html).toContain('name="docPlace"');
    expect(html).toContain("Carta d&#39;identità elettronica (CIE)");
    expect(html).not.toContain('name="street"');
    expect(html).not.toContain('name="payment"');
    expect(html).not.toContain('name="docSupport"');
    expect(html).not.toContain("NIE");
    expect(html).not.toContain('value="other"');
  });

  it("needs the municipality of birth for someone born in Italy; the second guest gives no document", async () => {
    const { dir, stay } = await ready();
    const base = await serve(dir);
    const bad = await postGuest(base, stay.code, { ...HOLDER, birthPlace: "" });
    expect(bad.status).toBe(422);
    expect(await bad.text()).toMatch(/id="birthPlace-err">Obbligatorio/);
    expect((await postGuest(base, stay.code, HOLDER)).status).toBe(303);
    const second = await (await fetch(`${base}/checkin/${stay.code}?lang=it`)).text();
    expect(second).toContain("il documento non serve");
    expect((await postGuest(base, stay.code, CHILD)).status).toBe(303);
    expect((db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get() as { n: number }).n).toBe(2);
  });
});

describe("fairnight ospiti credenziali", () => {
  it("asks password and key without echo and keeps them sealed", async () => {
    const { dir } = await ready();
    const { asked } = await saveCredentials(dir);
    expect(asked.map((a) => a.hidden)).toEqual([false, true, true]);
    const raw = (db(dir).prepare("SELECT value FROM meta WHERE key = 'fairguest_alloggiati_principale'").get() as { value: string }).value;
    expect(raw.startsWith("fg1.")).toBe(true);
    expect(raw).not.toContain("pass-0000-not-real");
    expect(raw).not.toContain("ZZ000000");
  });

  it("checks them with the service only with --verifica, sending no schedina", async () => {
    const { dir } = await ready();
    await saveCredentials(dir);
    const t = io(dir);
    expect(await main(["ospiti", "credenziali", "--verifica"], t)).toBe(0);
    expect((t as TestIo & { service: { calls: { method: string }[] } }).service.calls.map((c) => c.method)).toEqual(["GenerateToken", "Authentication_Test"]);
    expect(t.lines.join("\n")).toMatch(/accepted the credentials.*Nothing was sent/);
  });
});

describe("fairnight ospiti invia", () => {
  it("does not send before the host recognized the guests", async () => {
    const { dir } = await withGuests();
    await saveCredentials(dir);
    const t = io(dir, term);
    expect(await main(["ospiti", "invia", "--applica"], t)).toBe(1);
    expect(t.lines.join("\n")).toMatch(/not recognized yet/);
    expect((t as TestIo & { service: { calls: unknown[] } }).service.calls).toEqual([]);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_submissions").get()).toEqual({ n: 0 });
  });

  it("without --prova or --applica shows what is ready and sends nothing", async () => {
    const { dir, stay } = await withGuests();
    expect(await main(["ospiti", "riconosciuto", stay.id], io(dir))).toBe(0);
    const t = io(dir);
    expect(await main(["ospiti", "invia"], t)).toBe(0);
    expect(t.lines.join("\n")).toContain(`${stay.id} (casa-prova, arrival 2099-06-10): 2 schedine ready`);
    expect(t.lines.join("\n")).toMatch(/Nothing was sent/);
    expect((t as TestIo & { service: { calls: unknown[] } }).service.calls).toEqual([]);
  });

  it("--prova asks the service to check them and records nothing", async () => {
    const { dir, stay } = await withGuests();
    await saveCredentials(dir);
    await main(["ospiti", "riconosciuto", stay.id], io(dir));
    const t = io(dir, term);
    expect(await main(["ospiti", "invia", "--prova"], t)).toBe(0);
    expect((t as TestIo & { service: { calls: { method: string }[] } }).service.calls.map((c) => c.method)).toEqual(["GenerateToken", "Test"]);
    expect(t.lines.join("\n")).toMatch(/checked 2 schedine: correct. Not sent/);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 2 });
  });

  it("--applica checks, sends, records the outcome and erases the guests' data at once", async () => {
    const { dir, stay } = await withGuests();
    await saveCredentials(dir);
    await main(["ospiti", "riconosciuto", stay.id], io(dir));
    const t = io(dir, term);
    expect(await main(["ospiti", "invia", "--applica"], t)).toBe(0);
    const calls = (t as TestIo & { service: { calls: { method: string; body: string }[] } }).service.calls;
    expect(calls.map((c) => c.method)).toEqual(["GenerateToken", "Test", "Send"]);
    // Holder 17 with document, child 19 without.
    const lines = [...(calls[2]?.body ?? "").matchAll(/<all:string>([^<]*)<\/all:string>/g)].map((m) => m[1] as string);
    expect(lines.map((l) => l.slice(0, 2))).toEqual(["17", "19"]);
    expect(lines[0]?.slice(134, 139)).toBe("IDELE");
    expect(t.lines.join("\n")).toMatch(/sent to Alloggiati Web, 2 schedine accepted/);
    expect(t.lines.join("\n")).toMatch(/Erased the personal data/);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 0 });
    expect(db(dir).prepare("SELECT kind, channel, status, batch, detail FROM guest_submissions").all()).toEqual([
      { kind: "checkin", channel: "alloggiati-web", status: "accepted", batch: "principale", detail: "2 schedine accepted" },
    ]);
    // Never twice.
    const again = io(dir, term);
    expect(await main(["ospiti", "invia", "--applica"], again)).toBe(0);
    expect(again.lines.join("\n")).toMatch(/Nothing to send/);
    expect((again as TestIo & { service: { calls: unknown[] } }).service.calls).toEqual([]);
  });

  it("downloads the receipt from the next day and keeps it", async () => {
    const { dir, stay } = await withGuests();
    await saveCredentials(dir);
    await main(["ospiti", "riconosciuto", stay.id], io(dir));
    expect(await main(["ospiti", "invia", "--applica"], io(dir, term))).toBe(0);
    const sameDay = io(dir);
    expect(await main(["ospiti", "ricevute"], sameDay)).toBe(0);
    expect(sameDay.lines.join("\n")).toMatch(/No Alloggiati Web receipt to download/);
    const next = io(dir, {}, "2099-06-11T09:00:00");
    expect(await main(["ospiti", "ricevute"], next)).toBe(0);
    const file = path.join(dir, "data", "fairguest", "ricevute", "alloggiati-principale-2099-06-10.pdf");
    expect(readFileSync(file, "utf8")).toBe("%PDF-ricevuta-di-prova");
    expect(db(dir).prepare("SELECT account, day FROM guest_receipts").all()).toEqual([{ account: "principale", day: "2099-06-10" }]);
    // Five years later it is deleted by itself.
    const later = io(dir, {}, "2104-06-10T09:00:00");
    expect(await main(["ospiti", "pulisci"], later)).toBe(0);
    expect(later.lines.join("\n")).toMatch(/Deleted the Alloggiati Web receipt principale 2099-06-10/);
    expect(existsSync(file)).toBe(false);
  });

  it("without a terminal sends only for listings with autoSend", async () => {
    const { dir, stay } = await withGuests();
    await saveCredentials(dir);
    await main(["ospiti", "riconosciuto", stay.id], io(dir));
    const t = io(dir);
    expect(await main(["ospiti", "invia", "--applica"], t)).toBe(1);
    expect(t.errors.join("\n")).toMatch(/Sending without a terminal is off for casa-prova/);
  });

  it("says when an arrival is too old for the web service", async () => {
    const { dir, stay } = await withGuests();
    const t = io(dir, {}, "2099-06-12T09:00:00");
    expect(await main(["ospiti", "invia"], t)).toBe(0);
    expect(t.lines.join("\n")).toContain(`${stay.id}: arrived 2099-06-10, too late for the web service`);
  });
});

describe("fairnight ospiti correggi for Italy", () => {
  it("changes a place three levels deep, like the municipality that issued the document", async () => {
    const { dir, stay } = await withGuests();
    const t = io(dir, { prompt: async () => "Borgo di Prova" });
    expect(await main(["ospiti", "correggi", stay.id, "document.issuedIn.locality", "--persona", "1"], t)).toBe(0);
    const show = io(dir);
    await main(["ospiti", "esporta", stay.id, "--persona", "1"], show);
    expect(JSON.parse(show.lines.join(String.fromCharCode(10))).guests[0].document.issuedIn).toEqual({ country: "ITA", locality: "Borgo di Prova" });
  });
});

describe("fairnight ospiti prepara for Italy", () => {
  it("writes the file for the portal, 168 characters per line", async () => {
    const { dir, stay } = await withGuests();
    await main(["ospiti", "riconosciuto", stay.id], io(dir));
    const t = io(dir);
    expect(await main(["ospiti", "prepara", stay.id], t)).toBe(0);
    const file = /Wrote (.+\.txt):/.exec(t.lines.join("\n"))?.[1] as string;
    const lines = readFileSync(file, "utf8").split("\r\n");
    expect(lines.map((l) => l.length)).toEqual([168, 168]);
    expect(await main(["ospiti", "inviato", stay.id], io(dir))).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a booking communication: Italy has none", async () => {
    const { dir, stay } = await withGuests();
    const t = io(dir);
    expect(await main(["ospiti", "inviato", stay.id, "--tipo", "prenotazione"], t)).toBe(2);
  });
});

describe("deadlines for Italy", () => {
  it("lists only the guests' communication, 24 hours from arrival", async () => {
    const { dir, stay } = await ready();
    const t = io(dir, {}, "2099-06-01T09:00:00");
    expect(await main(["ospiti"], t)).toBe(0);
    expect(t.lines[0]).toContain("Italy: 24 hours from arrival, 6 for a stay of 24 hours or less (art. 109 TULPS)");
    expect(t.lines.filter((l) => l.includes(stay.id))).toEqual([expect.stringContaining("due 2099-06-11 16:00")]);
  });
});

describe("the reminder on the calendar page", () => {
  it("says how many communications are due within 24 hours or late, and the command for Italy, never who", async () => {
    const { dir } = await ready();
    expect(pricesPayload(dir, loadHostConfig(dir), "2099-06-01", 1, { now: new Date("2099-06-01T09:00:00") }).guests).toBeNull();
    expect(pricesPayload(dir, loadHostConfig(dir), "2099-06-10", 1, { now: new Date(ARRIVAL_DAY) }).guests).toEqual({ late: 0, soon: 1, italy: true });
    expect(pricesPayload(dir, loadHostConfig(dir), "2099-06-12", 1, { now: new Date("2099-06-12T09:00:00") }).guests).toEqual({ late: 1, soon: 0, italy: true });
  });
});
