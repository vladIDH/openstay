import { afterEach, describe, expect, it } from "vitest";
import { OWN_LIMIT_PER_MINUTE, RequestBrake, SmoobuClient, SmoobuError } from "../src/client.js";
import { startFakeSmoobu, TEST_CREDENTIALS, type FakeSmoobu } from "./fake-smoobu.js";

const NOW = new Date("2026-11-01T09:00:00Z");
let fake: FakeSmoobu | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

function booking(id: number, apartment: number, arrival: string, departure: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    type: "reservation" as const,
    arrival,
    departure,
    "created-at": "2026-10-20 14:03",
    apartment: { id: apartment, name: "Seaside apartment" },
    channel: { id: 465614, name: "Booking.com" },
    "guest-name": "Invented Guest",
    price: 300,
    "is-blocked-booking": false,
    ...extra,
  };
}

async function setUp(over: Partial<Parameters<typeof startFakeSmoobu>[0]> = {}) {
  fake = await startFakeSmoobu({
    ...TEST_CREDENTIALS,
    now: () => NOW,
    apartments: [
      { id: 398, name: "Seaside apartment", currency: "EUR", minimal: "60.00", maximal: "200.00" },
      { id: 401, name: "Garden studio", currency: "EUR", minimal: "45.00", maximal: "150.00" },
    ],
    bookings: [],
    ...over,
  });
  const sleeps: number[] = [];
  const client = new SmoobuClient({
    credentials: TEST_CREDENTIALS,
    fetch: (url, init) => fetch(url, init),
    baseUrl: fake.baseUrl,
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { fake, client, sleeps };
}

describe("Smoobu client against the fake server", () => {
  it("is accepted by a server that checks the HMAC signature, and never sends the legacy header", async () => {
    const { fake, client } = await setUp();
    expect(await client.listApartments()).toEqual([
      { id: 398, name: "Seaside apartment" },
      { id: 401, name: "Garden studio" },
    ]);
    expect(fake.log[0]?.status).toBe(200);
    expect(fake.log[0]?.headers["api-key"]).toBeUndefined();
  });

  it("reads apartment details with price and currency", async () => {
    const { client } = await setUp();
    expect(await client.getApartment(398)).toEqual({
      id: 398,
      name: "Seaside apartment",
      currency: "EUR",
      timeZone: "Europe/Rome",
      price: { minimal: 60, maximal: 200 },
    });
  });

  it("reads every page of reservations, cancellations included", async () => {
    const bookings = Array.from({ length: 230 }, (_, i) => booking(1000 + i, 398, "2026-12-01", "2026-12-03"));
    const { client, fake } = await setUp({ bookings });
    const all = await client.listReservations({ departureFrom: "2025-10-01" });
    expect(all).toHaveLength(230);
    const pages = fake.log.filter((r) => r.path === "/api/reservations");
    expect(pages.map((r) => new URLSearchParams(r.query).get("page"))).toEqual(["1", "2", "3"]);
    expect(new URLSearchParams(pages[0]?.query).get("pageSize")).toBe("100");
    expect(new URLSearchParams(pages[0]?.query).get("showCancellation")).toBe("true");
  });

  it("reads and writes rates", async () => {
    const { client, fake } = await setUp();
    await client.postRates([398], [{ dates: ["2026-11-03"], daily_price: 95, min_length_of_stay: 2 }]);
    const rates = await client.getRates([398], "2026-11-02", "2026-11-03");
    expect(rates).toEqual({
      "398": {
        "2026-11-02": { price: null, min_length_of_stay: null, available: 1 },
        "2026-11-03": { price: 95, min_length_of_stay: 2, available: 1 },
      },
    });
    expect(JSON.parse(fake.log[0]?.body ?? "")).toEqual({ apartments: [398], operations: [{ dates: ["2026-11-03"], daily_price: 95, min_length_of_stay: 2 }] });
  });

  it("waits until X-RateLimit-Retry-After plus one second on 429, then goes on", async () => {
    const { client, fake, sleeps } = await setUp();
    const resetAt = Math.floor(NOW.getTime() / 1000) + 20; // window ends in 20 s
    fake.forceNext({ status: 429, retryAfter: resetAt });
    expect(await client.listApartments()).toHaveLength(2);
    expect(sleeps).toEqual([21_000]);
    expect(fake.log.map((r) => r.status)).toEqual([429, 200]);
  });

  it("retries 5xx without a message with growing waits, and gives up clearly", async () => {
    const { client, fake, sleeps } = await setUp();
    fake.forceNext({ status: 503 }, { status: 502 });
    expect(await client.listApartments()).toHaveLength(2);
    expect(sleeps).toEqual([1000, 2000]);
    fake.forceNext({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
    await expect(client.listApartments()).rejects.toThrow("Smoobu answered 503 for /api/apartments.");
    expect(sleeps.slice(2)).toEqual([1000, 2000, 4000, 8000]);
  });

  it("does not retry Smoobu's validation errors (500 with a detail) and shows the message", async () => {
    const { client, fake } = await setUp();
    const before = fake.log.length;
    await expect(client.postRates([398], [{ dates: ["03/11/2026"], daily_price: 90, min_length_of_stay: 2 }])).rejects.toThrow(
      'Smoobu answered 500 for /api/rates. Smoobu says: "invalid Date format 03/11/2026".',
    );
    expect(fake.log.length - before).toBe(1);
  });

  it("stops on a refused signature, without ever showing the credentials", async () => {
    const { fake } = await setUp();
    const wrong = new SmoobuClient({
      credentials: { apiKey: TEST_CREDENTIALS.apiKey, apiSecret: "wrong-secret-not-real" },
      fetch: (url, init) => fetch(url, init),
      baseUrl: fake.baseUrl,
      now: () => NOW,
      sleep: async () => {},
    });
    const err = (await wrong.listApartments().catch((e: unknown) => e)) as SmoobuError;
    expect(err).toBeInstanceOf(SmoobuError);
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/^Smoobu refused the request \(401\)\. Smoobu says: "Authentication required"\. Check the API key and secret/);
    expect(err.message).not.toContain(TEST_CREDENTIALS.apiKey);
    expect(err.message).not.toContain("wrong-secret-not-real");
  });

  it("is refused when the clock is more than 5 minutes off", async () => {
    const { fake } = await setUp();
    const late = new SmoobuClient({
      credentials: TEST_CREDENTIALS,
      fetch: (url, init) => fetch(url, init),
      baseUrl: fake.baseUrl,
      now: () => new Date(NOW.getTime() + 6 * 60_000),
      sleep: async () => {},
    });
    await expect(late.listApartments()).rejects.toThrow(/clock is right/);
  });

  it("explains other errors and a network that is down", async () => {
    const { client, fake } = await setUp();
    await expect(client.getApartment(999)).rejects.toThrow('Smoobu could not find /api/apartments/999 (404). Smoobu says: "Apartment not found".');
    fake.forceNext({ status: 403, body: { title: "Forbidden" } });
    await expect(client.listApartments()).rejects.toThrow('Smoobu does not allow this request (403). Smoobu says: "Forbidden".');
    fake.forceNext({ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 429 });
    await expect(client.listApartments()).rejects.toThrow("Smoobu kept answering 429");
    const offline = new SmoobuClient({
      credentials: TEST_CREDENTIALS,
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND login.smoobu.com");
      },
      sleep: async () => {},
    });
    await expect(offline.listApartments()).rejects.toThrow("Could not reach Smoobu (getaddrinfo ENOTFOUND login.smoobu.com).");
  });

  it("treats a non-JSON success and a missing confirmation as errors", async () => {
    const client = new SmoobuClient({
      credentials: TEST_CREDENTIALS,
      fetch: async () => ({ status: 200, headers: { get: () => null }, text: async () => "<html>" }),
      sleep: async () => {},
    });
    await expect(client.listApartments()).rejects.toThrow("not JSON");
    const silent = new SmoobuClient({
      credentials: TEST_CREDENTIALS,
      fetch: async () => ({ status: 200, headers: { get: () => null }, text: async () => "{}" }),
      sleep: async () => {},
    });
    await expect(silent.postRates([1], [])).rejects.toThrow("did not confirm");
  });
});

describe("our own brake", () => {
  it("never sends more than the limit in a minute", async () => {
    let t = 0;
    const waits: number[] = [];
    const brake = new RequestBrake(3, () => t, async (ms) => {
      waits.push(ms);
      t += ms;
    });
    for (let i = 0; i < 5; i++) await brake.take();
    expect(waits).toEqual([60_000]); // the 4th request waits for the first minute to end
    expect(t).toBe(60_000);
  });

  it("is 300 requests per minute by default, well under the 700 Smoobu allows", () => {
    expect(OWN_LIMIT_PER_MINUTE).toBe(300);
  });
});
