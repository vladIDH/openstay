import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEventsCsv, splitCsvLine } from "../src/engine/index.js";

describe("events CSV", () => {
  it("reads the example file and matches the example listing", () => {
    const text = readFileSync(new URL("../examples/eventi-esempio.csv", import.meta.url), "utf8");
    const listing = JSON.parse(readFileSync(new URL("../examples/annuncio-esempio.json", import.meta.url), "utf8"));
    const r = parseEventsCsv(text);
    expect(r.issues).toEqual([]);
    expect(r.events).toEqual(listing.factors.events.list);
  });

  it("works without a header, with semicolons, quotes, CRLF and a byte-order mark", () => {
    const text = '﻿2026-12-31;"New Year; party";5\r\n2027-01-06,"Kings ""parade""",3\r\n\r\n';
    expect(parseEventsCsv(text)).toEqual({
      events: [
        { date: "2026-12-31", name: "New Year; party", impact: 5 },
        { date: "2027-01-06", name: 'Kings "parade"', impact: 3 },
      ],
      issues: [],
    });
  });

  it("accepts Italian and Spanish headers", () => {
    expect(parseEventsCsv("data;nome;impatto\n2026-08-15;Ferragosto;4").events).toHaveLength(1);
    expect(parseEventsCsv("fecha,nombre,impacto\n2026-08-15,Asunción,4").events).toHaveLength(1);
  });

  it("reports bad lines and keeps the good ones", () => {
    const r = parseEventsCsv(
      ["date,name,impact", "2026-02-30,Bad date,3", "2026-03-01,,3", "2026-03-02,Too strong,9", "2026-03-03,Short", "2026-03-04,Good,2"].join("\n"),
    );
    expect(r.events).toEqual([{ date: "2026-03-04", name: "Good", impact: 2 }]);
    expect(r.issues).toEqual([
      { line: 2, message: '"2026-02-30" is not a date like 2026-12-31' },
      { line: 3, message: "the event name is empty" },
      { line: 4, message: 'impact must be a whole number from 1 to 5, got "9"' },
      { line: 5, message: "expected 3 columns (date, name, impact), found 2" },
    ]);
  });

  it("treats an unknown first line as data, not as a header", () => {
    expect(parseEventsCsv("when,what,how\n").issues).toEqual([{ line: 1, message: '"when" is not a date like 2026-12-31' }]);
  });

  it("splits quoted cells", () => {
    expect(splitCsvLine('a, "b, c" ,d', ",")).toEqual(["a", "b, c", "d"]);
  });
});
