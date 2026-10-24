/**
 * Fairguest in Spain through the SES.HOSPEDAJES web service, from the command
 * line. Invented data only (Lucía Prueba, DNI 00000000T, stays in 2099), a fake
 * SES service and FAKE schema values: the real XML is switched on only from the
 * Ministry's XSD. Nothing reaches the Ministry, not even its test service.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { SES_SCHEMA_DRAFT, type Guest, type SesSchema } from "fairguest";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import type { SmoobuFetchLike } from "../src/io.js";
import { main } from "../src/main.js";
import { addPerson } from "../src/guests/store.js";
import { fakeFetch, tempDir, testIo, type TestIo } from "./helpers.js";

const PASS = "frase segreta di prova";
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const ICAL = "https://cal.example.org/airbnb/casa-prueba.ics";
const ARRIVAL = "2099-06-10T18:00:00";
const URLS = { test: "https://pre-ses.example.invalid/comunicacion", production: "https://ses.example.invalid/comunicacion" };
const USER = { user: "usuario-prueba", password: "clave-0000-not-real" };
/** The draft values, ONLY against the fake service. */
const FAKE_SCHEMA: SesSchema = { ...SES_SCHEMA_DRAFT, verifiedOn: "fake, tests only" };

const opened: { close(): void; open: boolean }[] = [];
afterEach(() => {
  for (const d of opened.splice(0)) if (d.open) d.close();
});

const guest = (): Guest => ({
  givenName: "Lucía",
  surname1: "Prueba",
  surname2: "Ejemplo",
  birthDate: "2060-07-02",
  sex: "female",
  nationality: "ESP",
  document: { type: "dni", number: "00000000T", support: "ZZZ000000" },
  address: { country: "ESP", street: "Calle de Prueba 1", locality: "Adeje", postalCode: "38670", municipalityCode: "380017" },
  phone: "+34 600 000 000",
});

const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nBEGIN:VEVENT\r\nDTEND;VALUE=DATE:20990613\r\nDTSTART;VALUE=DATE:20990610\r\nUID:prueba-1@airbnb.example\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

/** A fake SES: checks HTTP Basic, unzips what it gets, answers a batch number; consultaLote answers what the test says. */
function fakeSes() {
  const state = {
    calls: [] as { url: string; op: string; xml: string | null; auth: string }[],
    batch: { code: "1", lines: [{ ok: true, error: "" }] as { ok: boolean; error: string }[] },
    refuse: null as null | { code: string; description: string },
    status: 200,
    down: false,
  };
  const soap = (inner: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><r>${inner}</r></soap:Body></soap:Envelope>`;
  const fetchFn: SmoobuFetchLike = async (url, init) => {
    if (state.down) throw new Error("connect ETIMEDOUT");
    const body = init.body ?? "";
    const op = body.includes("comunicacionRequest") ? "comunicacion" : body.includes("consultaLoteRequest") ? "consultaLote" : "?";
    let xml: string | null = null;
    const payload = /<solicitud>([^<]*)<\/solicitud>/.exec(body)?.[1];
    if (payload) {
      const zip = Buffer.from(payload, "base64");
      const nameLength = zip.readUInt16LE(26);
      xml = inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + zip.readUInt32LE(18))).toString("utf8");
    }
    state.calls.push({ url, op, xml, auth: init.headers.authorization ?? "" });
    const reply = (status: number, text: string) => ({ status, headers: { get: () => null }, text: async () => text });
    if (init.headers.authorization !== `Basic ${Buffer.from(`${USER.user}:${USER.password}`).toString("base64")}`) return reply(401, "");
    if (state.status !== 200) return reply(state.status, "<html>Service Unavailable</html>");
    if (op === "comunicacion") {
      if (state.refuse) return reply(200, soap(`<codigo>${state.refuse.code}</codigo><descripcion>${state.refuse.description}</descripcion>`));
      return reply(200, soap(`<codigo>0</codigo><descripcion>Ok</descripcion><lote>lote-${state.calls.length}</lote>`));
    }
    const lines = state.batch.lines
      .map((l, i) => `<resultadoComunicacion><orden>${i + 1}</orden>${l.ok ? `<codigoComunicacion>COM-${i + 1}</codigoComunicacion>` : `<tipoError>E</tipoError><error>${l.error}</error>`}</resultadoComunicacion>`)
      .join("");
    return reply(200, soap(`<codigoEstado>${state.batch.code}</codigoEstado><resultadoComunicaciones>${lines}</resultadoComunicaciones>`));
  };
  return Object.assign(state, { fetch: fetchFn });
}

async function setUp(ses: Record<string, unknown> = { landlord: "0000000001" }, extra: { professional?: boolean } = {}) {
  const dir = tempDir();
  await main(["init"], testIo(dir));
  const fairguest = { country: "ES", establishment: "0000000099", establishmentName: "Casa de Prueba", professional: extra.professional ?? false, checkInTime: "16:00", checkOutTime: "10:00", rooms: 1, internet: true, ses };
  const pricing = { name: "Casa de Prueba", currency: "EUR", basePrice: 100, defaultMinStay: 1, factors: { limits: { enabled: true, floorPrice: 60, ceilingPrice: 260 } } };
  writeFileSync(path.join(dir, "fairnight.config.json"), JSON.stringify({ listings: [{ name: "casa", calendars: [{ source: "airbnb", url: ICAL }], pricing, fairguest }] }, null, 2));
  const service = fakeSes();
  const make = (more: Partial<TestIo> = {}, schema: SesSchema | null = FAKE_SCHEMA): TestIo =>
    Object.assign(testIo(dir, fakeFetch({ [ICAL]: ics }), ARRIVAL), { scryptCost: FAST, env: { FAIRGUEST_FRASE: PASS }, sesFetch: service.fetch, sesUrls: URLS, sesSchema: schema, ...more });
  expect(await main(["ospiti", "attiva"], make())).toBe(0);
  expect(await main(["sync"], make())).toBe(0);
  const d = openDb(path.join(dir, "data", "fairnight.db"));
  opened.push(d);
  const id = (d.prepare("SELECT id FROM guest_stays").get() as { id: string }).id;
  return { dir, id, service, make, db: d };
}

const said = (t: TestIo) => [...t.lines, ...t.errors].join("\n");
/** A terminal that answers the questions in order. */
const answers = (...list: string[]) => ({ prompt: async () => list.shift() ?? "" });
const subs = (db: ReturnType<typeof openDb>, id: string) => db.prepare("SELECT kind, channel, status, batch, detail FROM guest_submissions WHERE stay_id = ? ORDER BY id").all(id) as { kind: string; channel: string; status: string; batch: string | null; detail: string }[];

async function withGuest(s: Awaited<ReturnType<typeof setUp>>) {
  addPerson(s.db, s.id, { guest: guest(), payment: "platform" }, "form", new Date(ARRIVAL));
}

describe("fairnight ospiti … --ses", () => {
  it("prepara: shows what SES will receive; without the Ministry's schemas it writes nothing", async () => {
    const s = await setUp();
    const empty = s.make({}, null);
    expect(await main(["ospiti", "prepara", "--ses", s.id], empty)).toBe(1);
    expect(said(empty)).toMatch(/cannot be made yet/);
    await withGuest(s);
    const t = s.make({}, null);
    expect(await main(["ospiti", "prepara", "--ses", s.id], t)).toBe(1);
    const out = said(t);
    expect(out).toContain("parte de viajeros (PV), what SES.HOSPEDAJES will receive:");
    expect(out).toContain("    codigoEstablecimiento: 0000000099");
    expect(out).toContain("    persona/direccion/codigoMunicipio: 38001");
    expect(out).toContain("    contrato/pago/tipoPago: PLATF");
    expect(out).toMatch(/the XML is not switched on yet[\s\S]*openstay-ses-docs[\s\S]*Nothing was prepared and nothing was sent/);
    expect(subs(s.db, s.id)).toEqual([]);
    expect(s.service.calls).toEqual([]);
  });

  it("prepara: with the schema values (fake here) writes the XML, readable by the host only", async () => {
    const s = await setUp();
    await withGuest(s);
    const t = s.make();
    expect(await main(["ospiti", "prepara", s.id, "--tipo", "prenotazione"], t)).toBe(0);
    const file = /Wrote (.+\.xml):/.exec(said(t))?.[1] as string;
    const xml = readFileSync(file, "utf8");
    expect(xml).toContain('<ns2:peticion xmlns:ns2="http://www.neg.hospedajes.mir.es/altaReservaHospedaje"><solicitud><comunicacion><establecimiento><codigo>0000000099</codigo>');
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(subs(s.db, s.id).map((x) => x.status)).toEqual(["prepared"]);
    expect(s.service.calls).toEqual([]);
  });

  it("credenziali --ses: sealed in the database, one per environment, never in the config", async () => {
    const s = await setUp();
    const before = readFileSync(path.join(s.dir, "fairnight.config.json"), "utf8");
    expect(await main(["ospiti", "credenziali", "--ses"], s.make(answers(USER.user, USER.password)))).toBe(0);
    expect(await main(["ospiti", "credenziali", "--ses", "--ambiente", "produzione"], s.make(answers(USER.user, USER.password)))).toBe(0);
    const meta = s.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'fairguest_ses_%' ORDER BY key").all() as { key: string; value: string }[];
    expect(meta.map((m) => m.key)).toEqual(["fairguest_ses_principale_production", "fairguest_ses_principale_test"]);
    for (const m of meta) expect(m.value).not.toContain(USER.password);
    expect(readFileSync(path.join(s.dir, "fairnight.config.json"), "utf8")).toBe(before);
    expect(await main(["ospiti", "credenziali", "--ses", "--ambiente", "vero"], s.make(answers()))).toBe(2);
  });

  it("invia: a preview without --applica; nothing without the schema, the credentials or the typed confirmation", async () => {
    const s = await setUp();
    await withGuest(s);
    const look = s.make();
    expect(await main(["ospiti", "invia", "--ses"], look)).toBe(0);
    expect(said(look)).toMatch(new RegExp(`${s.id} \\(casa\\): parte de viajeros \\(PV\\) ready, 1 person → test service \\(pre-ses: nothing is registered\\)`));
    expect(said(look)).toContain("Nothing was sent.");

    const noSchema = s.make(answers("SEND"), null);
    expect(await main(["ospiti", "invia", "--ses", "--applica"], noSchema)).toBe(1);
    expect(said(noSchema)).toMatch(/not switched on yet/);

    const noCredentials = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica"], noCredentials)).toBe(1);
    expect(said(noCredentials)).toContain('"fairnight ospiti credenziali --ses --ambiente prova"');

    await main(["ospiti", "credenziali", "--ses"], s.make(answers(USER.user, USER.password)));
    const no = s.make(answers("yes"));
    expect(await main(["ospiti", "invia", "--ses", "--applica"], no)).toBe(1);
    expect(said(no)).toContain("Not confirmed: nothing was sent.");
    const scheduled = s.make({ prompt: undefined });
    expect(await main(["ospiti", "invia", "--ses", "--applica"], scheduled)).toBe(1);
    expect(said(scheduled)).toMatch(/needs a confirmation typed in a terminal/);
    expect(s.service.calls).toEqual([]);
    expect(subs(s.db, s.id)).toEqual([]);
  });

  it("test service: sends after SEND, records the batch apart; it never counts as the communication made", async () => {
    const s = await setUp();
    await withGuest(s);
    await main(["ospiti", "credenziali", "--ses"], s.make(answers(USER.user, USER.password)));
    let question = "";
    const t = s.make({ prompt: async (q) => ((question = q), "SEND") });
    expect(await main(["ospiti", "invia", "--ses", "--applica"], t)).toBe(0);
    expect(question).toMatch(/Send 1 parte de viajeros \(PV\) to SES\.HOSPEDAJES, test service only\? Type SEND to confirm/);
    expect(s.service.calls.map((c) => [c.url, c.op])).toEqual([[URLS.test, "comunicacion"]]);
    expect(s.service.calls[0]?.xml).toContain("<nombre>Lucía</nombre>");
    expect(said(t)).toMatch(/taken by SES\.HOSPEDAJES \(test service\), batch lote-1/);
    expect(subs(s.db, s.id)).toEqual([{ kind: "checkin", channel: "ses-prova", status: "sent", batch: "lote-1", detail: "order 1; 0 Ok" }]);

    // Waiting for the outcome: no second send.
    const twice = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica", s.id], twice)).toBe(1);
    expect(said(twice)).toMatch(/waiting for its outcome/);

    s.service.batch = { code: "4", lines: [] };
    const pending = s.make();
    expect(await main(["ospiti", "esito", "--ses"], pending)).toBe(0);
    expect(said(pending)).toMatch(/still being processed/);
    s.service.batch = { code: "1", lines: [{ ok: true, error: "" }] };
    const done = s.make();
    expect(await main(["ospiti", "esito"], done)).toBe(0);
    expect(said(done)).toMatch(/registered \(test service\), code COM-1/);
    expect(subs(s.db, s.id).at(-1)).toMatchObject({ channel: "ses-prova", status: "accepted", detail: "codigoComunicacion COM-1" });

    // Still due for real, and the guest's data is still there (a non-professional host erases after the real one).
    const json = s.make();
    expect(await main(["ospiti", "--json"], json)).toBe(0);
    const pv = (JSON.parse(json.lines.join("\n")) as { deadlines: { kind: string; state: string }[] }).deadlines.find((d) => d.kind === "checkin");
    expect(pv?.state).not.toBe("done");
    expect((s.db.prepare("SELECT erased_at FROM guest_stays WHERE id = ?").get(s.id) as { erased_at: string | null }).erased_at).toBeNull();
    // Many commands in a row, each opening the passphrase: slow on a busy computer.
  }, 30_000);

  it("production only when the config says so; a refusal in the batch lets the host send again; the accepted one erases the data", async () => {
    const off = await setUp();
    await withGuest(off);
    const refused = off.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--ambiente", "produzione"], refused)).toBe(1);
    expect(said(refused)).toMatch(/Production is switched on only in fairnight\.config\.json/);

    const s = await setUp({ landlord: "0000000001", environment: "production" });
    await withGuest(s);
    await main(["ospiti", "credenziali", "--ses", "--ambiente", "produzione"], s.make(answers(USER.user, USER.password)));
    let question = "";
    expect(await main(["ospiti", "invia", "--ses", "--applica"], s.make({ prompt: async (q) => ((question = q), "SEND") }))).toBe(0);
    expect(question).toMatch(/1 of them in PRODUCTION \(registered with the police\)/);
    expect(s.service.calls.at(-1)?.url).toBe(URLS.production);

    s.service.batch = { code: "1", lines: [{ ok: false, error: "Número de soporte no válido" }] };
    const outcome = s.make();
    expect(await main(["ospiti", "esito", "--ses"], outcome)).toBe(1);
    expect(said(outcome)).toMatch(/refused: E · Número de soporte no válido/);
    const late = s.make();
    await main(["ospiti", "--json"], late);
    expect((JSON.parse(late.lines.join("\n")) as { deadlines: { kind: string; state: string }[] }).deadlines.find((d) => d.kind === "checkin")?.state).not.toBe("done");

    const again = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica"], again)).toBe(0);
    expect(said(again)).toMatch(/again after the refusal of 2099-06-10 18:00/);
    s.service.batch = { code: "1", lines: [{ ok: true, error: "" }] };
    expect(await main(["ospiti", "esito", "--ses"], s.make())).toBe(0);
    expect(subs(s.db, s.id).map((x) => `${x.channel} ${x.status}`)).toEqual(["ses-ws sent", "ses-ws rejected", "ses-ws sent", "ses-ws accepted"]);
    // Non-professional host: nothing to keep once the communication is confirmed (RD 933/2021, art. 5.4).
    const next = s.make();
    await main(["ospiti", "elenco"], next);
    expect(said(next)).toMatch(/Erased the personal data of stay/);
    const already = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica", s.id], already)).toBe(1);
    // Many commands in a row, each opening the passphrase: slow on a busy computer.
  }, 30_000);

  it("errors: a refusal of the request is recorded and can be sent again; no answer records nothing and says to check first", async () => {
    const s = await setUp();
    await withGuest(s);
    await main(["ospiti", "credenziali", "--ses"], s.make(answers(USER.user, USER.password)));
    s.service.refuse = { code: "10120", description: "Arrendador sin canal de servicio web" };
    const refused = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica"], refused)).toBe(1);
    expect(said(refused)).toMatch(/refused by SES\.HOSPEDAJES: 10120 · Arrendador sin canal de servicio web/);
    expect(subs(s.db, s.id).at(-1)).toMatchObject({ status: "rejected", detail: "10120 Arrendador sin canal de servicio web" });

    s.service.refuse = null;
    s.service.status = 503;
    const unavailable = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica"], unavailable)).toBe(1);
    expect(said(unavailable)).toMatch(/refused the call: HTTP 503/);

    s.service.status = 200;
    s.service.down = true;
    const before = subs(s.db, s.id).length;
    const silent = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", "--applica"], silent)).toBe(1);
    expect(said(silent)).toMatch(/no answer from SES\.HOSPEDAJES \(connect ETIMEDOUT\)\. The communication may have arrived: check "Consulta de comunicaciones"/);
    expect(subs(s.db, s.id)).toHaveLength(before);

    s.service.down = false;
    expect(await main(["ospiti", "invia", "--ses", "--applica"], s.make(answers("SEND")))).toBe(0);
    expect(subs(s.db, s.id).at(-1)).toMatchObject({ status: "sent" });
    // Many commands in a row, each opening the passphrase: slow on a busy computer.
  }, 30_000);

  it("refuses --ses for other countries and a listing without the ses block", async () => {
    const s = await setUp();
    const cfg = path.join(s.dir, "fairnight.config.json");
    const c = JSON.parse(readFileSync(cfg, "utf8"));
    delete c.listings[0].fairguest.ses;
    writeFileSync(cfg, JSON.stringify(c));
    await withGuest(s);
    const t = s.make(answers("SEND"));
    expect(await main(["ospiti", "invia", "--ses", s.id], t)).toBe(1);
    expect(said(t)).toMatch(/has no "ses" block/);
    expect(await main(["ospiti", "invia", "--ses", s.id, "--tipo", "annullamento"], s.make())).toBe(2);
  });
});
