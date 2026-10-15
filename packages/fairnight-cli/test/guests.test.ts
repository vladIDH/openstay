/**
 * Fairguest from the command line and the check-in form. Invented data only:
 * Ospite Prova, document ZZ0000000, stays in 2099.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isLocalAddress } from "../src/guests/checkin.js";
import { LANGS, WORDS } from "../src/guests/i18n.js";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { startServer } from "../src/serve.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

// Local time, so the expected dates do not depend on the computer's time zone.
const NOW = "2099-06-01T09:00:00";
const PASS = "frase segreta di prova";
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const ICAL = "https://cal.example.org/airbnb/casa-prova.ics";

/** The first item, for stays that the test has just created. */
const one = <T>(items: T[]): T => items[0] as T;

const servers: Server[] = [];
const opened: { close(): void; open: boolean }[] = [];
afterEach(async () => {
  for (const d of opened.splice(0)) if (d.open) d.close();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function ics(events: { uid: string; start: string; end: string }[]): string {
  const body = events.map((e) => `BEGIN:VEVENT\r\nDTEND;VALUE=DATE:${e.end}\r\nDTSTART;VALUE=DATE:${e.start}\r\nUID:${e.uid}\r\nSUMMARY:Reserved\r\nEND:VEVENT`).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

const PRICING = { name: "Casa di Prova", currency: "EUR", basePrice: 100, defaultMinStay: 1, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 } } };

async function setUp(options: { country?: "ES" | "ES-CT"; professional?: boolean } = {}) {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const fairguest = {
    country: options.country ?? "ES-CT",
    establishment: "ZZ00000000",
    establishmentName: "Casa di Prova",
    professional: options.professional ?? false,
    checkInTime: "16:00",
    checkOutTime: "10:00",
    rooms: 1,
    internet: true,
  };
  writeFileSync(
    path.join(dir, "fairnight.config.json"),
    JSON.stringify({ listings: [{ name: "casa-prova", calendars: [{ source: "airbnb", url: ICAL }], pricing: PRICING, fairguest }] }, null, 2),
  );
  const fetch = fakeFetch({
    [ICAL]: ics([
      { uid: "prova-1@airbnb.example", start: "20990610", end: "20990613" },
      { uid: "prova-2@airbnb.example", start: "20990701", end: "20990705" },
    ]),
  });
  return { dir, fetch };
}

function io(dir: string, fetch = fakeFetch({}), extra: Partial<TestIo> = {}): TestIo {
  return Object.assign(testIo(dir, fetch, NOW), { scryptCost: FAST, env: { FAIRGUEST_FRASE: PASS }, ...extra });
}

function db(dir: string) {
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  return d;
}

async function ready(options: { country?: "ES" | "ES-CT"; professional?: boolean } = {}) {
  const { dir, fetch } = await setUp(options);
  expect(await main(["ospiti", "attiva"], io(dir))).toBe(0);
  expect(await main(["sync"], io(dir, fetch))).toBe(0);
  const stays = db(dir).prepare("SELECT id, code, source_uid FROM guest_stays ORDER BY check_in").all() as { id: string; code: string; source_uid: string }[];
  return { dir, fetch, stays };
}

const HOLDER = {
  givenName: "Ospite",
  surname1: "Prova",
  surname2: "Esempio",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  docType: "passport",
  docNumber: "ZZ0000000",
  docIssued: "2095-01-10",
  country: "ITA",
  street: "Via di Prova 1",
  postalCode: "00000",
  locality: "Città di Prova",
  email: "ospite.prova@example.com",
  payment: "platform",
};
const CHILD = {
  givenName: "Esempio",
  surname1: "Prova",
  birthDate: "2092-07-01",
  nationality: "ITA",
  country: "ITA",
  street: "Via di Prova 1",
  locality: "Città di Prova",
  phone: "+39 000 000 0000",
  kinship: "child",
};

async function serve(dir: string): Promise<string> {
  const server = await startServer({ dir, io: io(dir), days: 30, port: 0, lan: false });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function postGuest(base: string, code: string, fields: Record<string, string>, lang = "es") {
  const form = await fetch(`${base}/checkin/${code}?lang=${lang}`);
  const t = /name="t" value="([^"]+)"/.exec(await form.text())?.[1] ?? "";
  return fetch(`${base}/checkin/${code}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t, lang, ...fields }).toString(),
  });
}

describe("fairnight ospiti attiva and frase", () => {
  it("asks the passphrase twice without echo and warns that it cannot be recovered", async () => {
    const { dir } = await setUp();
    const asked: { q: string; hidden: boolean }[] = [];
    const answers = [PASS, PASS];
    const t = io(dir, undefined, { env: {}, prompt: async (q, o) => (asked.push({ q, hidden: o.hidden }), answers.shift() as string) });
    expect(await main(["ospiti", "attiva"], t)).toBe(0);
    expect(asked.every((a) => a.hidden)).toBe(true);
    expect(asked).toHaveLength(2);
    expect(t.lines.join("\n")).toMatch(/cannot be opened again: not by you, not by us, not by anyone/);
    const keys = JSON.parse((db(dir).prepare("SELECT value FROM meta WHERE key = 'fairguest_keys'").get() as { value: string }).value);
    expect(keys.publicKey).toBeTruthy();
    expect(JSON.stringify(keys)).not.toContain(PASS);
    expect(await main(["ospiti", "attiva"], io(dir))).toBe(1);
  });

  it("refuses short or mismatched passphrases, and commands before activation", async () => {
    const { dir } = await setUp();
    const short = io(dir, undefined, { env: {}, prompt: async () => "corta" });
    expect(await main(["ospiti", "attiva"], short)).toBe(1);
    expect(short.errors.join("\n")).toMatch(/at least 12 characters/);
    const answers = [PASS, "un'altra frase diversa"];
    const differ = io(dir, undefined, { env: {}, prompt: async () => answers.shift() as string });
    expect(await main(["ospiti", "attiva"], differ)).toBe(1);
    expect(differ.errors.join("\n")).toMatch(/differ/);
    const before = io(dir);
    expect(await main(["ospiti"], before)).toBe(1);
    expect(before.errors.join("\n")).toMatch(/fairnight ospiti attiva/);
  });

  it("changes the passphrase: the old one stops working, the data stays readable", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    expect((await postGuest(base, one(stays).code, HOLDER)).status).toBe(303);
    const next = "nuova frase segreta di prova";
    const answers = [next, next];
    const t = io(dir, undefined, { prompt: async () => answers.shift() as string });
    expect(await main(["ospiti", "frase"], t)).toBe(0);
    expect(t.lines[t.lines.length - 3]).toMatch(/Passphrase changed/);
    const old = io(dir);
    expect(await main(["ospiti", "mostra", one(stays).id], old)).toBe(1);
    expect(old.errors.join("\n")).toMatch(/Wrong passphrase/);
    const ok = io(dir, undefined, { env: { FAIRGUEST_FRASE: next } });
    expect(await main(["ospiti", "mostra", one(stays).id], ok)).toBe(0);
    expect(ok.lines.join("\n")).toContain("1. Ospite Prova Esempio");
  });
});

describe("deadlines and stays", () => {
  it("creates a stay per booking at sync and lists the 24-hour deadlines", async () => {
    const { dir, stays } = await ready();
    expect(stays.map((s) => s.source_uid)).toEqual(["prova-1@airbnb.example", "prova-2@airbnb.example"]);
    const t = io(dir);
    expect(await main(["ospiti"], t)).toBe(0);
    expect(t.lines[0]).toBe("Guest communications · now 2099-06-01 09:00 · Spain: 24 hours from the booking and from check-in (RD 933/2021, art. 6.3)");
    expect(t.lines).toContain(
      `open  due 2099-06-11 16:00  casa-prova  ${one(stays).id}  check-in (PV), stay 2099-06-10 → 2099-06-13, 0 guests registered · in 247 h`,
    );
    expect(t.lines.filter((l) => l.includes("reservation (RH)"))).toHaveLength(2);
  });

  it("marks late communications and exits with 1", async () => {
    const { dir } = await ready();
    const t = io(dir);
    t.setNow("2099-06-02T10:00:00");
    expect(await main(["ospiti", "scadenze"], t)).toBe(1);
    expect(t.lines.filter((l) => l.startsWith("LATE"))).toHaveLength(2);
    expect(t.lines[t.lines.length - 1]).toMatch(/2 communications are late/);
  });

  it("lists the stays with their form links, and adds a stay by hand", async () => {
    const { dir, stays } = await ready();
    const n = io(dir);
    expect(await main(["ospiti", "nuovo", "--listing", "casa-prova", "--da", "2099-08-01", "--a", "2099-08-03"], n)).toBe(0);
    expect(n.lines[0]).toMatch(/^Stay fg[0-9a-f]{10}: casa-prova, 2099-08-01 → 2099-08-03\. Check-in form: \/checkin\/[A-Za-z0-9_-]{16}$/);
    const t = io(dir);
    expect(await main(["ospiti", "elenco"], t)).toBe(0);
    expect(t.lines[0]).toBe(`${one(stays).id}  casa-prova  2099-06-10 → 2099-06-13  from airbnb  0 guests registered  form /checkin/${one(stays).code}`);
    expect(t.lines).toHaveLength(5);
    expect(t.lines[4]).toBe('To send a guest a link that works from anywhere: "fairnight ospiti link <stay>".');
  });

  it("marks a booking that disappears from the calendar as cancelled", async () => {
    const { dir, fetch } = await ready();
    fetch.set(ICAL, ics([{ uid: "prova-2@airbnb.example", start: "20990701", end: "20990705" }]));
    const s = io(dir, fetch);
    expect(await main(["sync"], s)).toBe(0);
    expect(s.lines).toContain("Fairguest: 1 booking cancelled.");
    const row = db(dir).prepare("SELECT cancelled_at FROM guest_stays WHERE source_uid = 'prova-1@airbnb.example'").get() as { cancelled_at: string };
    expect(row.cancelled_at).toBe("2099-06-01T09:00");
  });
});

describe("check-in form", () => {
  it("opens only from the local network and never through a proxy", async () => {
    expect(isLocalAddress("127.0.0.1")).toBe(true);
    expect(isLocalAddress("::ffff:192.168.1.20")).toBe(true);
    expect(isLocalAddress("10.0.0.5")).toBe(true);
    expect(isLocalAddress("172.20.1.1")).toBe(true);
    expect(isLocalAddress("fe80::1")).toBe(true);
    expect(isLocalAddress("fd00::1")).toBe(true);
    expect(isLocalAddress("172.32.0.1")).toBe(false);
    expect(isLocalAddress("8.8.8.8")).toBe(false);
    expect(isLocalAddress("2001:db8::1")).toBe(false);
    const { dir, stays } = await ready();
    const base = await serve(dir);
    const proxied = await fetch(`${base}/checkin/${one(stays).code}`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(proxied.status).toBe(403);
    expect(await proxied.text()).not.toContain("Casa di Prova");
  });

  it("shows the stay in the guest's language, with no script and only the payment type", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    const res = await fetch(`${base}/checkin/${one(stays).code}`, { headers: { "accept-language": "it-IT,it;q=0.9" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    const html = await res.text();
    expect(html).toContain('<html lang="it">');
    expect(html).toContain("Casa di Prova");
    expect(html).toContain("10 giugno 2099 → 13 giugno 2099");
    expect(html).toContain("Ospite 1 (chi ha prenotato)");
    // Three steps on screen, and one line on what really happens to the data.
    expect(html).toContain('<li aria-current="step">1 · I tuoi dati</li>');
    expect(html).toContain("I tuoi dati restano cifrati sul computer dell&#39;host, vanno solo alla polizia e si cancellano da soli appena la legge lo permette.");
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).not.toContain("<script");
    expect(html).toMatch(/name="payment"/);
    expect(html).not.toMatch(/name="[^"]*(card|iban|account|expir)[^"]*"/i);
    const es = await (await fetch(`${base}/checkin/${one(stays).code}?lang=es`)).text();
    expect(es).toContain("Registro de viajeros");
    const en = await (await fetch(`${base}/checkin/${one(stays).code}?lang=en`)).text();
    expect(en).toContain("Guest registration");
  });

  it("refuses unknown and expired codes the same way", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    expect((await fetch(`${base}/checkin/nonexistentcode00`)).status).toBe(404);
    const t = io(dir);
    t.setNow("2099-06-14T09:00:00");
    const later = await startServer({ dir, io: t, days: 30, port: 0, lan: false });
    servers.push(later);
    const port = (later.address() as { port: number }).port;
    expect((await fetch(`http://127.0.0.1:${port}/checkin/${one(stays).code}`)).status).toBe(404);
  });

  it("saves a guest sealed, ignores card numbers, and reports what is missing", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    const bad = await postGuest(base, one(stays).code, { ...HOLDER, docNumber: "", email: "", payment: "" });
    expect(bad.status).toBe(422);
    const html = await bad.text();
    expect(html).toContain("Revise los campos marcados.");
    expect(html).toContain("Indique un teléfono o un correo electrónico");
    expect(html).toContain('value="Ospite"');
    // A message for the kind of field, next to it.
    const wrong = await postGuest(base, one(stays).code, { ...HOLDER, docSupport: "123", email: "not-an-address" });
    const wrongHtml = await wrong.text();
    expect(wrongHtml).toContain('<div class="err" id="docSupport-err">El número de soporte tiene exactamente 9 letras y cifras.</div>');
    expect(wrongHtml).toContain('<div class="err" id="email-err">Escriba una dirección completa, como nombre@ejemplo.es.</div>');
    expect(wrongHtml).toContain('aria-invalid="true" aria-describedby="email-err"');
    // A missing name is shown on the name, never on the phone: there only the missing contact.
    const noName = await (await postGuest(base, one(stays).code, { ...HOLDER, surname1: "", email: "" })).text();
    expect(noName).toContain('<div class="err" id="surname1-err">Obligatorio</div>');
    expect(noName).toContain('<div class="err" id="phone-err">Indique un teléfono o un correo electrónico</div>');

    const ok = await postGuest(base, one(stays).code, { ...HOLDER, cardNumber: "0000 0000 0000 0000", iban: "ZZ00 0000 0000" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe(`/checkin/${one(stays).code}?lang=es&saved=1`);
    const row = db(dir).prepare("SELECT data, added_by FROM guest_people").get() as { data: string; added_by: string };
    expect(row.added_by).toBe("form");
    for (const secret of ["Ospite", "ZZ0000000", "example.com", "0000 0000", "platform"]) expect(row.data).not.toContain(secret);
    const after = await (await fetch(`${base}${ok.headers.get("location")}`)).text();
    expect(after).toContain("Viajero 1 guardado.");
    expect(after).toContain("<h2>Viajero 1 guardado.</h2><p>Si ya están todos, puede cerrar esta página.</p>");
    expect(after).toContain('<li aria-current="step">3 · Confirmación</li>');
    // The form for the next guest is there, folded under "Añadir otro viajero".
    expect(after).toContain('<details class="another"><summary>Añadir otro viajero</summary>');
    expect(after).toContain("Viajero 2");

    const t = io(dir);
    expect(await main(["ospiti", "esporta", one(stays).id], t)).toBe(0);
    const exported = JSON.parse(t.lines.join("\n"));
    expect(exported.guests[0]).toEqual({
      givenName: "Ospite",
      surname1: "Prova",
      surname2: "Esempio",
      birthDate: "2060-03-15",
      sex: "female",
      nationality: "ITA",
      document: { type: "passport", number: "ZZ0000000", issuedOn: "2095-01-10" },
      address: { country: "ITA", street: "Via di Prova 1", locality: "Città di Prova", postalCode: "00000" },
      email: "ospite.prova@example.com",
    });
    expect(exported.stay.payment).toBe("platform");
    expect(JSON.stringify(exported)).not.toMatch(/0000 0000|iban|cardNumber/);
  });

  it("refuses a post without the form's token", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    const res = await fetch(`${base}/checkin/${one(stays).code}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(HOLDER).toString(),
    });
    expect(res.status).toBe(403);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 0 });
  });
});

describe("prepare, confirm, retention", () => {
  it("Catalonia: writes the Mossos file, deletes it after the upload, then erases the data of a non-professional host", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    const id = one(stays).id;
    expect((await postGuest(base, one(stays).code, HOLDER)).status).toBe(303);

    expect((await postGuest(base, one(stays).code, CHILD)).status).toBe(303);
    // Three people announced, two registered: nothing is written.
    expect(await main(["ospiti", "correggi", id, "persone"], io(dir, undefined, { prompt: async () => "3" }))).toBe(0);
    const missing = io(dir);
    expect(await main(["ospiti", "prepara", id], missing)).toBe(1);
    expect(missing.lines).toContain("  - guests: 2 of 3 guests registered");
    expect(missing.lines[missing.lines.length - 1]).toMatch(/No file was written/);
    expect(await main(["ospiti", "correggi", id, "persone"], io(dir, undefined, { prompt: async () => "" }))).toBe(0);

    const t = io(dir);
    expect(await main(["ospiti", "prepara", id], t)).toBe(0);
    const file = path.join(dir, "data", "fairguest", "ZZ00000000.001");
    expect(t.lines[0]).toBe(`Wrote ${file}: 2 traveller lines, check-in (PV), establishment ZZ00000000.`);
    const text = readFileSync(file).toString("latin1");
    expect(text.split("\r\n")).toEqual([
      "1|ZZ00000000|CASA DI PROVA|20990601|0900|2|V24",
      "2||ZZ0000000|P|20950110|PROVA|ESEMPIO|OSPITE|F|20600315|ITA|20990610|1600|20990613|1000|20990601|C|" +
        `${id.toUpperCase()}|2|1|S|PLATF|||ospite.prova@example.com||VIA DI PROVA 1|||CITTÀ DI PROVA|ITA|00000|`,
      `2|||||PROVA||ESEMPIO||20920701|ITA|20990610|1600|20990613|1000|20990601|C|${id.toUpperCase()}|2|1|S|PLATF|+39 000 000 0000|HJ|||VIA DI PROVA 1|||CITTÀ DI PROVA|ITA||`,
    ]);

    const again = io(dir);
    expect(await main(["ospiti", "prepara", id], again)).toBe(0);
    expect(existsSync(path.join(dir, "data", "fairguest", "ZZ00000000.002"))).toBe(true);

    const sent = io(dir);
    expect(await main(["ospiti", "inviato", id, "--tipo", "checkin"], sent)).toBe(0);
    expect(sent.lines[0]).toBe(`Stay ${id}: check-in (PV) recorded as done on 2099-06-01 09:00.`);
    expect(sent.lines[1]).toMatch(new RegExp(`^Erased the personal data of stay ${id}: non-professional host`));
    expect(existsSync(file)).toBe(false);
    expect(existsSync(path.join(dir, "data", "fairguest", "ZZ00000000.002"))).toBe(false);
    const d = db(dir);
    expect(d.prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 0 });
    expect(d.prepare("SELECT code, channel_data, host_data, erased_at FROM guest_stays WHERE id = ?").get(id)).toEqual({
      code: null,
      channel_data: null,
      host_data: null,
      erased_at: "2099-06-01T09:00",
    });
    const shown = io(dir);
    expect(await main(["ospiti", "mostra", id], shown)).toBe(1);
    expect(shown.errors[0]).toMatch(/was erased/);
  });

  it("Spain (SES): prepare says what is missing and writes nothing (more in guests-ses.test.ts)", async () => {
    const { dir, stays } = await ready({ country: "ES" });
    const t = io(dir, undefined, { sesSchema: null });
    expect(await main(["ospiti", "prepara", one(stays).id], t)).toBe(1);
    expect(t.lines.join("\n")).toMatch(/the parte de viajeros \(PV\) cannot be made yet/);
    expect(t.lines.join("\n")).toMatch(/Nothing was written/);
  });

  it("professional host: keeps the data 3 years after check-out, then erases it", async () => {
    const { dir, stays } = await ready({ professional: true });
    const base = await serve(dir);
    expect((await postGuest(base, one(stays).code, HOLDER)).status).toBe(303);
    expect(await main(["ospiti", "inviato", one(stays).id, "--tipo", "checkin"], io(dir))).toBe(0);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 1 });
    const t = io(dir);
    t.setNow("2102-06-13T00:30:00");
    expect(await main(["ospiti", "pulisci"], t)).toBe(0);
    expect(t.lines[0]).toMatch(new RegExp(`^Erased the personal data of stay ${one(stays).id}: professional host`));
    expect(t.lines).toContain("Backups of data/fairnight.db are not touched: erasing works only on this file.");
  });
});

describe("requests of a guest", () => {
  it("erases on request only with --applica, one guest or the whole stay", async () => {
    const { dir, stays } = await ready();
    const base = await serve(dir);
    expect((await postGuest(base, one(stays).code, HOLDER)).status).toBe(303);
    expect((await postGuest(base, one(stays).code, CHILD)).status).toBe(303);
    const dry = io(dir);
    expect(await main(["ospiti", "cancella", one(stays).id, "--persona", "2"], dry)).toBe(0);
    expect(dry.lines[0]).toBe(`Would erase guest 2 of stay ${one(stays).id}. Nothing was erased: add --applica to do it. It cannot be undone.`);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 2 });
    expect(await main(["ospiti", "cancella", one(stays).id, "--persona", "2", "--applica"], io(dir))).toBe(0);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 1 });

    const single = io(dir);
    expect(await main(["ospiti", "esporta", one(stays).id, "--persona", "1"], single)).toBe(0);
    expect(JSON.parse(single.lines.join("\n")).guests).toHaveLength(1);

    expect(await main(["ospiti", "cancella", one(stays).id, "--applica"], io(dir))).toBe(0);
    expect(db(dir).prepare("SELECT COUNT(*) AS n FROM guest_people").get()).toEqual({ n: 0 });
  });

  it("corrects a field asking for the value, never on the command line", async () => {
    const { dir, stays } = await ready();
    const asked: string[] = [];
    const t = io(dir, undefined, { prompt: async (q) => (asked.push(q), "cash") });
    expect(await main(["ospiti", "correggi", one(stays).id, "pagamento"], t)).toBe(0);
    expect(asked[0]).toMatch(/^New value for pagamento \(platform, card, cash/);
    const bad = io(dir, undefined, { prompt: async () => "0000 0000 0000 0000" });
    expect(await main(["ospiti", "correggi", one(stays).id, "pagamento"], bad)).toBe(1);
    expect(bad.errors[0]).toMatch(/Never a card number or an IBAN/);
    const shown = io(dir);
    expect(await main(["ospiti", "mostra", one(stays).id], shown)).toBe(0);
    expect(shown.lines[1]).toMatch(/payment cash/);
  });
});

describe("words of the check-in form", () => {
  it("has the steps, the privacy line and a message for each kind of field in every language", () => {
    const fields = Object.keys(WORDS.es.invalidFor).sort();
    for (const l of LANGS) {
      const w = WORDS[l];
      expect(Object.keys(w.invalidFor).sort(), l).toEqual(fields);
      for (const text of [w.steps.data, w.steps.document, w.steps.confirm, w.privacyShort, w.saved(1), w.stepLabel(1), ...Object.values(w.invalidFor)]) {
        expect(text.trim(), l).not.toBe("");
      }
    }
  });
});
