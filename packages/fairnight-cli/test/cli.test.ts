import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { main } from "../src/main.js";
import { fakeFetch, fixture, tempDir, testIo } from "./helpers.js";

const AIRBNB = "https://cal.example.org/airbnb/seaview-loft.ics";
const BOOKING = "https://cal.example.org/booking/seaview-loft.ics";
const VRBO = "https://cal.example.org/vrbo/garden-studio.ics";

/** init a folder, then point the example config at test links. */
async function setUp() {
  const root = tempDir();
  const fetch = fakeFetch({
    [AIRBNB]: fixture("airbnb-esempio.ics"),
    [BOOKING]: fixture("booking-esempio.ics"),
    [VRBO]: fixture("vrbo-esempio.ics"),
  });
  const io = testIo(root, fetch);
  expect(await main(["init", "host"], io)).toBe(0);
  const dir = path.join(root, "host");
  const configFile = path.join(dir, "fairnight.config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.listings[0].calendars[0].url = AIRBNB;
  config.listings[0].calendars[1].url = BOOKING;
  config.listings[1].calendars[0].url = VRBO;
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  return { root, dir, io, fetch };
}

describe("fairnight init", () => {
  it("creates config, database and README inside the chosen folder only", async () => {
    const root = tempDir();
    const io = testIo(root);
    expect(await main(["init", "my-rentals"], io)).toBe(0);
    expect(readdirSync(root)).toEqual(["my-rentals"]);
    const dir = path.join(root, "my-rentals");
    expect(readdirSync(dir).sort()).toEqual(["README.txt", "data", "fairnight.config.json"]);
    expect(readdirSync(path.join(dir, "data"))).toEqual(["fairnight.db"]);
    expect(readFileSync(path.join(dir, "README.txt"), "utf8").trimEnd().split("\n")).toHaveLength(3);
    expect(io.lines[0]).toBe(`Fairnight folder: ${dir}`);
    expect(io.lines).toContain(`  created ${path.join("data", "fairnight.db")}`);
  });

  it("never overwrites, so running it twice is safe", async () => {
    const root = tempDir();
    await main(["init"], testIo(root));
    const configFile = path.join(root, "fairnight.config.json");
    writeFileSync(configFile, '{"listings": "mine"}');
    const io = testIo(root);
    expect(await main(["init"], io)).toBe(0);
    expect(readFileSync(configFile, "utf8")).toBe('{"listings": "mine"}');
    expect(io.lines.filter((l) => l.includes("kept"))).toHaveLength(3);
  });

  it("works with the example config right away (the example links just fail to sync)", async () => {
    const root = tempDir();
    await main(["init"], testIo(root));
    const fetch = fakeFetch({});
    const io = testIo(root, fetch);
    expect(await main(["sync"], io)).toBe(1);
    expect(io.lines[0]).toMatch(/seaview-loft · airbnb: NOT READ — unexpected request to .*example link.*Nothing was changed/);
    const priced = testIo(root);
    expect(await main(["price", "--days", "3", "--today", "2026-11-01"], priced)).toBe(0);
    expect(priced.lines.filter((l) => l.startsWith("2026-11-0"))).toHaveLength(6);
  });
});

describe("fairnight sync", () => {
  it("reads every calendar, and a second run adds nothing", async () => {
    const { dir, io, fetch } = await setUp();
    const sync = testIo(dir, fetch);
    expect(await main(["sync"], sync)).toBe(0);
    expect(sync.lines).toEqual([
      "seaview-loft · airbnb: 3 events · 3 new · 0 changed · 0 removed · 0 back",
      "seaview-loft · booking: 2 events · 2 new · 0 changed · 0 removed · 0 back",
      "garden-studio · vrbo: 3 events · 3 new · 0 changed · 0 removed · 0 back",
      '    skipped: event "Broken - no start" has no start date',
    ]);
    const again = testIo(dir, fetch);
    expect(await main(["sync", "--listing", "seaview-loft"], again)).toBe(0);
    expect(again.lines).toEqual([
      "seaview-loft · airbnb: 3 events · 0 new · 0 changed · 0 removed · 0 back",
      "seaview-loft · booking: 2 events · 0 new · 0 changed · 0 removed · 0 back",
    ]);
    expect(fetch.calls).toEqual([AIRBNB, BOOKING, VRBO, AIRBNB, BOOKING]);
    expect(io.errors).toEqual([]);
  });

  it("explains a broken config instead of crashing", async () => {
    const { dir } = await setUp();
    const configFile = path.join(dir, "fairnight.config.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    config.listings[0].pricing.basePrice = 0;
    writeFileSync(configFile, JSON.stringify(config));
    const io = testIo(dir);
    expect(await main(["sync"], io)).toBe(1);
    expect(io.errors).toEqual([
      "Invalid fairnight.config.json:",
      "  - listings[0].pricing.basePrice: must be greater than 0, got 0",
    ]);
  });
});

describe("fairnight import", () => {
  it("stores past prices, and importing again changes nothing", async () => {
    const { dir } = await setUp();
    const csv = path.join(dir, "prezzi.csv");
    writeFileSync(csv, "Data;Prezzo\r\n01/06/2026;95,00\r\n02/06/2026;99,50\r\n03/06/2026;n/d\r\n");
    const io = testIo(dir);
    expect(await main(["import", "prezzi.csv", "--listing", "seaview-loft", "--dir", dir], io)).toBe(0);
    expect(io.lines).toEqual([
      "seaview-loft: imported 2 nightly prices from prezzi.csv (2026-06-01 → 2026-06-02)",
      '  line 4: "n/d" is not a price',
    ]);
    await main(["import", csv, "--listing", "seaview-loft"], testIo(dir));
    const db = openDb(path.join(dir, "data", "fairnight.db"));
    expect(db.prepare("SELECT listing, date, price, source FROM price_history ORDER BY date").all()).toEqual([
      { listing: "seaview-loft", date: "2026-06-01", price: 95, source: "prezzi.csv" },
      { listing: "seaview-loft", date: "2026-06-02", price: 99.5, source: "prezzi.csv" },
    ]);
    db.close();
  });

  it("writes nothing with --dry-run and explains mistakes", async () => {
    const { dir } = await setUp();
    writeFileSync(path.join(dir, "p.csv"), "2026-06-01,95\n");
    const dry = testIo(dir);
    expect(await main(["import", "p.csv", "--listing", "garden-studio", "--dry-run"], dry)).toBe(0);
    expect(dry.lines[0]).toBe("garden-studio: would import 1 nightly prices from p.csv (2026-06-01 → 2026-06-01)");
    const db = openDb(path.join(dir, "data", "fairnight.db"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM price_history").get()).toEqual({ n: 0 });
    db.close();

    const noListing = testIo(dir);
    expect(await main(["import", "p.csv"], noListing)).toBe(2);
    expect(noListing.errors[0]).toBe("Which listing? Add --listing <name>.");
    const noFile = testIo(dir);
    expect(await main(["import", "--listing", "garden-studio"], noFile)).toBe(2);
    const missing = testIo(dir);
    expect(await main(["import", "nope.csv", "--listing", "garden-studio"], missing)).toBe(1);
    expect(missing.errors[0]).toMatch(/^Cannot read .*nope\.csv/);
    const empty = testIo(dir);
    writeFileSync(path.join(dir, "empty.csv"), "date,price\n");
    expect(await main(["import", "empty.csv", "--listing", "garden-studio"], empty)).toBe(1);
  });
});

describe("fairnight price", () => {
  it("prices a listing whose calendar is full of stays and blocks", async () => {
    const { dir, fetch } = await setUp();
    await main(["sync"], testIo(dir, fetch));
    const io = testIo(dir);
    expect(await main(["price", "--listing", "seaview-loft", "--days", "10", "--today", "2026-11-01"], io)).toBe(0);
    expect(io.lines).toEqual([
      "seaview-loft · 10 nights from 2026-11-01 · prices in EUR",
      "date        day    price  min  why",
      "2026-11-01  sun       81    1  sun -5%, last minute (≤3 days) -15%",
      "2026-11-02  mon       85    1  last minute (≤3 days) -15%",
      "2026-11-03  tue       85    1  last minute (≤3 days) -15%",
      "2026-11-04  wed        —    —  reserved",
      "2026-11-05  thu        —    —  reserved",
      "2026-11-06  fri        —    —  reserved",
      "2026-11-07  sat        —    —  reserved",
      "2026-11-08  sun       84    2  sun -5%, gap of 2 nights -12%",
      "2026-11-09  mon       88    2  gap of 2 nights -12%",
      "2026-11-10  tue        —    —  reserved",
      "5 for sale · 5 reserved · 0 blocked · average 84.60, from 81 to 88",
    ]);
  });

  it("prints the full explanation with --explain and the data with --json", async () => {
    const { dir, fetch } = await setUp();
    await main(["sync"], testIo(dir, fetch));
    const explained = testIo(dir);
    await main(["price", "--listing", "seaview-loft", "--days", "12", "--today", "2026-12-20", "--explain"], explained);
    expect(explained.lines.find((l) => l.includes("2026-12-31"))).toBe(
      "Thu 2026-12-31 · 189 EUR: base 100 → season \"Year-end holidays\" +35% = 135 → event \"New Year's Eve\" (impact 5) +40% = 189 → within floor 60 and ceiling 260. Min stay 3 (default).",
    );
    const json = testIo(dir);
    await main(["price", "--days", "2", "--today", "2026-12-01", "--json"], json);
    const data = JSON.parse(json.lines.join("\n"));
    expect(data.map((d: { listing: string }) => d.listing)).toEqual(["seaview-loft", "garden-studio"]);
    expect(data[0].nights[0]).toMatchObject({ date: "2026-12-01", status: "blocked", price: null });
  });

  it("only uses stays that are still in the calendars", async () => {
    const { dir, fetch } = await setUp();
    await main(["sync"], testIo(dir, fetch));
    fetch.set(AIRBNB, fixture("airbnb-esempio.ics").replace(/BEGIN:VEVENT\r\nDTEND;VALUE=DATE:20261108[\s\S]*?END:VEVENT\r\n/, ""));
    await main(["sync", "--listing", "seaview-loft"], testIo(dir, fetch));
    const io = testIo(dir);
    await main(["price", "--listing", "seaview-loft", "--days", "5", "--today", "2026-11-03", "--json"], io);
    const nights = JSON.parse(io.lines.join("\n"))[0].nights;
    expect(nights.map((n: { status: string }) => n.status)).toEqual(["available", "available", "available", "available", "available"]);
  });

  it("uses the host's local date when --today is not given, and warns before the first sync", async () => {
    const { dir } = await setUp();
    const io = testIo(dir, fakeFetch({}), "2026-11-05T12:00:00");
    await main(["price", "--listing", "garden-studio", "--days", "1"], io);
    expect(io.lines[0]).toBe("garden-studio · 1 nights from 2026-11-05 · prices in EUR");
    expect(io.lines[1]).toContain('no calendar read yet: run "fairnight sync"');
  });
});

describe("command line", () => {
  it("prints help and rejects bad usage", async () => {
    const root = tempDir();
    const help = testIo(root);
    expect(await main(["--help"], help)).toBe(0);
    expect(help.lines[0]).toMatch(/^Fairnight:/);
    expect(await main([], testIo(root))).toBe(2);
    const unknown = testIo(root);
    expect(await main(["publish"], unknown)).toBe(2);
    expect(unknown.errors[0]).toBe('Unknown command "publish".');
    const badFlag = testIo(root);
    expect(await main(["price", "--colour"], badFlag)).toBe(2);
    const badDays = testIo(root);
    expect(await main(["price", "--days", "0"], badDays)).toBe(2);
    expect(badDays.errors[0]).toBe('--days must be a whole number from 1 to 1096, got "0"');
    expect(await main(["sync", "extra"], testIo(root))).toBe(2);
    expect(await main(["init", "a", "b"], testIo(root))).toBe(2);
  });

  it("tells the host to run init first", async () => {
    const root = tempDir();
    const io = testIo(root);
    expect(await main(["price"], io)).toBe(1);
    expect(io.errors[0]).toMatch(/No fairnight.config.json in .*Run "fairnight init" in this folder first\./);
    expect(existsSync(path.join(root, "data"))).toBe(false);
  });
});

describe("history-based factors through the command line", () => {
  it("feeds imported prices and the date of the last new booking to the engine", async () => {
    const { dir, fetch } = await setUp();
    const configFile = path.join(dir, "fairnight.config.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    config.listings[1].pricing.factors.historicalFloor = { enabled: true, percent: 80, minNights: 2 };
    config.listings[1].pricing.factors.staleCalendar = { enabled: true, afterDays: 10, stepPercent: 5, maxPercent: 10, withinDays: 60 };
    writeFileSync(configFile, JSON.stringify(config));

    // First sync on 1 November: every stay is new on that day.
    await main(["sync", "--listing", "garden-studio"], testIo(dir, fetch, "2026-11-01T09:00:00Z"));
    writeFileSync(path.join(dir, "old.csv"), "date,price\n2025-12-01,90\n2025-12-02,100\n");
    await main(["import", "old.csv", "--listing", "garden-studio"], testIo(dir));

    // 2 December 2026, a Wednesday: 70 base, 31 days without new bookings → -10%, floor 80% of 95 = 76.
    const io = testIo(dir);
    await main(["price", "--listing", "garden-studio", "--days", "1", "--today", "2026-12-02", "--explain"], io);
    expect(io.lines[1]).toBe(
      "Wed 2026-12-02 · 76 EUR: base 70 → last minute (≤5 days) -10% = 63 (0 days ahead) → no new bookings -10% = 56.70 (31 days since the last new booking)" +
        " → historical floor = 76 (80% of the 2025-12 average of 95 over 2 sold nights) → within floor 45 and ceiling 160. Min stay 1 (last minute).",
    );

    // A new booking arrives: the stale-calendar discount is gone at the next price.
    fetch.set(
      "https://cal.example.org/vrbo/garden-studio.ics",
      fixture("vrbo-esempio.ics").replace("END:VCALENDAR", "BEGIN:VEVENT\r\nUID:new-one\r\nDTSTART;VALUE=DATE:20270110\r\nDTEND;VALUE=DATE:20270112\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR"),
    );
    await main(["sync", "--listing", "garden-studio"], testIo(dir, fetch, "2026-12-02T08:00:00Z"));
    const after = testIo(dir);
    await main(["price", "--listing", "garden-studio", "--days", "1", "--today", "2026-12-02", "--json"], after);
    const steps = JSON.parse(after.lines.join("\n"))[0].nights[0].steps.map((s: { factor: string }) => s.factor);
    expect(steps).not.toContain("staleCalendar");
  });
});
