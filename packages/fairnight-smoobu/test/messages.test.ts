import { describe, expect, it } from "vitest";
import { SmoobuClient, type FetchLike, type SmoobuBooking } from "../src/client.js";
import { bookingChannel, bookingLanguage, listMessages, listThreads, messageText, sendMessageToGuest } from "../src/messages.js";
import { TEST_CREDENTIALS } from "./fake-smoobu.js";

type Call = { method: string; url: string; body?: string; headers: Record<string, string> };

/** Answers by method and path (query ignored), records every request. */
function fakeApi(routes: Record<string, (url: URL, body?: string) => { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    const u = new URL(url);
    const route = routes[`${init.method} ${u.pathname}`];
    if (!route) throw new Error(`unexpected ${init.method} ${u.pathname}`);
    const r = route(u, init.body);
    return { status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
  };
  const client = new SmoobuClient({ credentials: TEST_CREDENTIALS, fetch, baseUrl: "https://smoobu.example.com", now: () => new Date("2026-11-01T09:00:00Z"), sleep: async () => {} });
  return { client, calls };
}

describe("Smoobu messages", () => {
  it("reads every page of a booking's messages, oldest first, guest and host", async () => {
    const { client, calls } = fakeApi({
      "GET /api/reservations/77/messages": (u) =>
        u.searchParams.get("page") === "1"
          ? { status: 200, body: { page_count: 2, messages: [{ id: 5, type: 2, message: "Welcome!" }, { id: 9, type: 1, message: "", messageHtml: "<p>Where do we <b>park</b>?<br/>Thanks &amp; bye</p>" }] } }
          : { status: 200, body: { page_count: 2, messages: [{ id: 3, type: 1, message: " Hello " }, { id: 4, type: 3, message: "?" }, { id: 6, type: 1, message: "" }] } },
    });
    expect(await listMessages(client, 77)).toEqual([
      { id: 3, from: "guest", text: "Hello" },
      { id: 5, from: "host", text: "Welcome!" },
      { id: 9, from: "guest", text: "Where do we park?\nThanks & bye" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers["X-Signature"] ?? calls[0]?.headers["x-signature"]).toBeTruthy();
  });

  it("lists the conversations with their latest message", async () => {
    const { client, calls } = fakeApi({
      "GET /api/threads": () => ({
        status: 200,
        body: { page_count: 1, threads: [{ booking: { id: 77 }, apartment: { id: 398 }, latest_message: { id: 9 } }, { booking: { id: 78 }, latest_message: null }, { apartment: { id: 1 } }] },
      }),
    });
    expect(await listThreads(client, [398])).toEqual([
      { bookingId: 77, apartmentId: 398, latestMessageId: 9 },
      { bookingId: 78, apartmentId: null, latestMessageId: null },
    ]);
    expect(calls[0]?.url).toContain("apartments");
  });

  it("sends a reply as messageBody and refuses an empty one", async () => {
    const { client, calls } = fakeApi({
      "POST /api/reservations/77/messages/send-message-to-guest": () => ({ status: 201, body: { status: 201, title: "Resource created successfully", detail: "" } }),
    });
    await sendMessageToGuest(client, 77, "See you at 16:00!");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ messageBody: "See you at 16:00!" });
    await expect(sendMessageToGuest(client, 77, "  ")).rejects.toThrow("empty");
    expect(calls).toHaveLength(1);
  });

  it("explains a refused send", async () => {
    const { client } = fakeApi({
      "POST /api/reservations/77/messages/send-message-to-guest": () => ({ status: 400, body: { title: "Validation", detail: "messageBody is empty" } }),
    });
    await expect(sendMessageToGuest(client, 77, "x")).rejects.toThrow('Smoobu says: "messageBody is empty"');
  });

  it("reads the guest's language and the channel from a booking", () => {
    const b = { id: 1, type: "reservation", arrival: "2026-11-05", departure: "2026-11-09", apartment: { id: 398 }, language: "de-AT", channel: { id: 1, name: "Airbnb" } } as unknown as SmoobuBooking;
    expect(bookingLanguage(b)).toBe("de");
    expect(bookingChannel(b)).toBe("Airbnb");
    const bare = { id: 2, type: "reservation", arrival: "x", departure: "y", apartment: { id: 1 }, language: "German" } as unknown as SmoobuBooking;
    expect(bookingLanguage(bare)).toBeNull();
    expect(bookingChannel(bare)).toBeNull();
    expect(messageText({ htmlMessage: "a&nbsp;&lt;b&gt; &quot;c&quot; &#39;d&#39;" })).toBe("a <b> \"c\" 'd'");
  });
});
