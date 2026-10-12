/**
 * Regression: 365 nights of the example listing, compared with a file kept in
 * the repo. If the engine changes on purpose, regenerate it with
 * `npm run regen:expected` and review the diff before committing.
 */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { priceListing } from "../src/engine/index.js";

const listing = JSON.parse(readFileSync(new URL("../examples/annuncio-esempio.json", import.meta.url), "utf8"));
const calendar = JSON.parse(readFileSync(new URL("../examples/prenotazioni-esempio.json", import.meta.url), "utf8"));

it("prices 365 nights of the example exactly as expected", async () => {
  const result = priceListing(listing, calendar, { today: "2026-11-01", days: 365 });
  expect(result.nights).toHaveLength(365);
  const compact = result.nights.map((n) => ({
    date: n.date,
    status: n.status,
    price: n.price,
    minStay: n.minStay,
    minStaySource: n.minStaySource,
    explanation: n.explanation,
  }));
  await expect(JSON.stringify(compact, null, 1) + "\n").toMatchFileSnapshot("./fixtures/expected-365.json");
});
