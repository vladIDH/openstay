import { afterEach, describe, expect, it } from "vitest";
import { AirRoiClient, AirRoiError, monthlyToDays, type FetchLike } from "../src/index.js";
import { startFakeAirRoi, type FakeAirRoi } from "./fake-airroi.js";

/** Invented key, only valid on the fake server. */
const KEY = "airroi-key-0000-not-real";
const nodeFetch: FetchLike = (url, init) => fetch(url, init);
const noSleep = async () => {};

let server: FakeAirRoi | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const MARKET = { country: "Spain", region: "Isla Ficticia", locality: "Costa Inventada" };

describe("AirROI client", () => {
  it("sends the key in X-API-KEY and reads monthly zone figures", async () => {
    server = await startFakeAirRoi({ apiKey: KEY });
    const client = new AirRoiClient({ apiKey: KEY, fetch: nodeFetch, baseUrl: server.url, sleep: noSleep });
    const months = await client.marketMetrics(MARKET, { filter: { roomType: "entire_home", bedrooms: 2 } });
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: "2025-11-01", occupancyPercent: 55, averageDailyRate: 95, activeListings: 400 });
    expect(server.requests).toEqual([
      {
        method: "POST",
        path: "/markets/metrics/all",
        key: KEY,
        body: { market: MARKET, num_months: 12, currency: "native", filter: { room_type: { eq: "entire_home" }, bedrooms: { eq: 2 } } },
      },
    ]);
    expect(client.calls).toBe(1);
  });

  it("finds a market by name", async () => {
    server = await startFakeAirRoi({ apiKey: KEY });
    const client = new AirRoiClient({ apiKey: KEY, fetch: nodeFetch, baseUrl: server.url, sleep: noSleep });
    const [entry] = await client.searchMarkets("Costa Inventada");
    expect(entry).toEqual({
      fullName: "Costa Inventada, Isla Ficticia, Spain",
      country: "Spain",
      region: "Isla Ficticia",
      locality: "Costa Inventada",
      nativeCurrency: "EUR",
      activeListings: 412,
    });
    expect(server.requests[0]).toMatchObject({ method: "GET", path: "/markets/search" });
  });

  it("has no method for anything but the two zone endpoints", () => {
    const methods = Object.getOwnPropertyNames(AirRoiClient.prototype).filter((m) => m !== "constructor");
    expect(methods.sort()).toEqual(["call", "clean", "explain", "marketMetrics", "searchMarkets"]);
  });

  it("explains a refused key without showing it", async () => {
    server = await startFakeAirRoi({ apiKey: KEY });
    const wrong = "wrong-key-invented-1111";
    const client = new AirRoiClient({ apiKey: wrong, fetch: nodeFetch, baseUrl: server.url, sleep: noSleep });
    const error = await client.marketMetrics(MARKET).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AirRoiError);
    expect((error as AirRoiError).status).toBe(401);
    expect((error as Error).message).toContain("refused the API key");
    expect((error as Error).message).not.toContain(wrong);
  });

  it("waits and retries on 429 and 5xx", async () => {
    server = await startFakeAirRoi({ apiKey: KEY, failures: [{ status: 429, retryAfter: 2 }, { status: 503 }] });
    const waits: number[] = [];
    const client = new AirRoiClient({
      apiKey: KEY,
      fetch: nodeFetch,
      baseUrl: server.url,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(await client.marketMetrics(MARKET)).toHaveLength(12);
    expect(waits).toEqual([3000, 2000]);
    expect(client.calls).toBe(3);
  });

  it("gives up after a few failures", async () => {
    server = await startFakeAirRoi({ apiKey: KEY, failures: Array.from({ length: 4 }, () => ({ status: 500 })) });
    const client = new AirRoiClient({ apiKey: KEY, fetch: nodeFetch, baseUrl: server.url, sleep: noSleep });
    await expect(client.marketMetrics(MARKET)).rejects.toThrow("AirROI answered HTTP 500: invented failure.");
  });

  it("keeps the key out of network errors", async () => {
    const failing: FetchLike = async () => {
      throw new Error(`connect failed for ${KEY}`);
    };
    const client = new AirRoiClient({ apiKey: KEY, fetch: failing, sleep: noSleep });
    const error = (await client.searchMarkets("x").catch((e: unknown) => e)) as Error;
    expect(error.message).toBe("AirROI cannot be reached: connect failed for [key]");
  });
});

describe("monthlyToDays", () => {
  it("gives each night the figures of the latest same calendar month", () => {
    const days = monthlyToDays(
      [
        { month: "2024-11-01", occupancyPercent: 40, averageDailyRate: 80, activeListings: 300 },
        { month: "2025-11-01", occupancyPercent: 55, averageDailyRate: 95, activeListings: 400 },
        { month: "2025-12-01", occupancyPercent: 82, averageDailyRate: 140, activeListings: 401 },
      ],
      "2026-11-29",
      4,
    );
    expect(days).toEqual([
      { date: "2026-11-29", occupancyPercent: 55, averagePrice: 95, comparables: 400 },
      { date: "2026-11-30", occupancyPercent: 55, averagePrice: 95, comparables: 400 },
      { date: "2026-12-01", occupancyPercent: 82, averagePrice: 140, comparables: 401 },
      { date: "2026-12-02", occupancyPercent: 82, averagePrice: 140, comparables: 401 },
    ]);
  });

  it("skips months it has no figures for", () => {
    expect(monthlyToDays([{ month: "2025-11-01", occupancyPercent: null, averageDailyRate: null, activeListings: 3 }], "2026-11-01", 2)).toEqual([]);
  });
});
