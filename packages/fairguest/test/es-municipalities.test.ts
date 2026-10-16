import { describe, expect, it } from "vitest";
import { esMunicipalities, esMunicipalityByCode, findEsMunicipality, sesMunicipalityCode } from "../src/countries/es-municipalities.js";
import { ES_MUNICIPALITIES_YEAR, ES_PROVINCES } from "../src/countries/es-municipalities-data.js";
import { errorsByField, guestInput, renderForm } from "../src/form/render.js";
import { WORDS } from "../src/form/words.js";
import { registryFor } from "../src/registry.js";
import { parseGuest } from "../src/validate.js";
import { TODAY } from "./data.js";

const code = (text: string, postalCode?: string) => {
  const r = findEsMunicipality(text, postalCode);
  return "municipality" in r ? r.municipality.code : r.problem;
};

describe("the INE's list of municipalities", () => {
  it("has every province and municipality of the official file, each code once", () => {
    const all = esMunicipalities();
    expect(ES_MUNICIPALITIES_YEAR).toBe(2026);
    expect(Object.keys(ES_PROVINCES)).toHaveLength(52);
    expect(all.length).toBe(8132);
    expect(new Set(all.map((m) => m.code)).size).toBe(all.length);
    expect(all.every((m) => /^\d{6}$/.test(m.code) && ES_PROVINCES[m.code.slice(0, 2)] === m.province)).toBe(true);
  });

  it("finds a town by its name, whatever the case and accents, with the 6-digit code", () => {
    expect(findEsMunicipality("Adeje")).toEqual({ municipality: { code: "380012", name: "Adeje", province: "Santa Cruz de Tenerife", label: "Adeje (Santa Cruz de Tenerife)" } });
    expect(code("ADEJE (santa cruz de tenerife)")).toBe("380012");
    expect(code("málaga")).toBe(code("Malaga"));
    expect(code("Barcelona")).toBe("080193");
  });

  it("puts the article back in front, and answers to each half of a bilingual name", () => {
    expect(esMunicipalityByCode("350167")?.name).toBe("Las Palmas de Gran Canaria");
    expect(code("Las Palmas de Gran Canaria")).toBe("350167");
    expect(code("Palmas de Gran Canaria, Las")).toBe("350167");
    expect(code("San Sebastián")).toBe(code("Donostia"));
    expect(code("Vitoria")).toBe(code("Vitoria-Gasteiz"));
    expect(code("L'Hospitalet de Llobregat")).toBe("081017");
  });

  it("tells apart towns of the same name with the postal code, and refuses what is not a municipality", () => {
    expect(findEsMunicipality("Arroyomolinos")).toMatchObject({ problem: "ambiguous", candidates: [{ province: "Cáceres" }, { province: "Madrid" }] });
    expect(code("Arroyomolinos", "28939")).toBe("280151");
    expect(code("Arroyomolinos (Cáceres)")).toBe("100232");
    expect(code("Costa Adeje")).toBe("not_found");
    expect(code("")).toBe("not_found");
  });

  it("reads codes of 5 digits (SES) and of 6 (Mossos), and gives SES its 5", () => {
    expect(esMunicipalityByCode("38001")?.code).toBe("380012");
    expect(esMunicipalityByCode("380012")?.name).toBe("Adeje");
    expect(esMunicipalityByCode("380017")).toBeNull();
    expect(esMunicipalityByCode("99999")).toBeNull();
    expect(sesMunicipalityCode("380012")).toBe("38001");
  });

  it("checks the code a host types: 5 digits are completed, an unknown code is refused", () => {
    const ok = parseGuest({ givenName: "Ospite", surname1: "Prova", address: { country: "ESP", postalCode: "38670", municipalityCode: "38001" } }, TODAY);
    expect(ok.problems).toEqual([]);
    expect(ok.guest?.address?.municipalityCode).toBe("380012");
    const bad = parseGuest({ givenName: "Ospite", surname1: "Prova", address: { country: "ESP", municipalityCode: "380017" } }, TODAY);
    expect(bad.problems.map((p) => p.path)).toEqual(["guest.address.municipalityCode"]);
  });
});

describe("the town in the check-in form", () => {
  const form = (fields: Record<string, string>) => new URLSearchParams({ givenName: "Ospite", surname1: "Prova", country: "ESP", street: "Calle de Prueba 1", ...fields });

  it("gives a Spanish address its INE code and the INE's name, so the guest needs no correction", () => {
    const input = guestInput(form({ postalCode: "38670", locality: "adeje" }));
    expect(input.address).toMatchObject({ country: "ESP", locality: "Adeje", municipalityCode: "380012" });
    const picked = guestInput(form({ postalCode: "28939", locality: "Arroyomolinos (Madrid)" }));
    expect(picked.address).toMatchObject({ municipalityCode: "280151" });
  });

  it("leaves an address abroad as it was typed", () => {
    const input = guestInput(new URLSearchParams({ country: "NLD", locality: "Utrecht", postalCode: "3511 AB" }));
    expect(input.address).toEqual({ country: "NLD", street: "", postalCode: "3511 AB", locality: "Utrecht", province: "" });
  });

  it("asks to pick the municipality from the list when the town is not one, in the guest's language", () => {
    for (const [lang, country] of [
      ["es", "ES"],
      ["it", "ES-CT"],
    ] as const) {
      const parsed = parseGuest(guestInput(form({ postalCode: "38670", locality: "Costa Adeje" })), TODAY);
      const problems = registryFor(country).checkGuest(parsed.draft, 0, "2026-10-16");
      expect(problems.map((p) => p.path)).toContain("guests[0].address.municipalityCode");
      expect(errorsByField(problems, WORDS[lang]).get("locality")).toBe(WORDS[lang].invalidFor.municipality);
    }
  });

  it("is complete for SES and the Mossos once the guest picks the town", () => {
    const parsed = parseGuest(guestInput(form({ postalCode: "38670", locality: "Adeje", phone: "+34 600 000 000", birthDate: "1988-07-02" })), TODAY);
    for (const country of ["ES", "ES-CT"] as const) {
      expect(registryFor(country).checkGuest(parsed.draft, 0, "2026-10-16").filter((p) => p.path.includes("address"))).toEqual([]);
    }
  });

  it("offers every municipality as a suggestion in Spain's form, never in Italy's", () => {
    const html = renderForm(WORDS.es, "es", "ES", "/checkin/x", "t", 0, { values: {}, errors: new Map() });
    expect(html).toContain('list="es-towns"');
    expect(html).toContain('<option value="Adeje (Santa Cruz de Tenerife)">');
    expect(html.match(/<option value="[^"]*\([^"]*\)">/g)?.length).toBe(8132);
    expect(html).toContain(WORDS.es.hints.town);
    expect(renderForm(WORDS.it, "it", "IT", "/checkin/x", "t", 0, { values: {}, errors: new Map() })).not.toContain("es-towns");
  });
});
