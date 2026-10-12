import { describe, expect, it } from "vitest";
import { parseDate, parsePrice, parsePricesCsv } from "../src/prices-csv.js";

describe("dates", () => {
  it("reads ISO and European day-first dates", () => {
    expect(parseDate("2026-11-03")).toBe("2026-11-03");
    expect(parseDate("2026/11/03")).toBe("2026-11-03");
    expect(parseDate("03/11/2026")).toBe("2026-11-03");
    expect(parseDate("3-11-2026")).toBe("2026-11-03");
    expect(parseDate("03.11.2026")).toBe("2026-11-03");
    expect(parseDate("2026-11-03 00:00:00")).toBe("2026-11-03");
    expect(parseDate("2026-11-03T00:00:00Z")).toBe("2026-11-03");
  });

  it("refuses impossible or unknown dates", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("11/03/26")).toBeNull();
    expect(parseDate("Nov 3, 2026")).toBeNull();
  });
});

describe("prices", () => {
  it("reads the usual ways of writing a price", () => {
    expect(parsePrice("120")).toBe(120);
    expect(parsePrice("92.50")).toBe(92.5);
    expect(parsePrice("92,50")).toBe(92.5);
    expect(parsePrice("€ 1.234,56")).toBe(1234.56);
    expect(parsePrice("1,234.56 EUR")).toBe(1234.56);
    expect(parsePrice("1.234")).toBe(1234);
    expect(parsePrice("1,234")).toBe(1234);
    expect(parsePrice("$89")).toBe(89);
    expect(parsePrice("1 050,00 €")).toBe(1050);
  });

  it("refuses non-prices", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("free")).toBeNull();
    expect(parsePrice("-20")).toBeNull();
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice("1.2.3,4,5")).toBeNull();
  });
});

describe("price files", () => {
  it("reads a comma file with an English header and extra columns", () => {
    const r = parsePricesCsv("Date,Listing,Price,Currency\n2026-06-01,Loft,95.00,EUR\n2026-06-02,Loft,99.50,EUR\n");
    expect(r.separator).toBe(",");
    expect(r.rows.map((x) => [x.date, x.price])).toEqual([
      ["2026-06-01", 95],
      ["2026-06-02", 99.5],
    ]);
    expect(r.issues).toEqual([]);
  });

  it("reads a semicolon file with European dates, decimal commas and CRLF", () => {
    const r = parsePricesCsv("﻿Data;Prezzo\r\n01/06/2026;95,00\r\n02/06/2026;\"1.099,50\"\r\n\r\n");
    expect(r.separator).toBe(";");
    expect(r.rows.map((x) => [x.date, x.price])).toEqual([
      ["2026-06-01", 95],
      ["2026-06-02", 1099.5],
    ]);
  });

  it("reads a tab file and a pipe file without header", () => {
    expect(parsePricesCsv("2026-06-01\t95\n2026-06-02\t96").rows).toHaveLength(2);
    expect(parsePricesCsv("01.06.2026|95\n02.06.2026|96").rows.map((x) => x.date)).toEqual(["2026-06-01", "2026-06-02"]);
  });

  it("finds the columns by name in Spanish and in any order", () => {
    const r = parsePricesCsv("tarifa;fecha\n80;2026-07-01");
    expect(r.rows).toEqual([{ line: 2, date: "2026-07-01", price: 80 }]);
  });

  it("reports bad lines, keeps the good ones, and lets a repeated date replace the first", () => {
    const r = parsePricesCsv(["date,price", "2026-06-01,95", "2026-02-30,90", "2026-06-02,n/a", "2026-06-03", "2026-06-01,97"].join("\n"));
    expect(r.rows).toEqual([{ line: 6, date: "2026-06-01", price: 97 }]);
    expect(r.issues).toEqual([
      { line: 3, message: '"2026-02-30" is not a date (use 2026-11-03 or 03/11/2026)' },
      { line: 4, message: '"n/a" is not a price' },
      { line: 5, message: "expected at least 2 columns, found 1" },
      { line: 6, message: "2026-06-01 appears again: this price replaces the one on line 2" },
    ]);
  });

  it("explains a header it does not understand, and an empty file", () => {
    expect(parsePricesCsv("when,how much\n2026-06-01,95").issues[0]?.message).toBe(
      "cannot find a date and a price column in the header: when | how much",
    );
    expect(parsePricesCsv("\n\n").issues).toEqual([{ line: 1, message: "the file is empty" }]);
  });
});
