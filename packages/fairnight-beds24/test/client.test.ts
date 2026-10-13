import { afterEach, describe, expect, it } from "vitest";
import { Beds24Client, Beds24Error, type Beds24Token } from "../src/client.js";
import { startFakeBeds24, TEST_INVITE, TEST_REFRESH, type FakeBeds24, type FakeBooking } from "./fake-beds24.js";

const T0 = Date.parse("2026-11-01T09:00:00Z");
let fake: FakeBeds24 | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

function booking(id: number, roomId: number, arrival: string, departure: string, extra: Partial<FakeBooking> = {}): FakeBooking {
  return { id, propertyId: 10, roomId, status: "confirmed", arrival, departure, bookingTime: "2026-10-20T14:03:00Z", price: 300, firstName: "Invented", lastName: "Guest", ...extra };
}

async function setUp(over: Partial<Parameters<typeof startFakeBeds24>[0]> = {}) {
  const clock = { now: T0 };
  fake = await startFakeBeds24({
    inviteCode: TEST_INVITE,
    refreshToken: TEST_REFRESH,
    clock,
    properties: [
      { id: 10, name: "Seaside House", currency: "EUR", rooms: [{ id: 101, name: "Loft", qty: 1 }, { id: 102, name: "Dorm", qty: 4 }] },
      { id: 20, name: "Garden", currency: "EUR", rooms: [{ id: 201, name: "Studio", qty: 1 }] },
    ],
    bookings: [],
    ...over,
  });
  const sleeps: number[] = [];
  const saved: Beds24Token[] = [];
  const client = new Beds24Client({
    refreshToken: TEST_REFRESH,
    fetch: (url, init) => fetch(url, init),
    baseUrl: fake.baseUrl,
    now: () => new Date(clock.now),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    onToken: (t) => saved.push(t),
  });
  return { fake, client, clock, sleeps, saved };
}

describe("authentication", () => {
  it("exchanges an invite code for a refresh token, once", async () => {
    const { fake } = await setUp();
    const first = await Beds24Client.setup({ inviteCode: TEST_INVITE, fetch: (u, i) => fetch(u, i), baseUrl: fake.baseUrl, now: () => new Date(T0) });
    expect(first.refreshToken).toBe(TEST_REFRESH);
    expect(first.token.expiresAt).toBe("2026-11-01T10:00:00.000Z");
    expect(fake.log[0]?.headers.code).toBe(TEST_INVITE);
    const err = await Beds24Client.setup({ inviteCode: TEST_INVITE, fetch: (u, i) => fetch(u, i), baseUrl: fake.baseUrl }).catch((e: unknown) => e as Beds24Error) as Beds24Error;
    expect(err).toBeInstanceOf(Beds24Error);
    expect(err.message).toBe('Beds24 did not accept the invite code (400): "Invalid code". Invite codes work once and only for 24 hours: create a new one in Beds24.');
    expect(err.message).not.toContain(TEST_INVITE);
  });

  it("gets a short token from the refresh token, saves it, and reuses it while valid", async () => {
    const { client, fake, saved } = await setUp();
    await client.listRooms();
    await client.listRooms();
    expect(fake.log.map((r) => r.path)).toEqual(["/authentication/token", "/properties", "/properties"]);
    expect(fake.log[0]?.headers.refreshtoken).toBe(TEST_REFRESH);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.expiresAt).toBe("2026-11-01T10:00:00.000Z"); // expiresIn 3600
  });

  it("renews the token when less than 2 minutes are left, using expiresIn", async () => {
    const { client, fake, clock, saved } = await setUp();
    await client.listRooms();
    clock.now += 58 * 60_000 + 1000; // 1 min 59 s left
    await client.listRooms();
    expect(fake.log.filter((r) => r.path === "/authentication/token")).toHaveLength(2);
    expect(saved).toHaveLength(2);
  });

  it("renews once when the token expires in the middle of a run", async () => {
    const { client, fake } = await setUp();
    await client.listRooms();
    fake.expireTokens();
    expect(await client.listRooms()).toHaveLength(3);
    expect(fake.log.map((r) => `${r.path} ${r.status}`)).toEqual([
      "/authentication/token 200",
      "/properties 200",
      "/properties 401",
      "/authentication/token 200",
      "/properties 200",
    ]);
  });

  it("uses a token saved by a previous run while it is valid", async () => {
    const { fake } = await setUp();
    const { token } = await Beds24Client.setup({ inviteCode: TEST_INVITE, fetch: (u, i) => fetch(u, i), baseUrl: fake.baseUrl, now: () => new Date(T0) });
    const reuse = new Beds24Client({ refreshToken: TEST_REFRESH, cachedToken: token, fetch: (u, i) => fetch(u, i), baseUrl: fake.baseUrl, now: () => new Date(T0) });
    await reuse.listRooms();
    expect(fake.log.map((r) => r.path)).toEqual(["/authentication/setup", "/properties"]);
  });

  it("explains a refused refresh token, without showing it", async () => {
    const { fake } = await setUp();
    const bad = new Beds24Client({ refreshToken: "wrong-refresh-not-real", fetch: (u, i) => fetch(u, i), baseUrl: fake.baseUrl, sleep: async () => {} });
    const err = await bad.listRooms().catch((e: unknown) => e as Beds24Error) as Beds24Error;
    expect(err.message).toBe(
      'Beds24 refused the refresh token (400): "Invalid refresh token". A refresh token stops working after 30 days without use: run "fairnight beds24 collega" with a new invite code.',
    );
    expect(err.message).not.toContain("wrong-refresh-not-real");
  });
});

describe("credits", () => {
  it("counts the credits used and reads what is left", async () => {
    const { client } = await setUp();
    await client.listRooms();
    expect(client.credits).toMatchObject({ limit: 100, remaining: 98, used: 2 });
  });

  it("never goes below half of the window: it waits for the reset", async () => {
    const { client, fake, sleeps } = await setUp({ cost: { token: 1, get: 20, post: 20 } });
    await client.listRooms(); // 1 + 20 = 21 spent, 79 left
    await client.listRooms(); // 59 left
    expect(sleeps).toEqual([]);
    await client.listRooms(); // 39 left: below half
    await client.listRooms(); // must wait for the window to reset first
    expect(sleeps).toEqual([301_000]);
    expect(fake.log.every((r) => r.status === 200)).toBe(true);
  });

  it("waits until the window resets plus one second on 429", async () => {
    const { client, fake, sleeps } = await setUp();
    await client.listRooms();
    fake.forceNext({ status: 429, body: { success: false, code: 429, error: "Usage limit exceeded in last 5 minutes" } });
    expect(await client.listRooms()).toHaveLength(3);
    expect(sleeps).toEqual([301_000]);
  });

  it("gives up after repeated 429s with a clear message", async () => {
    const { client, fake } = await setUp();
    await client.listRooms();
    for (let i = 0; i < 5; i++) fake.forceNext({ status: 429, body: { success: false, code: 429, error: "Usage limit exceeded in last 5 minutes" } });
    await expect(client.listRooms()).rejects.toThrow('Beds24 kept answering 429 (credits used up). Beds24 says: "Usage limit exceeded in last 5 minutes". Wait 5 minutes and try again.');
  });
});

describe("errors", () => {
  it("retries 5xx with growing waits", async () => {
    const { client, fake, sleeps } = await setUp();
    await client.listRooms();
    fake.forceNext({ status: 503 }, { status: 502 });
    expect(await client.listRooms()).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
    fake.forceNext({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
    await expect(client.listRooms()).rejects.toThrow('Beds24 answered 503 for /properties. Beds24 says: "Forced".');
  });

  it("stops on validation errors, missing permissions and a network that is down", async () => {
    const { client, fake } = await setUp();
    await client.listRooms();
    fake.forceNext({ status: 400, body: { success: false, code: 400, error: "startDate is not valid" } });
    await expect(client.getCalendar([101], "2026-11-01", "2026-11-02", "price1")).rejects.toThrow(
      'Beds24 answered 400 for /inventory/rooms/calendar. Beds24 says: "startDate is not valid".',
    );
    fake.forceNext({ status: 403, body: { success: false, code: 403, error: "Scope not allowed" } });
    await expect(client.listRooms()).rejects.toThrow(/permissions read:bookings, all:inventory and read:properties/);
    const offline = new Beds24Client({
      refreshToken: TEST_REFRESH,
      fetch: async () => {
        throw new Error("getaddrinfo ENOTFOUND beds24.com");
      },
    });
    await expect(offline.listRooms()).rejects.toThrow("Could not reach Beds24 (getaddrinfo ENOTFOUND beds24.com).");
  });
});

describe("reading", () => {
  it("lists every room of every property with its number of units", async () => {
    const { client } = await setUp();
    expect(await client.listRooms()).toEqual([
      { propertyId: 10, propertyName: "Seaside House", currency: "EUR", roomId: 101, name: "Loft", qty: 1 },
      { propertyId: 10, propertyName: "Seaside House", currency: "EUR", roomId: 102, name: "Dorm", qty: 4 },
      { propertyId: 20, propertyName: "Garden", currency: "EUR", roomId: 201, name: "Studio", qty: 1 },
    ]);
  });

  it("reads every page of bookings, without enquiries", async () => {
    const bookings = Array.from({ length: 5 }, (_, i) => booking(1000 + i, 101, "2026-12-01", "2026-12-03"));
    bookings.push(booking(2000, 101, "2026-12-05", "2026-12-06", { status: "inquiry" }));
    const { client, fake } = await setUp({ bookings, bookingsPageSize: 2 });
    const all = await client.listBookings({ departureFrom: "2025-10-01", roomIds: [101] });
    expect(all).toHaveLength(5);
    const pages = fake.log.filter((r) => r.path === "/bookings");
    expect(pages.map((r) => r.query.get("page"))).toEqual([null, "2", "3"]);
    expect(pages[0]?.query.getAll("status")).toEqual(["confirmed", "request", "new", "cancelled", "black"]);
    expect(await client.listBookings({ departureFrom: "2025-10-01", roomIds: [] })).toEqual([]);
  });

  it("expands the calendar runs night by night", async () => {
    const { client } = await setUp({
      calendar: {
        101: {
          "2026-11-01": { price1: 100, price2: 90, minStay: 2 },
          "2026-11-02": { price1: 100, price2: 90, minStay: 2 },
          "2026-11-03": { price1: 120, minStay: 3, numAvail: 0 },
          "2026-11-04": { price1: 120, minStay: 3, override: "blackout" },
        },
      },
    });
    expect(await client.getCalendar([101], "2026-11-01", "2026-11-05", "price1")).toEqual({
      101: {
        "2026-11-01": { price: 100, minStay: 2, available: true },
        "2026-11-02": { price: 100, minStay: 2, available: true },
        "2026-11-03": { price: 120, minStay: 3, available: false },
        "2026-11-04": { price: 120, minStay: 3, available: false },
        "2026-11-05": { price: null, minStay: null, available: true },
      },
    });
    expect((await client.getCalendar([101], "2026-11-01", "2026-11-01", "price2"))[101]?.["2026-11-01"]?.price).toBe(90);
  });
});

describe("writing", () => {
  it("sends only the chosen price field and minStay, one element per write, and reports each", async () => {
    const { client, fake } = await setUp({ refuseDates: ["2026-11-04"], calendar: { 101: { "2026-11-03": { price1: 80, price2: 70, numAvail: 1, override: "noCheckIn" } } } });
    const results = await client.writeCalendar(
      [
        { roomId: 101, from: "2026-11-03", to: "2026-11-03", price: 95, minStay: 2 },
        { roomId: 101, from: "2026-11-04", to: "2026-11-04", price: 10, minStay: 2 },
      ],
      "price1",
    );
    expect(results.map((r) => [r.write.from, r.ok, r.errors])).toEqual([
      ["2026-11-03", true, []],
      ["2026-11-04", false, ["price1: Price is below the minimum price of the room"]],
    ]);
    const post = fake.log.find((r) => r.method === "POST");
    expect(JSON.parse(post?.body ?? "")).toEqual([
      { roomId: 101, calendar: [{ from: "2026-11-03", to: "2026-11-03", price1: 95, minStay: 2 }] },
      { roomId: 101, calendar: [{ from: "2026-11-04", to: "2026-11-04", price1: 10, minStay: 2 }] },
    ]);
    // Other fields of the night were left as they were.
    expect(fake.calendar[101]?.["2026-11-03"]).toEqual({ price1: 95, price2: 70, numAvail: 1, override: "noCheckIn", minStay: 2 });
    expect(await client.writeCalendar([], "price1")).toEqual([]);
  });

  it("treats a missing answer for an element as not written", async () => {
    const { client, fake } = await setUp();
    await client.listRooms();
    fake.forceNext({ status: 201, body: [{ success: true }] });
    const r = await client.writeCalendar(
      [
        { roomId: 101, from: "2026-11-03", to: "2026-11-03", price: 95, minStay: 2 },
        { roomId: 101, from: "2026-11-04", to: "2026-11-04", price: 95, minStay: 2 },
      ],
      "price1",
    );
    expect(r.map((x) => x.ok)).toEqual([true, false]);
    expect(r[1]?.errors).toEqual(["no answer for this element"]);
  });
});
