/**
 * The tourist tax: who pays, the cap on nights, seasons, the summary for the
 * town, and the payments card. Invented stays in 2099 only.
 */
import { describe, expect, it } from "vitest";
import {
  classifyGuest,
  isStripePayUrl,
  linkFor,
  nightsOf,
  payCard,
  periodRange,
  readLinkFragment,
  stayTax,
  summaryCsv,
  summaryPdf,
  TAX_PLACES,
  taxRuleFor,
  taxSummary,
  validateGuestSettings,
  validateTaxRule,
  verifyTexts,
  type TaxRule,
} from "../src/index.js";

const RULE: TaxRule = { place: "prova", name: "Città di Prova", currency: "EUR", rate: 3.5, maxNights: 5, exemptUnderAge: 14, residentsExempt: true };

describe("who pays", () => {
  it("guests under the age do not pay; the age is the one on the day of check-in", () => {
    expect(classifyGuest(RULE, { birthDate: "2085-06-11" }, "2099-06-10")).toBe("exempt-age"); // 13, turns 14 the next day
    expect(classifyGuest(RULE, { birthDate: "2085-06-10" }, "2099-06-10")).toBe("pays"); // 14 that day
    expect(classifyGuest(RULE, { birthDate: "2060-01-01" }, "2099-06-10")).toBe("pays");
  });

  it("residents do not pay only where the town says so; age wins over residence", () => {
    expect(classifyGuest(RULE, { birthDate: "2060-01-01", resident: true }, "2099-06-10")).toBe("exempt-resident");
    expect(classifyGuest({ ...RULE, residentsExempt: false }, { birthDate: "2060-01-01", resident: true }, "2099-06-10")).toBe("pays");
    expect(classifyGuest(RULE, { birthDate: "2095-01-01", resident: true }, "2099-06-10")).toBe("exempt-age");
  });

  it("without a birth date the guest pays (the host can change it)", () => {
    expect(classifyGuest(RULE, {}, "2099-06-10")).toBe("pays");
  });
});

describe("the tax of a stay", () => {
  it("counts only paying guests and only the first maxNights nights", () => {
    // 7 nights, cap 5; two adults pay, one child and one resident do not.
    const t = stayTax(RULE, "2099-06-10", "2099-06-17", ["pays", "pays", "exempt-age", "exempt-resident"]);
    expect(t.nights).toHaveLength(7);
    expect(t.nights.filter((n) => n.taxed)).toHaveLength(5);
    expect(t.personNights).toBe(10);
    expect(t.totalCents).toBe(3500); // 2 × 5 × 3.50
    expect(t.exemptPersonNights).toEqual({ age: 5, resident: 5, other: 0, cap: 4 });
  });

  it("guests not opened yet are counted apart and pay nothing until classified", () => {
    const t = stayTax(RULE, "2099-06-10", "2099-06-12", ["pays", null]);
    expect(t.guests.unknown).toBe(1);
    expect(t.totalCents).toBe(700);
  });

  it("seasons change the rate night by night, also across the new year", () => {
    const rule: TaxRule = { ...RULE, maxNights: undefined as unknown as number, seasons: [{ from: "12-30", to: "01-01", rate: 1 }] };
    delete (rule as Partial<TaxRule>).maxNights;
    const t = stayTax(rule, "2099-12-29", "2100-01-03", ["pays"]);
    expect(t.nights.map((n) => n.rateCents)).toEqual([350, 100, 100, 100, 350]);
    expect(t.totalCents).toBe(1000);
  });

  it("no tax (Canary Islands): zero, and no night counts as over the cap", () => {
    const canarias = taxRuleFor({ place: "canarias" }, "t").value as TaxRule;
    const t = stayTax(canarias, "2099-06-10", "2099-06-20", ["pays", "pays"]);
    expect(t.totalCents).toBe(0);
    expect(t.exemptPersonNights.cap).toBe(0);
  });

  it("a period keeps the cap counted from the first night of the stay", () => {
    // 30 June to 4 July: nights 30/6 (1), 1/7 (2), 2/7 (3), 3/7 (4); cap 2.
    const rule = { ...RULE, maxNights: 2 };
    expect(stayTax(rule, "2099-06-30", "2099-07-04", ["pays"], { from: "2099-07-01", to: "2099-07-31" }).personNights).toBe(1);
    expect(stayTax(rule, "2099-06-30", "2099-07-04", ["pays"], { from: "2099-06-01", to: "2099-06-30" }).personNights).toBe(1);
  });

  it("nights: check-in included, check-out not", () => {
    expect(nightsOf("2099-02-27", "2099-03-02")).toEqual(["2099-02-27", "2099-02-28", "2099-03-01"]);
  });
});

describe("rules", () => {
  it("every starting value has an official source and the day it was read; Bologna has no single rate", () => {
    for (const p of Object.values(TAX_PLACES)) {
      if (p.place === "canarias") continue;
      expect(p.source?.url, p.place).toMatch(/^https?:\/\//);
      expect(p.source?.checkedOn, p.place).toBe("2026-10-15");
      if (p.rate !== null) expect(taxRuleFor({ place: p.place }, "t").issues, p.place).toEqual([]);
    }
    expect(TAX_PLACES.bologna?.rate).toBeNull();
    expect(taxRuleFor({ place: "bologna" }, "t").issues[0]?.message).toMatch(/no official rate/);
    expect(taxRuleFor({ place: "bologna", rate: 5.8 }, "t").value?.rate).toBe(5.8);
  });

  it("Barcelona: the Catalan tax plus the city's surcharge, under 17 exempt, 7 nights", () => {
    const b = taxRuleFor({ place: "barcelona" }, "t").value as TaxRule;
    expect(b.rate).toBe(9.5);
    expect(b.components?.map((c) => c.rate)).toEqual([4.5, 5]);
    expect(b.exemptUnderAge).toBe(17);
    expect(b.maxNights).toBe(7);
    expect(b.period).toBe("half-yearly");
  });

  it("the host's own figures win, and then the official source is not shown as theirs", () => {
    const r = taxRuleFor({ place: "roma", rate: 5 }, "t").value as TaxRule;
    expect(r.rate).toBe(5);
    expect(r.maxNights).toBe(10);
    expect(r.source).toBeUndefined();
    expect(taxRuleFor({ place: "roma" }, "t").value?.source?.checkedOn).toBe("2026-10-15");
  });

  it("a town of the host's own needs name and rate; bad fields are reported with their path", () => {
    expect(taxRuleFor({ place: "borgo-prova", name: "Borgo di Prova", rate: 2 }, "t").value?.rate).toBe(2);
    const bad = validateTaxRule({ place: "x", name: "X", rate: 2.555, maxNights: 0, seasons: [{ from: "13-01", to: "01-01", rate: 1 }], extra: 1 }, "t");
    expect(bad.issues.map((i) => i.path).sort()).toEqual(["t.extra", "t.maxNights", "t.rate", "t.seasons[0]"]);
  });

  it("payments are off unless enabled, and need something to ask", () => {
    const base = { country: "ES-CT", establishment: "ZZ00000000" };
    expect(validateGuestSettings({ ...base, touristTax: { place: "barcelona" } }, "f").value?.payments).toBeUndefined();
    const on = validateGuestSettings({ ...base, touristTax: { place: "barcelona" }, payments: { enabled: true, deposit: 200 } }, "f").value?.payments;
    expect(on).toEqual({ enabled: true, collectTax: true, deposit: 200, depositDaysBefore: 2, currency: "EUR" });
    expect(validateGuestSettings({ ...base, payments: { enabled: true } }, "f").issues[0]?.message).toMatch(/nothing to ask/);
    expect(validateGuestSettings({ ...base, payments: { enabled: true, collectTax: true } }, "f").issues.map((i) => i.path)).toContain("f.payments.collectTax");
    expect(validateGuestSettings({ ...base, payments: { enabled: true, deposit: 100, depositDaysBefore: 9 } }, "f").issues.map((i) => i.path)).toEqual(["f.payments.depositDaysBefore"]);
  });
});

describe("summary for the town", () => {
  const stays = [
    { id: "fg1", listing: "casa-prova", checkIn: "2099-06-10", checkOut: "2099-06-13", classes: ["pays", "exempt-age"] as const, paidCents: 1050 },
    { id: "fg2", listing: "casa-prova", checkIn: "2099-06-29", checkOut: "2099-07-03", classes: ["pays", "pays", null] as const, paidCents: 0 },
    { id: "fg3", listing: "casa-prova", checkIn: "2099-08-01", checkOut: "2099-08-03", classes: ["pays"] as const, paidCents: 0 },
  ].map((s) => ({ ...s, classes: [...s.classes] }));

  it("a month: stays with nights inside it, split at the month's end", () => {
    const s = taxSummary(RULE, periodRange("2099-06") as { from: string; to: string; label: string }, stays);
    expect(s.rows.map((r) => [r.id, r.nights, r.personNights, r.dueCents])).toEqual([
      ["fg1", 3, 3, 1050],
      ["fg2", 2, 4, 1400],
    ]);
    expect(s.totals.dueCents).toBe(2450);
    expect(s.incomplete).toBe(1);
  });

  it("a quarter, as CSV for Excel (semicolons, decimal comma, byte-order mark)", () => {
    const period = periodRange("2099-Q3") as { from: string; to: string; label: string };
    expect(period).toEqual({ from: "2099-07-01", to: "2099-09-30", label: "2099-Q3" });
    const csv = summaryCsv(taxSummary(RULE, period, stays), "it");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toMatch(/^Soggiorno;Annuncio;Arrivo;Partenza;Notti;Ospiti;Paganti;Ridotti;Esenti età/);
    expect(lines[1]).toBe("fg2;casa-prova;2099-06-29;2099-07-03;2;3;2;0;0;0;0;1;4;0;14,00;0,00");
    expect(lines.at(-1)).toMatch(/^Totale;;2099-07-01;2099-09-30;4;4;3;/);
  });

  it("as PDF: a real PDF file with the town and the total", () => {
    const pdf = summaryPdf(taxSummary(RULE, periodRange("2099-06") as { from: string; to: string; label: string }, stays), "it", "2099-07-02");
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("(Comune: Citt\xe0 di Prova)");
    expect(text).toContain("24,50 \x80");
    // The xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const first = /0000000000 65535 f \n(\d{10})/.exec(text)?.[1] as string;
    expect(text.slice(Number(first), Number(first) + 7)).toBe("1 0 obj");
  });
});

describe("the payments card", () => {
  const day = (d: string) => d;
  it("links only to Stripe's own pages", () => {
    expect(isStripePayUrl("https://buy.stripe.com/test_abc123")).toBe(true);
    expect(isStripePayUrl("https://checkout.stripe.com/c/pay/cs_test_abc")).toBe(true);
    expect(isStripePayUrl("https://stripe.com.evil.example/x")).toBe(false);
    expect(isStripePayUrl("javascript:alert(1)")).toBe(false);
    const html = payCard({ items: [{ kind: "tax", amountCents: 2850, currency: "EUR", state: "open", url: "https://evil.example/pay" }] }, "it", day);
    expect(html).not.toContain("evil.example");
  });

  it("tax to pay, deposit later, in the guest's language", () => {
    const html = payCard(
      {
        town: "Barcelona",
        items: [
          { kind: "tax", amountCents: 2850, currency: "EUR", state: "open", url: "https://buy.stripe.com/test_abc", people: 1, nights: 3 },
          { kind: "deposit", amountCents: 20000, currency: "EUR", state: "later", from: "2099-06-08" },
        ],
      },
      "es",
      day,
    );
    expect(html).toContain("Impuesto turístico · Barcelona");
    expect(html).toContain('href="https://buy.stripe.com/test_abc"');
    expect(html).toContain("1 persona × 3 noches");
    expect(html).toContain("Se deja desde el 2099-06-08");
    expect(payCard({ items: [] }, "it", day)).toBe("");
  });

  it("the link of the check-in carries the town when residents do not pay", () => {
    const url = linkFor("https://relay.example.invalid", "A".repeat(22), { k: "k".repeat(43), w: "w".repeat(22), c: "IT", n: "Casa", i: "2099-06-10", o: "2099-06-13", t: "Roma" });
    expect(readLinkFragment(url.slice(url.indexOf("#")))?.t).toBe("Roma");
  });
});

describe("reduced rates by age", () => {
  const verona = taxRuleFor({ place: "verona" }, "t").value as TaxRule;
  const venezia = taxRuleFor({ place: "venezia" }, "t").value as TaxRule;
  const born = (age: number, birthday = "06-10") => `${2099 - age}-${birthday}`;

  it("Verona: 2.80 from 15 to the day before 26, and from the day of 70; under 15 exempt", () => {
    const c = (age: number, birthday?: string) => classifyGuest(verona, { birthDate: born(age, birthday) }, "2099-06-10");
    expect(c(14)).toBe("exempt-age");
    expect(c(15)).toBe("reduced:15-25");
    expect(c(25)).toBe("reduced:15-25");
    expect(c(25, "06-11")).toBe("reduced:15-25"); // 25, turns 26 tomorrow
    expect(c(26)).toBe("pays");
    expect(c(69, "06-11")).toBe("pays"); // 69, turns 70 tomorrow
    expect(c(70)).toBe("reduced:70-");
    // An adult, a 20-year-old and a 75-year-old, 3 nights: 3 × 3.50 + 2 × 3 × 2.80.
    const t = stayTax(verona, "2099-06-10", "2099-06-13", ["pays", "reduced:15-25", "reduced:70-"]);
    expect(t.totalCents).toBe(1050 + 1680);
    expect(t.personNights).toBe(9);
    expect(t.reducedPersonNights).toBe(6);
  });

  it("Venezia: half from 10 to 16 not completed, on the night's own rate (January too)", () => {
    const c = (age: number) => classifyGuest(venezia, { birthDate: born(age) }, "2099-06-10");
    expect([c(9), c(10), c(15), c(16)]).toEqual(["exempt-age", "reduced:10-15", "reduced:10-15", "pays"]);
    // 30 Dec to 2 Jan: 4.00, 4.00 then 2.80 in January; the 12-year-old pays half of each.
    const t = stayTax(venezia, "2099-12-30", "2100-01-02", ["pays", "reduced:10-15"]);
    expect(t.totalCents).toBe(400 + 400 + 280 + 200 + 200 + 140);
  });

  it("the cap counts reduced guests too, and a band removed by the host means the full rate", () => {
    const t = stayTax(verona, "2099-06-10", "2099-06-16", ["reduced:15-25"]);
    expect(t.exemptPersonNights.cap).toBe(2);
    expect(t.totalCents).toBe(4 * 280);
    const without = { ...verona, ageBands: [] };
    expect(stayTax(without, "2099-06-10", "2099-06-11", ["reduced:15-25"]).totalCents).toBe(350);
  });

  it("the host writes bands in the config: either an amount or a percent, ages in order", () => {
    const ok = taxRuleFor({ place: "borgo", name: "Borgo", rate: 2, ageBands: [{ fromAge: 65, rate: 1 }] }, "t");
    expect(ok.value?.ageBands).toEqual([{ fromAge: 65, rate: 1 }]);
    const bad = taxRuleFor({ place: "borgo", name: "Borgo", rate: 2, ageBands: [{ fromAge: 20, toAge: 10, rate: 1, percent: 50 }, { fromAge: 5 }] }, "t");
    expect(bad.issues.map((i) => i.path)).toEqual(["t.ageBands[0].toAge", "t.ageBands[0]", "t.ageBands[1]"]);
  });

  it("the summary counts reduced guests apart", () => {
    const s = taxSummary(verona, periodRange("2099-06") as { from: string; to: string; label: string }, [{ id: "fg1", listing: "x", checkIn: "2099-06-10", checkOut: "2099-06-11", classes: ["pays", "reduced:70-"], paidCents: 0 }]);
    expect(s.rows[0]).toMatchObject({ paying: 1, reduced: 1, personNights: 2, dueCents: 630 });
  });
});

describe("points to check with the town", () => {
  it("Napoli, Genova, Bari and Catania carry the words of the regulation and the link, until the host confirms", () => {
    for (const place of ["napoli", "genova", "bari", "catania"]) {
      const rule = taxRuleFor({ place }, "t").value as TaxRule;
      expect(rule.verify?.[0]?.field, place).toBe("exemptUnderAge");
      expect(rule.verify?.[0]?.quote, place).toMatch(/minori (entro il|fino al) (quattordicesimo|sedicesimo) anno/);
      expect(rule.verify?.[0]?.url, place).toMatch(/^https:\/\//);
    }
    expect(taxRuleFor({ place: "napoli", confirmed: true }, "t").value?.verify).toBeUndefined();
    // Writing the age is the host's answer too.
    const fifteen = taxRuleFor({ place: "napoli", exemptUnderAge: 15 }, "t").value as TaxRule;
    expect(fifteen.verify).toBeUndefined();
    expect(fifteen.exemptUnderAge).toBe(15);
    expect(taxRuleFor({ place: "roma" }, "t").value?.verify).toBeUndefined();
  });

  it("says what is computed meanwhile and how to settle it, in the host's language", () => {
    const catania = taxRuleFor({ place: "catania" }, "t").value as TaxRule;
    const [it] = verifyTexts(catania, "it");
    expect(it?.title).toBe("Da verificare: età esenti a Catania");
    expect(it?.explain).toContain("esenta chi ha meno di 16 anni");
    expect(it?.explain).toContain('"exemptUnderAge": 17');
    expect(verifyTexts(catania, "es")[0]?.title).toBe("Por verificar: edades exentas en Catania");
  });

  it("the summary shows them under the figures, in the CSV and in the PDF", () => {
    const bari = taxRuleFor({ place: "bari" }, "t").value as TaxRule;
    const s = taxSummary(bari, periodRange("2099-06") as { from: string; to: string; label: string }, []);
    const csv = summaryCsv(s, "it");
    expect(csv).toContain("DA VERIFICARE: ETÀ ESENTI A BARI");
    expect(csv).toContain("i minori entro il quattordicesimo anno di età");
    expect(csv).toContain("342913_CIMUNIC-13ba23a662AM.pdf");
    const pdf = Buffer.from(summaryPdf(s, "it", "2099-07-01")).toString("latin1");
    expect(pdf).toContain("(DA VERIFICARE: ET\xc0 ESENTI A BARI)");
    expect(summaryCsv(taxSummary({ ...bari, verify: undefined } as TaxRule, s.period, []), "it")).not.toContain("VERIFICARE");
  });
});
