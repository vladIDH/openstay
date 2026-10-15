/**
 * Istat: the guests' statistical records, the ROSS1000 XML and service, the
 * Trento and Umbria files, the month's figures. Invented data and tables only;
 * the ROSS1000 service is a fake that answers like the WSDL says.
 */
import { describe, expect, it } from "vitest";
import { parseAlloggiatiTables } from "../src/countries/it-alloggiati.js";
import { dayFigures, monthSummary, trentoCsv, umbriaDay } from "../src/istat/files.js";
import { istatStay, type IstatStay } from "../src/istat/record.js";
import { ISTAT_REGIONS } from "../src/istat/regions.js";
import { Ross1000Client, rossFile, type RossDay } from "../src/istat/ross1000.js";
import { validateGuestSettings } from "../src/settings.js";
import type { Guest, Stay, Transport } from "../src/types.js";
import { TABLES_TEXT } from "./italy-tables.js";

const tables = parseAlloggiatiTables(TABLES_TEXT);

const holder = (): Guest => ({
  givenName: "Ospite",
  surname1: "Prova",
  birthDate: "2060-03-15",
  sex: "female",
  nationality: "ITA",
  birthPlace: { country: "ITA", locality: "Borgo di Prova" },
  address: { country: "ITA", locality: "Sant'Esempio" },
  document: { type: "passport", number: "ZZ0000000", issuedIn: { country: "ITA", locality: "Borgo di Prova" } },
});
const friend = (): Guest => ({ givenName: "Amica", surname1: "Prova", birthDate: "2061-01-01", sex: "male", nationality: "DEU", birthPlace: { country: "DEU" }, address: { country: "DEU", locality: "Musterstadt" } });
const stay = (over: Partial<Stay> = {}): Stay => ({
  id: "fgprova0001",
  establishment: "ZZ00000000",
  reference: "PROVA-1",
  contractDate: "2099-05-20",
  checkIn: "2099-06-10",
  checkOut: "2099-06-12",
  people: 2,
  guests: [holder(), friend()],
  ...over,
});

const record = (s = stay()) => istatStay(s, tables).record as IstatStay;

describe("the statistical record of a stay", () => {
  it("has no name and no document, only codes, and the group's types", () => {
    const r = record();
    expect(JSON.stringify(r)).not.toMatch(/Ospite|Amica|ZZ0000000/);
    expect(r.guests).toEqual([
      expect.objectContaining({ id: "fgprova0001-1", type: "18", head: "", sex: "F", citizenship: "100000100", birthMunicipality: "900000001", residenceState: "100000100", residencePlace: "900000002", residenceProvince: "ZZ" }),
      expect.objectContaining({ id: "fgprova0001-2", type: "20", head: "fgprova0001-1", sex: "M", citizenship: "100000216", residenceState: "100000216", residencePlace: "Musterstadt", residenceProvince: "" }),
    ]);
  });

  it("asks for the residence", () => {
    const r = istatStay(stay({ guests: [{ ...holder(), address: undefined }] }), tables);
    expect(r.record).toBeNull();
    expect(r.problems).toEqual([{ path: "guests[0].address.country", message: "the country of residence is required" }]);
  });
});

const days = (): RossDay[] => {
  const r = record();
  return [
    { day: "2099-06-10", open: true, roomsOccupied: 2, rooms: 2, beds: 4, arrivals: r.guests, departures: [] },
    { day: "2099-06-11", open: true, roomsOccupied: 2, rooms: 2, beds: 4, arrivals: [], departures: [] },
    { day: "2099-06-12", open: true, roomsOccupied: 0, rooms: 2, beds: 4, arrivals: [], departures: r.guests.map((g) => ({ id: g.id, type: g.type, arrival: "2099-06-10" })) },
    { day: "2099-06-13", open: false, roomsOccupied: 0, rooms: 2, beds: 4, arrivals: [], departures: [] },
  ];
};

describe("ROSS1000", () => {
  it("writes one movimento per day as the specification, closed days with zeros, no names", () => {
    const xml = rossFile("ZZ0001P", days());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<movimenti><codice>ZZ0001P</codice><prodotto>Fairguest (OpenStay)</prodotto>')).toBe(true);
    expect(xml.match(/<movimento>/g)).toHaveLength(4);
    expect(xml).toContain("<data>20990610</data><struttura><apertura>SI</apertura><camereoccupate>2</camereoccupate><cameredisponibili>2</cameredisponibili><lettidisponibili>4</lettidisponibili></struttura>");
    expect(xml).toContain(
      "<arrivo><idswh>fgprova0001-2</idswh><tipoalloggiato>20</tipoalloggiato><idcapo>fgprova0001-1</idcapo><sesso>M</sesso><cittadinanza>100000216</cittadinanza><statoresidenza>100000216</statoresidenza><luogoresidenza>Musterstadt</luogoresidenza><datanascita>20610101</datanascita><statonascita>100000216</statonascita><comunenascita></comunenascita><tipoturismo>Non specificato</tipoturismo><mezzotrasporto>Non Specificato</mezzotrasporto>",
    );
    expect(xml).toContain("<partenza><idswh>fgprova0001-1</idswh><tipoalloggiato>18</tipoalloggiato><arrivo>20990610</arrivo></partenza>");
    expect(xml).toContain("<data>20990613</data><struttura><apertura>NO</apertura><camereoccupate>0</camereoccupate><cameredisponibili>0</cameredisponibili><lettidisponibili>0</lettidisponibili>");
    expect(xml).not.toMatch(/<cognome>|<nome>/);
  });

  it("sends with HTTP Basic and reads one result per day, with the refused guests", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const transport: Transport = async (req) => {
      seen.push(req);
      const day = (arr: string) => `<risultatiGiorno>${arr}</risultatiGiorno>`;
      return {
        status: 200,
        body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:inviaMovimentazioneResponse xmlns:ns2="http://checkin.ws.service.turismo5.gies.it/"><return>${day(
          "<arrivi><arrivo><idswh>fgprova0001-1</idswh><successo>true</successo></arrivo><arrivo><idswh>fgprova0001-2</idswh><successo>false</successo><errore>luogoresidenza non valido</errore></arrivo></arrivi>",
        )}${day("")}${day("<partenze><partenza><idswh>fgprova0001-1</idswh><successo>true</successo></partenza></partenze>")}${day("")}</return></ns2:inviaMovimentazioneResponse></soap:Body></soap:Envelope>`,
      };
    };
    const client = new Ross1000Client(transport, "https://ross.example.invalid/ws/checkinV2");
    const out = await client.send("utente-prova", "pass-0000-not-real", "ZZ0001P", days());
    expect(seen[0]?.headers.authorization).toBe(`Basic ${btoa("utente-prova:pass-0000-not-real")}`);
    expect(seen[0]?.body).toContain('<ns2:inviaMovimentazione xmlns:ns2="http://checkin.ws.service.turismo5.gies.it/"><movimentazione><codice>ZZ0001P</codice>');
    expect(out).toEqual([
      { day: "2099-06-10", ok: false, errors: ["fgprova0001-2: luogoresidenza non valido"] },
      { day: "2099-06-11", ok: true, errors: [] },
      { day: "2099-06-12", ok: true, errors: [] },
      { day: "2099-06-13", ok: true, errors: [] },
    ]);
  });

  it("turns a refused password or a fault into an error", async () => {
    const client = new Ross1000Client(async () => ({ status: 401, body: "" }), "https://ross.example.invalid/ws/checkinV2");
    await expect(client.send("u", "p", "ZZ0001P", days())).rejects.toThrow(/user or password/);
  });

  it("knows 13 territories with the web service", () => {
    expect(Object.values(ISTAT_REGIONS).filter((r) => r.mode === "ross1000")).toHaveLength(13);
  });
});

describe("files and figures", () => {
  it("Trento: one CSV line per stay and provenance", () => {
    expect(trentoCsv("022001-AT-000000", [record()]).split("\r\n")).toEqual(["022001-AT-000000;20990610;20990612;ZZ;1", "022001-AT-000000;20990610;20990612;DEU;1"]);
  });

  it("Umbria: the C/59 day with numbers at column 28, rooms at 17, date at 31, provenances at 1, 7, 43, 49", () => {
    const f = umbriaDay("Casa di Prova", 2, [record()], "2099-06-10");
    expect(f.name).toBe("10062099.txt");
    const lines = f.text.split("\r\n");
    expect(lines[0]).toBe("Casa di Prova");
    expect(lines[3]?.slice(27, 32)).toBe("    2");
    expect(lines[7]).toBe("CAMERE OCCUPATE=  2");
    expect(lines[8]?.slice(30)).toBe("10-06-2099");
    expect(lines[11]).toBe(`DEU   ${"Germania".padEnd(35)}     1     0`);
    expect(lines[11]?.slice(42, 47)).toBe("    1");
  });

  it("counts who is there night by night", () => {
    const f = dayFigures([record()], "2099-06-12");
    expect([f.presentBefore, f.arriving.length, f.leaving.length, f.presentTonight]).toEqual([2, 0, 2, 0]);
  });

  it("the month's arrivals and nights by provenance", () => {
    const across = record(stay({ id: "fgprova0002", checkIn: "2099-06-29", checkOut: "2099-07-02" }));
    expect(monthSummary([record(), across], "2099-06")).toEqual([
      { provenance: "DEU", description: "Germania", arrivals: 2, nights: 4 },
      { provenance: "ZZ", description: "ZZ", arrivals: 2, nights: 4 },
    ]);
    expect(monthSummary([across], "2099-07")).toEqual([
      { provenance: "DEU", description: "Germania", arrivals: 0, nights: 1 },
      { provenance: "ZZ", description: "ZZ", arrivals: 0, nights: 1 },
    ]);
  });
});

describe("settings", () => {
  it("asks for rooms and beds only with ROSS1000", () => {
    expect(validateGuestSettings({ country: "IT", establishment: "ZZ0", istat: { region: "lazio", code: "ZZ0001P" } }, "x").issues.map((i) => i.path)).toEqual(["x.rooms", "x.beds"]);
    expect(validateGuestSettings({ country: "IT", establishment: "ZZ0", istat: { region: "umbria", code: "Casa di Prova" } }, "x").value?.istat).toEqual({ region: "umbria", code: "Casa di Prova", account: "principale" });
    expect(validateGuestSettings({ country: "IT", establishment: "ZZ0", rooms: 2, beds: 4, istat: { region: "lazio", code: "ZZ0001P" } }, "x").value?.beds).toBe(4);
    expect(validateGuestSettings({ country: "ES", establishment: "ZZ0", istat: { region: "lazio", code: "x" } }, "x").issues[0]?.path).toBe("x.istat");
  });
});
