import { describe, expect, it } from "vitest";
import { Beds24Client, type Beds24Booking, type FetchLike } from "../src/client.js";
import { bookingChannel, bookingLanguage, BOOKINGS_PER_REQUEST, listMessages, sendMessage } from "../src/messages.js";

type Call = { method: string; url: string; body?: string; headers: Record<string, string> };

function fakeApi(routes: Record<string, (url: URL, body?: string) => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    const u = new URL(url);
    const route = routes[`${init.method} ${u.pathname.replace(/^\/api\/v2/, "")}`];
    if (!route) throw new Error(`unexpected ${init.method} ${u.pathname}`);
    const r = route(u, init.body);
    return { status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
  const client = new Beds24Client({
    refreshToken: "refresh-0000-not-real",
    cachedToken: { token: "token-0000-not-real", expiresAt: "2026-11-02T00:00:00Z" },
    fetch,
    baseUrl: "https://beds24.example.com/api/v2",
    now: () => new Date("2026-11-01T09:00:00Z"),
    sleep: async () => {},
  });
  return { client, calls };
}

describe("Beds24 messages", () => {
  it("reads the messages of many bookings, without internal notes, oldest first", async () => {
    const { client, calls } = fakeApi({
      "GET /bookings/messages": (u) => {
        expect(u.searchParams.getAll("bookingId")).toEqual(["11", "12"]);
        expect(u.searchParams.get("maxAge")).toBe("60");
        return u.searchParams.get("page") === "2"
          ? { status: 200, body: { data: [{ id: 4, bookingId: 12, source: "guest", message: "Late arrival?", time: "2026-10-31T08:00:00Z" }], pages: { nextPageExists: false } } }
          : {
              status: 200,
              body: {
                data: [
                  { id: 3, bookingId: 11, source: "host", message: "Welcome", time: "2026-10-30T10:00:00Z" },
                  { id: 2, bookingId: 11, source: "guest", message: " Hi! ", time: "2026-10-30T09:00:00Z" },
                  { id: 5, bookingId: 11, source: "internalNote", message: "VIP", time: "2026-10-30T09:30:00Z" },
                  { id: 6, bookingId: 11, source: "system", message: "Booking modified", time: "2026-10-30T11:00:00Z" },
                  { id: 7, bookingId: 11, source: "guest", message: "", time: "2026-10-30T12:00:00Z" },
                ],
                pages: { nextPageExists: true },
              },
            };
      },
    });
    expect(await listMessages(client, [11, 12])).toEqual([
      { id: 2, bookingId: 11, from: "guest", text: "Hi!", time: "2026-10-30T09:00:00Z" },
      { id: 3, bookingId: 11, from: "host", text: "Welcome", time: "2026-10-30T10:00:00Z" },
      { id: 6, bookingId: 11, from: "system", text: "Booking modified", time: "2026-10-30T11:00:00Z" },
      { id: 4, bookingId: 12, from: "guest", text: "Late arrival?", time: "2026-10-31T08:00:00Z" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.token).toBe("token-0000-not-real");
  });

  it("asks for at most 50 bookings per request", async () => {
    const { client, calls } = fakeApi({ "GET /bookings/messages": () => ({ status: 200, body: { data: [], pages: { nextPageExists: false } } }) });
    await listMessages(client, Array.from({ length: BOOKINGS_PER_REQUEST + 1 }, (_, i) => i + 1), 5000);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]?.url ?? "").searchParams.get("maxAge")).toBe("999");
    expect(new URL(calls[1]?.url ?? "").searchParams.getAll("bookingId")).toEqual(["51"]);
  });

  it("sends a reply and reports Beds24's refusal", async () => {
    let answer: unknown = [{ success: true, new: { id: 9 } }];
    const { client, calls } = fakeApi({ "POST /bookings/messages": () => ({ status: 201, body: answer }) });
    await sendMessage(client, 11, "See you!");
    expect(JSON.parse(calls[0]?.body ?? "[]")).toEqual([{ bookingId: 11, message: "See you!" }]);
    answer = [{ success: false, errors: [{ message: "not a channel booking" }] }];
    await expect(sendMessage(client, 11, "x")).rejects.toThrow("did not send the message: not a channel booking");
    answer = {};
    await expect(sendMessage(client, 11, "x")).rejects.toThrow("did not send the message.");
    await expect(sendMessage(client, 11, " ")).rejects.toThrow("empty");
  });

  it("reads the guest's language and the channel from a booking", () => {
    const b = { id: 1, roomId: 1, status: "confirmed", arrival: "x", departure: "y", lang: "IT", channel: "airbnb" } as unknown as Beds24Booking;
    expect(bookingLanguage(b)).toBe("it");
    expect(bookingChannel(b)).toBe("airbnb");
    const bare = { id: 2, roomId: 1, status: "confirmed", arrival: "x", departure: "y", lang: "" } as unknown as Beds24Booking;
    expect(bookingLanguage(bare)).toBeNull();
    expect(bookingChannel(bare)).toBeNull();
  });
});
