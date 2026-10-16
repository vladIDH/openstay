/** A fake Stripe for the tests: test keys only, no network. */
import { expect } from "vitest";
import type { SmoobuFetchLike } from "../src/io.js";

/** Stripe in memory, test mode only. `pay(link)` is the guest finishing Stripe's page. */
export function fakeStripe() {
  const calls: string[] = [];
  const prices = new Map<string, { amount: number; currency: string; name: string }>();
  const links = new Map<string, { url: string; price: string; manual: boolean; active: boolean; metadata: Record<string, string> }>();
  const sessions: { id: string; link: string; pi: string }[] = [];
  const intents = new Map<string, { id: string; status: string; amount: number; amount_capturable: number; amount_received: number; currency: string }>();
  let n = 0;
  const id = (p: string) => `${p}_test_${++n}`;
  const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const fetchFn: SmoobuFetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.pathname}`);
    if (!/^Bearer sk_test_/.test(init.headers.authorization ?? "")) return reply(401, { error: { message: "Invalid API Key provided" } });
    const form = new URLSearchParams(init.body ?? "");
    if (init.method === "POST" && u.pathname === "/v1/prices") {
      const p = id("price");
      prices.set(p, { amount: Number(form.get("unit_amount")), currency: String(form.get("currency")).toUpperCase(), name: String(form.get("product_data[name]")) });
      return reply(200, { id: p });
    }
    if (init.method === "POST" && u.pathname === "/v1/payment_links") {
      const l = id("plink");
      const metadata: Record<string, string> = {};
      for (const [k, v] of form) if (k.startsWith("metadata[")) metadata[k.slice(9, -1)] = v;
      links.set(l, { url: `https://buy.stripe.com/test_${l}`, price: String(form.get("line_items[0][price]")), manual: form.get("payment_intent_data[capture_method]") === "manual", active: true, metadata });
      expect(form.get("restrictions[completed_sessions][limit]")).toBe("1");
      return reply(200, { id: l, url: links.get(l)?.url });
    }
    const link = /^\/v1\/payment_links\/([^/]+)$/.exec(u.pathname);
    if (init.method === "POST" && link) {
      const l = links.get(link[1] as string);
      if (l) l.active = form.get("active") !== "false";
      return reply(200, { id: link[1] });
    }
    if (init.method === "GET" && u.pathname === "/v1/checkout/sessions") {
      const of = u.searchParams.get("payment_link");
      return reply(200, { data: sessions.filter((s) => s.link === of).map((s) => ({ id: s.id, status: "complete", payment_intent: s.pi })) });
    }
    const pi = /^\/v1\/payment_intents\/([^/]+)(\/capture|\/cancel)?$/.exec(u.pathname);
    if (pi) {
      const it = intents.get(pi[1] as string);
      if (!it) return reply(404, { error: { message: "No such payment_intent" } });
      if (pi[2] === "/capture") {
        if (it.status !== "requires_capture") return reply(400, { error: { message: "not capturable" } });
        const amount = form.has("amount_to_capture") ? Number(form.get("amount_to_capture")) : it.amount;
        Object.assign(it, { status: "succeeded", amount_received: amount, amount_capturable: 0 });
      } else if (pi[2] === "/cancel") Object.assign(it, { status: "canceled", amount_capturable: 0 });
      return reply(200, it);
    }
    if (init.method === "GET" && u.pathname === "/v1/balance") return reply(200, { object: "balance" });
    return reply(404, { error: { message: `fake Stripe: ${init.method} ${u.pathname}` } });
  };
  const pay = (linkUrl: string) => {
    const [lid, l] = [...links].find(([, x]) => x.url === linkUrl) ?? [];
    if (!lid || !l?.active) throw new Error(`no active link ${linkUrl}`);
    const price = prices.get(l.price) as { amount: number; currency: string };
    const p = id("pi");
    intents.set(p, { id: p, status: l.manual ? "requires_capture" : "succeeded", amount: price.amount, amount_capturable: l.manual ? price.amount : 0, amount_received: l.manual ? 0 : price.amount, currency: price.currency.toLowerCase() });
    sessions.push({ id: id("cs"), link: lid, pi: p });
    l.active = false;
    return p;
  };
  return { fetchFn, calls, prices, links, intents, pay };
}
