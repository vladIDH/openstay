import { describe, expect, it } from "vitest";
import { parseGuest, spainRules, validDni, validNie } from "../src/validate.js";
import { child, holder, stay, TODAY } from "./data.js";

describe("parseGuest", () => {
  it("reads a complete guest and normalises it", () => {
    const r = parseGuest(
      {
        givenName: "  Ospite ",
        surname1: "Prova",
        birthDate: "2060-03-15",
        nationality: "ita",
        document: { type: "passport", number: "zz 000 0000" },
        address: { country: "ita", street: "Via di Prova 1", locality: "Città di Prova" },
        email: "ospite.prova@example.com",
      },
      TODAY,
    );
    expect(r.problems).toEqual([]);
    expect(r.guest).toMatchObject({ givenName: "Ospite", nationality: "ITA", document: { type: "passport", number: "ZZ0000000" }, address: { country: "ITA" } });
  });

  it("never keeps fields it does not know, like a card number or an IBAN", () => {
    const r = parseGuest({ givenName: "Ospite", surname1: "Prova", cardNumber: "0000 0000 0000 0000", iban: "ZZ00 0000", payment: { number: "1" } }, TODAY);
    expect(r.guest).toEqual({ givenName: "Ospite", surname1: "Prova" });
  });

  it("reports every problem with its path", () => {
    const r = parseGuest(
      { givenName: "", surname1: "Prova1", birthDate: "2100-01-01", sex: "x", nationality: "ZZZ", email: "no", phone: "abc", document: { type: "dni", number: "00000000A" } },
      TODAY,
    );
    expect(r.guest).toBeNull();
    expect(r.problems.map((p) => p.path)).toEqual([
      "guest.givenName",
      "guest.surname1",
      "guest.birthDate",
      "guest.sex",
      "guest.nationality",
      "guest.document.number",
      "guest.phone",
      "guest.email",
    ]);
  });

  it("checks Spanish addresses and codes", () => {
    const r = parseGuest({ givenName: "Ospite", surname1: "Prova", address: { country: "ESP", postalCode: "123", municipalityCode: "12" } }, TODAY);
    expect(r.problems.map((p) => p.path)).toEqual(["guest.address.postalCode", "guest.address.municipalityCode"]);
    expect(parseGuest({ givenName: "Ospite", surname1: "Prova", address: { street: "Calle de Prueba 1" } }, TODAY).problems[0]?.path).toBe("guest.address.country");
  });

  it("knows the check letter of DNI and NIE", () => {
    expect(validDni("00000000T")).toBe(true);
    expect(validDni("00000000A")).toBe(false);
    expect(validNie("X0000000T")).toBe(true);
    expect(validNie("X0000000A")).toBe(false);
  });
});

describe("Real Decreto 933/2021 rules", () => {
  it("accepts a complete stay", () => {
    expect(spainRules(stay(), "checkin", 18)).toEqual([]);
  });

  it("asks less for a reservation", () => {
    const s = stay({ guests: [{ givenName: "Ospite", surname1: "Prova" }] });
    expect(spainRules(s, "reservation", 18)).toEqual([]);
    expect(spainRules(s, "checkin", 18).map((p) => p.path)).toContain("guests");
  });

  it("asks for the payment type and the contract", () => {
    const s = stay({ payment: undefined, reference: "", people: 0 });
    expect(spainRules(s, "reservation", 18).map((p) => p.path)).toEqual(["reference", "people", "payment.type"]);
  });

  it("asks for documents from the given age, and for the kinship of minors", () => {
    const kid = { ...child(), kinship: undefined };
    const s = stay({ guests: [holder(), kid] });
    expect(spainRules(s, "checkin", 18).map((p) => p.path)).toEqual(["guests[1].kinship"]);
    // Born 2092-07-01: 6 years old at check-in. With the Mossos rule (14) still no document.
    expect(spainRules(stay(), "checkin", 14)).toEqual([]);
    const teen = { ...child(), birthDate: "2084-01-01" };
    expect(spainRules(stay({ guests: [holder(), teen] }), "checkin", 14).map((p) => p.path)).toEqual(["guests[1].document"]);
  });

  it("asks for support number and second surname with a DNI, and the INE code in Spain", () => {
    const g = { ...holder(), surname2: undefined, document: { type: "dni" as const, number: "00000000T" }, address: { country: "ESP", street: "Calle de Prueba 1" } };
    expect(spainRules(stay({ people: 1, guests: [g] }), "checkin", 18).map((p) => p.path)).toEqual([
      "guests[0].address.municipalityCode",
      "guests[0].address.postalCode",
      "guests[0].document.support",
      "guests[0].surname2",
    ]);
  });

  it("asks for a contact and too many guests are reported", () => {
    const g = { ...holder(), email: undefined };
    expect(spainRules(stay({ people: 1, guests: [g, child()] }), "checkin", 18).map((p) => p.path)).toEqual(["people", "guests[0]"]);
  });
});
