import { describe, expect, it } from "vitest";
import { parseMarketCsv, readCsv } from "../src/index.js";

describe("generic zone CSV", () => {
  it("reads date, occupancy, average price and comparables in any order", () => {
    const r = parseMarketCsv("average_price,date,comparables,occupancy\n118,2026-11-01,40,72\n,2026-11-02,38,65%\n");
    expect(r.issues).toEqual([]);
    expect(r.days).toEqual([
      { date: "2026-11-01", occupancyPercent: 72, averagePrice: 118, comparables: 40 },
      { date: "2026-11-02", occupancyPercent: 65, comparables: 38 },
    ]);
  });

  it("accepts Italian and Spanish headers, semicolons and decimal commas", () => {
    expect(parseMarketCsv("data;occupazione;prezzo medio\n2026-11-01;72,5;1.118,50\n").days).toEqual([
      { date: "2026-11-01", occupancyPercent: 72.5, averagePrice: 1118.5 },
    ]);
    expect(parseMarketCsv("﻿Fecha,Ocupación,Precio\n2026-11-01,70,€ 99\n").days).toEqual([
      { date: "2026-11-01", occupancyPercent: 70, averagePrice: 99 },
    ]);
  });

  it("reports bad lines with their number and keeps the good ones", () => {
    const r = parseMarketCsv(
      "date,occupancy,price\n2026-11-31,50,90\n2026-11-02,150,90\n2026-11-03,,\n2026-11-04,50,-3\n2026-11-05,50,90\n2026-11-05,55,91\n",
    );
    expect(r.issues).toEqual([
      { line: 2, message: '"2026-11-31" is not a date like 2026-11-01' },
      { line: 3, message: 'occupancy must be a percentage from 0 to 100, got "150"' },
      { line: 4, message: "neither occupancy nor average price on this line" },
      { line: 5, message: 'average price must be a number above 0, got "-3"' },
      { line: 7, message: "2026-11-05 appears more than once: this later line is kept" },
    ]);
    expect(r.days).toEqual([{ date: "2026-11-05", occupancyPercent: 55, averagePrice: 91 }]);
  });

  it("needs a header with a date and at least occupancy or price", () => {
    expect(parseMarketCsv("2026-11-01,50,90\n").issues[0]?.message).toContain("must name the columns");
    expect(parseMarketCsv("date,comparables\n2026-11-01,4\n").issues[0]?.message).toContain("no occupancy or average_price column");
    expect(parseMarketCsv("").issues[0]?.message).toBe("the file is empty");
  });
});

describe("CSV records", () => {
  it("handles quotes, doubled quotes, line breaks inside quotes", () => {
    expect(readCsv('id,text\n1,"a, ""b""\nnext line"\n2,plain\r\n')).toEqual([
      { cells: ["id", "text"], line: 1 },
      { cells: ["1", 'a, "b"\nnext line'], line: 2 },
      { cells: ["2", "plain"], line: 4 },
    ]);
  });
});
