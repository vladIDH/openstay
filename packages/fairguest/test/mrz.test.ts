/**
 * MRZ reading. Every MRZ here is invented and built in the test with the ICAO
 * check digits: nobody is called Ospite Prova and no document ZZ0000000 exists.
 */
import { describe, expect, it } from "vitest";
import { checkDigit, findMrzLines, formValuesFromMrz, guestFromMrz, parseMrz as parseOrNull, type MrzFields } from "../src/mrz.js";
import { ITALY_DOCUMENT_TYPES } from "../src/italy.js";
import { SPAIN_DOCUMENT_TYPES } from "../src/spain.js";

const TODAY = "2099-06-01";
/** The parse, failing the test when no MRZ is found. */
function parseMrz(text: string, today: string): MrzFields {
  const m = parseOrNull(text, today);
  if (!m) throw new Error("no MRZ found");
  return m;
}
const pad = (s: string, n: number) => s.padEnd(n, "<");
const cd = checkDigit;

/** A passport (TD3), two lines of 44. */
function td3(o: { state: string; names: string; number: string; nat: string; birth: string; sex: string; expiry: string; personal?: string }): string {
  const l1 = pad(`P<${o.state}${o.names}`, 44);
  const personal = pad(o.personal ?? "", 14);
  const pcd = o.personal ? cd(personal) : "<";
  const num = pad(o.number, 9);
  const head = `${num}${cd(num)}${o.nat}${o.birth}${cd(o.birth)}${o.sex}${o.expiry}${cd(o.expiry)}${personal}${pcd}`;
  const composite = cd(`${num}${cd(num)}${o.birth}${cd(o.birth)}${o.expiry}${cd(o.expiry)}${personal}${pcd}`);
  return `${l1}\n${head}${composite}`;
}

/** An identity card (TD1), three lines of 30. */
function td1(o: { code: string; state: string; number: string; optional1: string; birth: string; sex: string; expiry: string; nat: string; names: string }): string {
  const num = pad(o.number, 9);
  const opt1 = pad(o.optional1, 15);
  const l1 = `${pad(o.code, 2)}${o.state}${num}${cd(num)}${opt1}`;
  const opt2 = pad("", 11);
  const l2body = `${o.birth}${cd(o.birth)}${o.sex}${o.expiry}${cd(o.expiry)}${o.nat}${opt2}`;
  const composite = cd(`${num}${cd(num)}${opt1}${o.birth}${cd(o.birth)}${o.expiry}${cd(o.expiry)}${opt2}`);
  return `${l1}\n${l2body}${composite}\n${pad(o.names, 30)}`;
}

describe("check digits", () => {
  it("follow ICAO 9303 part 3 (weights 7, 3, 1)", () => {
    expect(checkDigit("L898902C3")).toBe("6");
    expect(checkDigit("123456BB")).toBe("5");
    expect(checkDigit("<<<<")).toBe("0");
  });
});

describe("passports (TD3)", () => {
  const text = td3({ state: "ITA", names: "PROVA<<OSPITE<MARIA", number: "ZZ0000000", nat: "ITA", birth: "600315", sex: "F", expiry: "990110" });

  it("reads every field and checks every digit", () => {
    const m = parseMrz(text, TODAY);
    expect(m).toMatchObject({
      format: "TD3",
      documentCode: "P",
      issuingState: "ITA",
      documentNumber: "ZZ0000000",
      birthDate: "2060-03-15",
      sex: "female",
      expiryDate: "2099-01-10",
      nationality: "ITA",
      surnames: ["PROVA"],
      givenNames: ["OSPITE", "MARIA"],
      valid: true,
      failed: [],
    });
  });

  it("fills the guest: names, birth, sex, citizenship, document", () => {
    expect(guestFromMrz(parseMrz(text, TODAY))).toEqual({
      givenName: "Ospite Maria",
      surname1: "Prova",
      birthDate: "2060-03-15",
      sex: "female",
      nationality: "ITA",
      document: { type: "passport", number: "ZZ0000000", issuedIn: { country: "ITA" } },
    });
  });

  it("finds the lines in a noisy OCR text and repairs O and 0 in the dates", () => {
    const [l1, l2] = text.split("\n") as [string, string];
    const noisy = `REPUBBLICA DI PROVA\n${l1.toLowerCase().replace(/</g, "« ")}\n${l2.slice(0, 13)}6OO315${l2.slice(19)}\nfirma`;
    const m = parseMrz(noisy, TODAY);
    expect(m?.valid).toBe(true);
    expect(m?.birthDate).toBe("2060-03-15");
  });

  it("says which field is wrong when a check digit does not agree", () => {
    const [l1, l2] = text.split("\n") as [string, string];
    const wrong = `${l1}\n${l2.slice(0, 13)}600316${l2.slice(19)}`;
    const m = parseMrz(wrong, TODAY);
    expect(m?.valid).toBe(false);
    expect(m?.failed).toEqual(["birthDate", "composite"]);
  });

  it("reads Germany's single letter and a birth in the last century", () => {
    const de = td3({ state: "D<<", names: "PROBE<<GAST", number: "ZZ0000000", nat: "D<<", birth: "991231", sex: "M", expiry: "990101" });
    const m = parseMrz(de, TODAY);
    expect(m?.issuingState).toBe("DEU");
    expect(m?.nationality).toBe("DEU");
    expect(m?.birthDate).toBe("1999-12-31");
  });
});

describe("identity cards (TD1)", () => {
  it("reads a Spanish DNI: support number in the number field, DNI number in the optional data, two surnames", () => {
    const text = td1({ code: "ID", state: "ESP", number: "ZZZ000000", optional1: "00000000T", birth: "600315", sex: "F", expiry: "990110", nat: "ESP", names: "PRUEBA<EJEMPLO<<OSPITE" });
    const m = parseMrz(text, TODAY);
    expect(m.valid).toBe(true);
    expect(guestFromMrz(m)).toEqual({
      givenName: "Ospite",
      surname1: "Prueba",
      surname2: "Ejemplo",
      birthDate: "2060-03-15",
      sex: "female",
      nationality: "ESP",
      document: { type: "dni", number: "00000000T", support: "ZZZ000000", issuedIn: { country: "ESP" } },
    });
  });

  it("reads an Italian electronic identity card", () => {
    const text = td1({ code: "C", state: "ITA", number: "ZZ00000ZZ", optional1: "", birth: "600315", sex: "M", expiry: "990110", nat: "ITA", names: "PROVA<<OSPITE" });
    const m = parseMrz(text, TODAY);
    expect(m.valid).toBe(true);
    expect(guestFromMrz(m).document).toEqual({ type: "electronic_id", number: "ZZ00000ZZ", issuedIn: { country: "ITA" } });
  });

  it("follows the long-number rule: check digit '<', the number goes on in the optional data", () => {
    // Number ZZ0000000123 (12 characters): 9 in the field, "123" and its check digit in the optional data.
    const full = "ZZ0000000123";
    const l1 = `IDZZZ${full.slice(0, 9)}<${pad(`${full.slice(9)}${cd(full)}`, 15)}`;
    const opt2 = pad("", 11);
    const l2body = `600315${cd("600315")}M990110${cd("990110")}ZZZ${opt2}`;
    const composite = cd(`${l1.slice(5, 30)}600315${cd("600315")}990110${cd("990110")}${opt2}`);
    const m = parseMrz(`${l1}\n${l2body}${composite}\n${pad("PROVA<<OSPITE", 30)}`, TODAY);
    expect(m.documentNumber).toBe(full);
    expect(m.valid).toBe(true);
  });
});

describe("finding the MRZ", () => {
  it("returns null when there is none", () => {
    expect(findMrzLines("CARTA DI IDENTITÀ\nComune di Prova")).toBeNull();
    expect(parseOrNull("", TODAY)).toBeNull();
  });
});

describe("from the MRZ to the form", () => {
  const dni = guestFromMrz(parseMrz(td1({ code: "ID", state: "ESP", number: "ZZZ000000", optional1: "00000000T", birth: "600315", sex: "F", expiry: "990110", nat: "ESP", names: "PRUEBA<EJEMPLO<<OSPITE" }), TODAY));
  const cie = guestFromMrz(parseMrz(td1({ code: "C", state: "ITA", number: "ZZ00000ZZ", optional1: "", birth: "600315", sex: "M", expiry: "990110", nat: "ITA", names: "PROVA<<OSPITE" }), TODAY));
  const card = guestFromMrz(parseMrz(td1({ code: "ID", state: "D<<", number: "ZZ0000000", optional1: "", birth: "600315", sex: "M", expiry: "990110", nat: "D<<", names: "PROBE<<GAST" }), TODAY));

  it("fills the Spanish form: DNI with its support number, other cards as other documents", () => {
    expect(formValuesFromMrz(dni, SPAIN_DOCUMENT_TYPES, { email: "ospite.prova@example.com" })).toEqual({
      email: "ospite.prova@example.com",
      givenName: "Ospite",
      surname1: "Prueba",
      surname2: "Ejemplo",
      birthDate: "2060-03-15",
      sex: "female",
      nationality: "ESP",
      docType: "dni",
      docNumber: "00000000T",
      docSupport: "ZZZ000000",
      docCountry: "ESP",
    });
    expect(formValuesFromMrz(cie, SPAIN_DOCUMENT_TYPES, {}).docType).toBe("other");
    expect(formValuesFromMrz(card, SPAIN_DOCUMENT_TYPES, {}).docType).toBe("other");
  });

  it("fills the Italian form: the CIE as electronic card, a DNI or a foreign card as identity card", () => {
    expect(formValuesFromMrz(cie, ITALY_DOCUMENT_TYPES, {}).docType).toBe("electronic_id");
    expect(formValuesFromMrz(dni, ITALY_DOCUMENT_TYPES, {}).docType).toBe("id_card");
    expect(formValuesFromMrz(card, ITALY_DOCUMENT_TYPES, {})).toMatchObject({ docType: "id_card", docCountry: "DEU", nationality: "DEU" });
  });
});
