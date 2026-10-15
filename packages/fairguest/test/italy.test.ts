/**
 * Italy, Alloggiati Web. Invented data only: the code tables below have the
 * format of the portal's files but invented codes and municipalities, and the
 * web service is a fake that answers like the examples of the manual.
 */
import { describe, expect, it } from "vitest";
import {
  AlloggiatiClient,
  AlloggiatiError,
  alloggiatiFile,
  alloggiatiRegistry,
  municipalityCode,
  parseAlloggiatiTables,
  schedine,
  stateCode,
  xmlElement,
} from "../src/countries/it-alloggiati.js";
import { italyDeadlines, italyRetention, italyRules, lodgerTypes } from "../src/italy.js";
import { registryFor } from "../src/index.js";
import { validateGuestSettings } from "../src/settings.js";
import { NotAvailableError, type Guest, type Stay, type Transport } from "../src/types.js";
import { parseGuest } from "../src/validate.js";
import { TODAY } from "./data.js";

const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

/** Same header and shape as the portal's files; padding rows so the size checks pass. */
export const TABLES_TEXT = {
  municipalities: [
    "Codice,Descrizione,Provincia,DataFineVal",
    "900000001,BORGO DI PROVA,ZZ,",
    "900000002,SANT'ESEMPIO,ZZ,",
    "900000003,DOPPIONE,ZZ,",
    "900000004,DOPPIONE,ZY,",
    "900000005,VECCHIO BORGO,ZZ,31/12/1990 00:00:00",
    "900000006,VECCHIO BORGO,ZZ,",
    ...many(1000, (i) => `${910000000 + i},RIEMPITIVO ${i},ZX,`),
  ].join("\r\n"),
  states: [
    "Codice,Descrizione,Provincia,DataFineVal",
    "100000100,ITALIA,ES,",
    "100000239,SPAGNA,ES,",
    "100000216,GERMANIA,ES,",
    "100000536,STATI UNITI D'AMERICA,ES,",
    "100000999,JUGOSLAVIA,ES,31/12/1992 00:00:00",
    ...many(100, (i) => `${190000000 + i},RIEMPITIVO ${i},ES,`),
  ].join("\r\n"),
  documents: ["Codice,Descrizione", "IDENT,CARTA DI IDENTITA'", "IDELE,CARTA IDENTITA' ELETTRONICA", "PASOR,PASSAPORTO ORDINARIO", "PATEN,PATENTE DI GUIDA"].join("\r\n"),
};
const tables = parseAlloggiatiTables(TABLES_TEXT);

const holder = (): Guest => ({
  givenName: "Ospite",
  surname1: "Prova",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  birthPlace: { country: "ITA", locality: "Borgo di Prova" },
  document: { type: "electronic_id", number: "ZZ0000000", issuedOn: "2095-01-10", issuedIn: { country: "ITA", locality: "Sant'Esempio" } },
});
const child = (): Guest => ({
  givenName: "Esempio",
  surname1: "Prova",
  birthDate: "2092-07-01",
  sex: "male",
  nationality: "ESP",
  birthPlace: { country: "ESP" },
  kinship: "child",
});
const itStay = (over: Partial<Stay> = {}): Stay => ({
  id: "stay-prova-it",
  establishment: "ZZ00000000",
  reference: "PROVA-0001",
  contractDate: "2099-05-20",
  checkIn: "2099-06-10",
  checkInTime: "16:00",
  checkOut: "2099-06-13",
  checkOutTime: "10:00",
  people: 2,
  guests: [holder(), child()],
  ...over,
});

describe("Alloggiati Web tables", () => {
  it("reads the portal's files and refuses anything else", () => {
    expect(tables.municipalities[0]).toEqual({ code: "900000001", name: "BORGO DI PROVA", province: "ZZ", endedOn: null });
    expect(tables.municipalities[4]?.endedOn).toBe("1990-12-31");
    expect(() => parseAlloggiatiTables({ ...TABLES_TEXT, states: "<html>error</html>" })).toThrow(/first line/);
    expect(() => parseAlloggiatiTables({ ...TABLES_TEXT, states: "Codice,Descrizione,Provincia,DataFineVal\r\n100000100,ITALIA,ES," })).toThrow(/incomplete/);
  });

  it("finds a state by its Italian name, or by the name Alloggiati Web uses", () => {
    expect(stateCode(tables, "ITA")).toBe("100000100");
    expect(stateCode(tables, "DEU")).toBe("100000216");
    expect(stateCode(tables, "USA")).toBe("100000536");
    expect(stateCode(tables, "FRA")).toBeNull();
  });

  it("finds a municipality, asks for the province when the name repeats, and uses the code valid on the day", () => {
    expect(municipalityCode(tables, { country: "ITA", locality: "sant esempio" }, undefined)).toEqual({ code: "900000002", province: "ZZ" });
    expect(municipalityCode(tables, { country: "ITA", locality: "Doppione" }, undefined)).toEqual({ problem: expect.stringMatching(/more than one province \(ZY, ZZ\)/) });
    expect(municipalityCode(tables, { country: "ITA", locality: "Doppione", province: "ZY" }, undefined)).toEqual({ code: "900000004", province: "ZY" });
    expect(municipalityCode(tables, { country: "ITA", locality: "Vecchio Borgo" }, "1980-01-01")).toEqual({ code: "900000005", province: "ZZ" });
    expect(municipalityCode(tables, { country: "ITA", locality: "Vecchio Borgo" }, "2060-01-01")).toEqual({ code: "900000006", province: "ZZ" });
    expect(municipalityCode(tables, { country: "ITA", locality: "Nessun Posto" }, undefined)).toEqual({ problem: expect.stringMatching(/no Italian municipality/) });
  });
});

describe("schedine", () => {
  it("writes one line of 168 characters per guest, holder first, as in the record of the manual", () => {
    const { lines, problems } = schedine(itStay(), tables);
    expect(problems).toEqual([]);
    expect(lines).toHaveLength(2);
    const [a, b] = lines as [string, string];
    for (const l of lines) expect(l).toHaveLength(168);
    // Holder: head of family (17), with the document.
    expect(a.slice(0, 2)).toBe("17");
    expect(a.slice(2, 12)).toBe("10/06/2099");
    expect(a.slice(12, 14)).toBe("03");
    expect(a.slice(14, 64)).toBe("PROVA".padEnd(50));
    expect(a.slice(64, 94)).toBe("OSPITE".padEnd(30));
    expect(a.slice(94, 95)).toBe("2");
    expect(a.slice(95, 105)).toBe("15/03/2060");
    expect(a.slice(105, 114)).toBe("900000001");
    expect(a.slice(114, 116)).toBe("ZZ");
    expect(a.slice(116, 125)).toBe("100000100");
    expect(a.slice(125, 134)).toBe("100000100");
    expect(a.slice(134, 139)).toBe("IDELE");
    expect(a.slice(139, 159)).toBe("ZZ0000000".padEnd(20));
    expect(a.slice(159, 168)).toBe("900000002");
    // Family member (19): born abroad, so no municipality and province; no document.
    expect(b.slice(0, 2)).toBe("19");
    expect(b.slice(94, 95)).toBe("1");
    expect(b.slice(105, 116)).toBe(" ".repeat(11));
    expect(b.slice(116, 125)).toBe("100000239");
    expect(b.slice(125, 134)).toBe("100000239");
    expect(b.slice(134)).toBe(" ".repeat(34));
  });

  it("uses single guest (16), and group (18, 20) when someone has no relationship", () => {
    expect(lodgerTypes([holder()])).toEqual(["16"]);
    expect(lodgerTypes([holder(), { ...child(), kinship: undefined } as Guest, child()])).toEqual(["18", "20", "20"]);
    const one = schedine(itStay({ people: 1, guests: [holder()] }), tables);
    expect(one.lines[0]?.slice(0, 2)).toBe("16");
  });

  it("puts the issuing state for a foreign document, joins two surnames, upper-cases accents", () => {
    const g: Guest = {
      ...holder(),
      givenName: "Josè-Maria",
      surname1: "Prueba",
      surname2: "Ejemplo",
      nationality: "ESP",
      birthPlace: { country: "ESP" },
      document: { type: "passport", number: "ZZ0000000", issuedIn: { country: "ESP" } },
    };
    const [line] = schedine(itStay({ people: 1, guests: [g] }), tables).lines as [string];
    expect(line.slice(14, 64).trimEnd()).toBe("PRUEBA EJEMPLO");
    expect(line.slice(64, 94).trimEnd()).toBe("JOSÈ MARIA");
    expect(line.slice(134, 139)).toBe("PASOR");
    expect(line.slice(159, 168)).toBe("100000239");
  });

  it("returns no line at all when a code is missing", () => {
    const g = { ...holder(), nationality: "FRA" };
    const r = schedine(itStay({ people: 1, guests: [g] }), tables);
    expect(r.lines).toEqual([]);
    expect(r.problems).toEqual([{ path: "guests[0].nationality", message: expect.stringMatching(/not in the Alloggiati Web table/) }]);
  });

  it("writes the file for the portal with CR LF between lines and none at the end", () => {
    const { lines } = schedine(itStay(), tables);
    const f = alloggiatiFile(lines, "alloggiati.txt");
    expect(f.text.split("\r\n")).toEqual(lines);
    expect(f.text.endsWith("\r\n")).toBe(false);
    expect(() => alloggiatiFile([], "x.txt")).toThrow(/No schedina/);
  });
});

describe("Italian rules", () => {
  it("asks only the holder for a document, and male or female", () => {
    expect(italyRules(itStay(), "checkin")).toEqual([]);
    expect(italyRules(itStay(), "reservation")).toEqual([]);
    const problems = italyRules(itStay({ guests: [{ ...holder(), sex: "other", document: undefined }, { ...child(), birthPlace: { country: "ITA" } }] }), "checkin");
    expect(problems.map((p) => p.path)).toEqual(["guests[0].sex", "guests[0].document", "guests[1].birthPlace.locality"]);
  });

  it("refuses a stay longer than one schedina can declare", () => {
    expect(italyRules(itStay({ checkOut: "2099-07-20" }), "checkin").map((p) => p.path)).toEqual(["checkOut"]);
  });

  it("gives 24 hours from arrival, 6 for a stay of 24 hours or less", () => {
    expect(italyDeadlines({ checkIn: "2099-06-10", checkInTime: "16:00", checkOut: "2099-06-13", seenAt: "2099-06-01T09:00" })).toEqual([
      { kind: "checkin", due: "2099-06-11T16:00", from: "arrival (2099-06-10 16:00)" },
    ]);
    expect(italyDeadlines({ checkIn: "2099-06-10", checkInTime: "16:00", checkOut: "2099-06-11", checkOutTime: "10:00", seenAt: "2099-06-01T09:00" })[0]?.due).toBe("2099-06-10T22:00");
    // Late check-out: more than 24 hours, so 24 hours again.
    expect(italyDeadlines({ checkIn: "2099-06-10", checkInTime: "10:00", checkOut: "2099-06-11", checkOutTime: "18:00", seenAt: "2099-06-01T09:00" })[0]?.due).toBe("2099-06-11T10:00");
    // No times: counted from midnight, 6 hours.
    expect(italyDeadlines({ checkIn: "2099-06-10", checkOut: "2099-06-11", seenAt: "2099-06-01T09:00" })[0]?.due).toBe("2099-06-10T06:00");
  });

  it("erases the data as soon as Alloggiati Web accepted it, or at once for a cancelled booking", () => {
    expect(italyRetention({ checkOut: "2099-06-13", cancelledAt: null }, { professional: true }, []).eraseFrom).toBeNull();
    expect(italyRetention({ checkOut: "2099-06-13", cancelledAt: null }, { professional: false }, [{ kind: "checkin", status: "accepted", at: "2099-06-10T17:00" }]).eraseFrom).toBe(
      "2099-06-10T17:00",
    );
    expect(italyRetention({ checkOut: "2099-06-13", cancelledAt: "2099-06-02T08:00" }, { professional: false }, []).eraseFrom).toBe("2099-06-02T08:00");
  });

  it("reads the places of birth and of issue from untrusted input", () => {
    const r = parseGuest(
      { givenName: "Ospite", surname1: "Prova", birthPlace: { country: "ita", locality: "Borgo di Prova", province: "zz" }, document: { type: "id_card", number: "zz 000", issuedIn: { country: "XXX" } } },
      TODAY,
    );
    expect(r.draft.birthPlace).toEqual({ country: "ITA", locality: "Borgo di Prova", province: "ZZ" });
    expect(r.problems).toEqual([{ path: "guest.document.issuedIn.country", message: expect.stringMatching(/country code/) }]);
  });

  it("is the registry of IT, and prepare needs the tables", () => {
    expect(registryFor("IT")).toBe(alloggiatiRegistry);
    expect(alloggiatiRegistry.documentTypes).not.toContain("nie");
    expect(() => alloggiatiRegistry.prepare([], "checkin", "2099-06-10T10:00")).toThrow(NotAvailableError);
  });

  it("validates the alloggiati block of a listing", () => {
    expect(validateGuestSettings({ country: "IT", establishment: "ZZ00000000" }, "x").value?.alloggiati).toEqual({ account: "principale", autoSend: false });
    expect(validateGuestSettings({ country: "IT", establishment: "ZZ00000000", alloggiati: { account: "casa-2", apartmentId: 4, autoSend: true } }, "x").value?.alloggiati).toEqual({
      account: "casa-2",
      apartmentId: 4,
      autoSend: true,
    });
    expect(validateGuestSettings({ country: "ES", establishment: "ZZ00000000", alloggiati: {} }, "x").issues[0]?.path).toBe("x.alloggiati");
    expect(validateGuestSettings({ country: "IT", establishment: "ZZ00000000", alloggiati: { apartmentId: "4", user: "x" } }, "x").issues.map((i) => i.path)).toEqual([
      "x.alloggiati.user",
      "x.alloggiati.apartmentId",
    ]);
  });
});

/** A fake Alloggiati Web service that answers like the examples of the manual. */
function fakeService(answer: (method: string, body: string) => string, seen: { url: string; headers: Record<string, string>; body: string }[] = []): Transport {
  return async (req) => {
    seen.push(req);
    const method = /<all:(\w+)>/.exec(req.body.replace("<all:Utente>", ""))?.[1] ?? "";
    const response = answer(method, req.body);
    return { status: response.includes("Fault") ? 500 : 200, body: response };
  };
}
const env = (inner: string) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
const ok = "<esito>true</esito><ErroreCod /><ErroreDes /><ErroreDettaglio />";

describe("Alloggiati Web service client", () => {
  it("asks for a token with user, password and key, escaping the XML", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const client = new AlloggiatiClient(
      fakeService(
        () =>
          env(
            `<GenerateTokenResponse xmlns="AlloggiatiService"><GenerateTokenResult><issued>2099-06-10T13:13:47+02:00</issued><expires>2099-06-10T14:13:47+02:00</expires><token>TOKEN-PROVA</token></GenerateTokenResult><result>${ok}</result></GenerateTokenResponse>`,
          ),
        seen,
      ),
      "https://alloggiati.example.invalid/service.asmx",
    );
    expect(await client.token({ user: "ZZ000000", password: "pass<&>prova", wsKey: "key-0000-not-real" })).toEqual({ token: "TOKEN-PROVA", expires: "2099-06-10T14:13:47+02:00" });
    expect(seen[0]?.url).toBe("https://alloggiati.example.invalid/service.asmx");
    expect(seen[0]?.headers["content-type"]).toBe('application/soap+xml; charset=utf-8; action="AlloggiatiService/GenerateToken"');
    expect(seen[0]?.body).toContain("<all:Password>pass&lt;&amp;&gt;prova</all:Password>");
  });

  it("reports a refused token with the service's reasons", async () => {
    const client = new AlloggiatiClient(
      fakeService(() =>
        env(`<GenerateTokenResponse xmlns="AlloggiatiService"><GenerateTokenResult /><result><esito>false</esito><ErroreCod>4</ErroreCod><ErroreDes>AUTENTICAZIONE</ErroreDes><ErroreDettaglio>Credenziali errate</ErroreDettaglio></result></GenerateTokenResponse>`),
      ),
    );
    await expect(client.token({ user: "ZZ000000", password: "x", wsKey: "y" })).rejects.toThrow(/4 · AUTENTICAZIONE · Credenziali errate/);
  });

  it("reads one outcome per schedina, and uses GestioneAppartamenti for an apartment", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const client = new AlloggiatiClient(
      fakeService(
        (method) =>
          env(
            `<${method}Response xmlns="AlloggiatiService"><${method}Result>${ok}</${method}Result><result><SchedineValide>1</SchedineValide><Dettaglio><EsitoOperazioneServizio>${ok}</EsitoOperazioneServizio><EsitoOperazioneServizio><esito>false</esito><ErroreCod>12</ErroreCod><ErroreDes>SCHEDINA_CAMPO_NON_CORRETTO</ErroreDes><ErroreDettaglio>Data di Arrivo Errata</ErroreDettaglio></EsitoOperazioneServizio></Dettaglio></result></${method}Response>`,
          ),
        seen,
      ),
    );
    const r = await client.test("ZZ000000", "TOKEN-PROVA", ["riga 1", "riga 2"]);
    expect(r.valid).toBe(1);
    expect(r.result.ok).toBe(true);
    expect(r.lines).toEqual([
      { ok: true, code: "", description: "", detail: "" },
      { ok: false, code: "12", description: "SCHEDINA_CAMPO_NON_CORRETTO", detail: "Data di Arrivo Errata" },
    ]);
    expect(seen[0]?.body).toContain("<all:ElencoSchedine><all:string>riga 1</all:string><all:string>riga 2</all:string></all:ElencoSchedine>");
    await client.send("ZZ000000", "TOKEN-PROVA", ["riga 1"], 4);
    expect(seen[1]?.headers["content-type"]).toContain('action="AlloggiatiService/GestioneAppartamenti_Send"');
    expect(seen[1]?.body).toContain("<all:IdAppartamento>4</all:IdAppartamento>");
  });

  it("decodes the receipt PDF and turns a SOAP fault into an error", async () => {
    const pdf = Buffer.from("%PDF-prova").toString("base64");
    const client = new AlloggiatiClient(
      fakeService((method) =>
        method === "Ricevuta"
          ? env(`<RicevutaResponse xmlns="AlloggiatiService"><RicevutaResult>${ok}</RicevutaResult><PDF>${pdf}</PDF></RicevutaResponse>`)
          : env(`<soap:Fault><soap:Reason><soap:Text xml:lang="it">Errore interno</soap:Text></soap:Reason></soap:Fault>`),
      ),
    );
    const r = await client.receipt("ZZ000000", "TOKEN-PROVA", "2099-06-10");
    expect(Buffer.from(r.pdf as Uint8Array).toString()).toBe("%PDF-prova");
    await expect(client.table("ZZ000000", "TOKEN-PROVA", "ListaAppartamenti")).rejects.toThrow(AlloggiatiError);
  });

  it("finds elements with or without a namespace prefix", () => {
    expect(xmlElement("<a:x>1</a:x>", "x")).toBe("1");
    expect(xmlElement("<x/>", "x")).toBe("");
    expect(xmlElement("<y>1</y>", "x")).toBeNull();
  });
});
