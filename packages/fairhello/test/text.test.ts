import { describe, expect, it } from "vitest";
import { findPrices, languageCode, plainText, topicsOf } from "../src/index.js";

describe("plainText", () => {
  it("takes the markdown out", () => {
    expect(plainText("## Check-in\n**From 16:00**, __easy__.\n- keys in the box\n* parking free  \n\n\n\nBye")).toBe(
      "Check-in\nFrom 16:00, easy.\n• keys in the box\n• parking free\n\nBye",
    );
  });
});

describe("findPrices", () => {
  it("finds amounts with a currency, before or after", () => {
    expect(findPrices("It costs €80 or 80 € or 80,50 EUR, $ 120, £30 and 45 euros.")).toEqual(["€80", "80 €", "80,50 EUR", "$ 120", "£30", "45 euros"]);
    expect(findPrices("Sono 90 euro a notte, 1.200 eur in tutto")).toEqual(["90 euro", "1.200 eur"]);
  });

  it("does not take times, dates, floors or codes for prices", () => {
    expect(findPrices("Check-in from 16:00 on 2026-11-03, 3rd floor, room 12, code 4471, Europe is nice")).toEqual([]);
  });
});

describe("topicsOf", () => {
  it("spots money, complaints, cancellations and emergencies in several languages", () => {
    expect(topicsOf("Can we get a discount for a week?")).toEqual(["money"]);
    expect(topicsOf("La doccia non funziona e la casa è sporca")).toEqual(["complaint"]);
    expect(topicsOf("Quiero cancelar la reserva y el reembolso")).toEqual(["money", "cancellation"]);
    expect(topicsOf("Es gibt einen Notfall, Wasserschaden!")).toEqual(["emergency"]);
    expect(topicsOf("What time is check-in? And the wifi?")).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(topicsOf("The prepayment page")).toEqual([]);
    expect(topicsOf("I love the fireplace")).toEqual([]);
  });
});

describe("languageCode", () => {
  it("keeps the language part of a locale", () => {
    expect(languageCode("en-GB")).toBe("en");
    expect(languageCode("DE")).toBe("de");
    expect(languageCode("pt_BR")).toBe("pt");
    expect(languageCode("English")).toBeNull();
    expect(languageCode(null)).toBeNull();
    expect(languageCode(3)).toBeNull();
  });
});
