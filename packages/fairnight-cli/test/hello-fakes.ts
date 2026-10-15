/**
 * Fakes for the guest assistant's tests: the messages of Smoobu and Beds24
 * (in front of their fake servers, which serve the bookings) and a fake model.
 * Nothing here reaches the real services. All data is invented.
 */

type Init = { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal };
type Answer = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };

const json = (status: number, body: unknown): Answer => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });

export interface FakeSmoobuMessage {
  id: number;
  type: 1 | 2;
  message: string;
}

/**
 * Smoobu's messages endpoints, answered here; every other request goes on to
 * the fake Smoobu server (reservations, apartments). `sent` records replies.
 */
export function smoobuMessages(messages: Record<number, FakeSmoobuMessage[]>, apartmentOf: Record<number, number>) {
  const state = {
    messages,
    sent: [] as { bookingId: number; body: unknown }[],
    reads: [] as number[],
    threadReads: 0,
    failSend: null as null | { status: number; body: unknown },
  };
  const fetchFn = async (url: string, init: Init): Promise<Answer> => {
    const u = new URL(url);
    if (init.method === "GET" && u.pathname === "/api/threads") {
      state.threadReads++;
      const threads = Object.entries(state.messages).map(([booking, list]) => ({
        booking: { id: Number(booking), guest_name: "Invented Guest" },
        apartment: { id: apartmentOf[Number(booking)] ?? 0, name: "x" },
        latest_message: list.length ? { id: Math.max(...list.map((m) => m.id)), subject: "", text_content: "", html_content: "", created_at: "2026-10-31 10:00:00" } : null,
      }));
      return json(200, { page_number: 1, page_size: 100, page_count: 1, total_threads: threads.length, unread_messages: 0, threads });
    }
    let m = /^\/api\/reservations\/(\d+)\/messages$/.exec(u.pathname);
    if (init.method === "GET" && m) {
      const id = Number(m[1]);
      state.reads.push(id);
      const list = state.messages[id] ?? [];
      return json(200, { page_count: 1, page_size: 25, total_items: list.length, page: 1, messages: list.map((x) => ({ ...x, subject: "" })) });
    }
    m = /^\/api\/reservations\/(\d+)\/messages\/send-message-to-guest$/.exec(u.pathname);
    if (init.method === "POST" && m) {
      if (state.failSend) return json(state.failSend.status, state.failSend.body);
      const id = Number(m[1]);
      const body = JSON.parse(init.body ?? "{}") as { messageBody: string };
      state.sent.push({ bookingId: id, body });
      const list = (state.messages[id] ??= []);
      list.push({ id: Math.max(0, ...list.map((x) => x.id)) + 1, type: 2, message: body.messageBody });
      return json(201, { status: 201, title: "Resource created successfully", detail: "" });
    }
    return fetch(url, init);
  };
  return Object.assign(state, { fetch: fetchFn });
}

export interface FakeBeds24Message {
  id: number;
  bookingId: number;
  source: "guest" | "host" | "system" | "internalNote";
  message: string;
  time: string;
}

/** Beds24's /bookings/messages, answered here; the rest goes on to the fake Beds24 server. */
export function beds24Messages(messages: FakeBeds24Message[]) {
  const state = { messages, sent: [] as unknown[] };
  const fetchFn = async (url: string, init: Init): Promise<Answer> => {
    const u = new URL(url);
    if (u.pathname.endsWith("/bookings/messages")) {
      if (init.method === "GET") {
        const ids = u.searchParams.getAll("bookingId").map(Number);
        return json(200, { success: true, type: "message", data: state.messages.filter((x) => ids.includes(x.bookingId)), pages: { nextPageExists: false } });
      }
      const body = JSON.parse(init.body ?? "[]") as { bookingId: number; message: string }[];
      state.sent.push(...body);
      for (const b of body) state.messages.push({ id: 900 + state.sent.length, bookingId: b.bookingId, source: "host", message: b.message, time: "2026-11-01T09:05:00Z" });
      return json(201, body.map(() => ({ success: true, new: { id: 900 + state.sent.length } })));
    }
    return fetch(url, init);
  };
  return Object.assign(state, { fetch: fetchFn });
}

export interface ModelReply {
  language?: string;
  reply: string;
  needsHost?: boolean;
  note?: string;
}

/**
 * A fake Anthropic (or Ollama) that answers with `reply(request body)`.
 * Records every request: url, headers and body.
 */
export function fakeModel(reply: (body: { system?: { text: string }[]; messages: { role: string; content: string }[] }) => ModelReply | { status: number; body: unknown }) {
  const calls: { url: string; headers: Record<string, string>; body: { system?: { text: string }[]; messages: { role: string; content: string }[]; model: string } }[] = [];
  const fetchFn = async (url: string, init: Init): Promise<Answer> => {
    const body = JSON.parse(init.body ?? "{}");
    calls.push({ url, headers: init.headers, body });
    const r = reply(body);
    if ("status" in r) return json(r.status, r.body);
    const draft = JSON.stringify({ language: r.language ?? "en", reply: r.reply, needsHost: r.needsHost ?? false, note: r.note ?? "" });
    if (url.endsWith("/api/chat")) return json(200, { message: { role: "assistant", content: draft }, prompt_eval_count: 500, eval_count: 60 });
    return json(200, {
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: draft }],
      usage: { input_tokens: 300, output_tokens: 80, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 },
    });
  };
  return { fetch: fetchFn, calls };
}
