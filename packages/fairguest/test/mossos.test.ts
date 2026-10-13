import { describe, expect, it } from "vitest";
import { mossosFile, mossosRegistry } from "../src/countries/es-mossos.js";
import { NotAvailableError } from "../src/types.js";
import { child, holder, stay } from "./data.js";

describe("Mossos file", () => {
  it("writes record 1 and one record 2 per traveller, as in the manual's example", () => {
    const f = mossosFile([stay()], "checkin", "2099-06-10T18:05", 7);
    expect(f.name).toBe("ZZ00000000.007");
    expect(f.text.split("\r\n")).toEqual([
      "1|ZZ00000000|CASA DI PROVA|20990610|1805|2|V24",
      "2||ZZ0000000|P|20950110|PROVA|ESEMPIO|OSPITE|F|20600315|ITA|20990610|1600|20990613|1000|20990520|C|PROVA-0001|2|1|S|PLATF|||ospite.prova@example.com||VIA DI PROVA 1|||CITTÀ DI PROVA|ITA|00000|",
      "2|||||PROVA||ESEMPIO||20920701|ITA|20990610|1600|20990613|1000|20990520|C|PROVA-0001|2|1|S|PLATF|+39 000 000 0000|HJ|||VIA DI PROVA 1|||CITTÀ DI PROVA|ITA|00000|",
    ]);
    expect(f.text.endsWith("\r\n")).toBe(false);
    // Each record 2 has 32 fields plus the closing "|".
    for (const line of f.text.split("\r\n").slice(1)) expect(line.split("|")).toHaveLength(33);
    // Latin-1: "À" is one byte.
    expect(Buffer.from(f.bytes).toString("latin1")).toBe(f.text);
    expect(f.bytes.length).toBe(f.text.length);
  });

  it("puts a Spanish document in the Spanish field, with province and INE code for Spain", () => {
    const g = {
      ...holder(),
      document: { type: "dni" as const, number: "00000000T", support: "ZZZ000000" },
      address: { country: "ESP", street: "Calle de Prueba 1", postalCode: "08000", municipalityCode: "080000" },
      email: undefined,
      phone: "+34 000 000 000",
    };
    const line = mossosFile([stay({ people: 1, guests: [g] })], "checkin", "2099-06-10T18:05", 1).text.split("\r\n")[1] as string;
    const f = line.split("|");
    expect(f[1]).toBe("00000000T");
    expect(f[2]).toBe("");
    expect(f[3]).toBe("D");
    expect(f[22]).toBe("+34 000 000 000");
    expect(f[25]).toBe("ZZZ000000");
    expect(f.slice(26, 32)).toEqual(["CALLE DE PRUEBA 1", "08", "080000", "", "ESP", "08000"]);
  });

  it("writes only the holder for a reservation, with the R type", () => {
    const f = mossosFile([stay()], "reservation", "2099-05-20T10:00", 1);
    const lines = f.text.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("1|ZZ00000000|CASA DI PROVA|20990520|1000|1|V24");
    expect(lines[1]?.split("|")[16]).toBe("R");
  });

  it("keeps separators and line breaks out of the fields", () => {
    const g = { ...holder(), address: { country: "ITA", street: "Via | di\r\nProva", locality: "Prova" } };
    const line = mossosFile([stay({ people: 1, guests: [g] })], "checkin", "2099-06-10T18:05", 1).text.split("\r\n")[1] as string;
    expect(line.split("|")).toHaveLength(33);
    expect(line).toContain("|VIA DI PROVA|");
  });

  it("refuses letters outside the Western alphabet, mixed establishments and bad sequences", () => {
    const g = { ...holder(), surname1: "Пробa" };
    expect(mossosRegistry.validate(stay({ people: 1, guests: [g] }), "checkin").map((p) => p.path)).toContain("guests[0].surname1");
    expect(() => mossosFile([stay({ people: 1, guests: [g] })], "checkin", "2099-06-10T18:05", 1)).toThrow(/Western European/);
    expect(() => mossosFile([stay(), stay({ establishment: "ZZ00000001" })], "checkin", "2099-06-10T18:05", 1)).toThrow(/one establishment/);
    expect(() => mossosFile([stay()], "checkin", "2099-06-10T18:05", 1000)).toThrow(/1 to 999/);
  });

  it("prepare validates first and explains what is missing", () => {
    expect(() => mossosRegistry.prepare([stay({ establishmentName: undefined })], "checkin", "2099-06-10T18:05")).toThrow(NotAvailableError);
    expect(() => mossosRegistry.prepare([stay({ establishmentName: undefined })], "checkin", "2099-06-10T18:05")).toThrow(/establishmentName/);
    const ok = mossosRegistry.prepare([stay()], "checkin", "2099-06-10T18:05");
    expect(ok).toMatchObject({ country: "ES-CT", kind: "checkin", channel: "file", stayIds: ["stay-prova-1"] });
  });

  it("asks a contact of the holder also for a reservation", () => {
    const g = { givenName: "Ospite", surname1: "Prova" };
    expect(mossosRegistry.validate(stay({ guests: [g] }), "reservation").map((p) => p.path)).toEqual(["guests[0]"]);
    expect(mossosRegistry.validate(stay({ guests: [{ ...g, email: "ospite.prova@example.com" }, child()] }), "reservation")).toEqual([]);
  });
});
