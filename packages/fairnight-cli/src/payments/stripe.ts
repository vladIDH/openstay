/**
 * The host's own Stripe account: their secret key, in their folder, and the
 * few calls the check-in payments need. Money goes from the guest's card to
 * the host's Stripe account; nothing passes through Fairnight or Khlumen.
 *
 * - The key: STRIPE_SECRET_KEY, or the file stripe-credentials.json written by
 *   `fairnight pagamenti collega` (readable only by the user where the system
 *   allows it). Never printed, not even shortened.
 * - No key, no call: every function that talks to Stripe gets the key first,
 *   and without it nothing leaves the computer.
 * - A test key (sk_test_…) works in Stripe's test mode: no real money moves.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { SetupError } from "../config.js";
import { writePrivateFile } from "../credentials.js";
import { stripBom, type Io, type SmoobuFetchLike } from "../io.js";

export const STRIPE_FILE = "stripe-credentials.json";
export const STRIPE_API = "https://api.stripe.com";

export interface StripeKey {
  key: string;
  /** false: Stripe's test mode (sk_test_ / rk_test_). */
  live: boolean;
  source: "environment" | "file";
}

/** A secret or restricted key; a publishable key (pk_) is refused: it cannot create payments. */
export const isStripeSecretKey = (k: string): boolean => /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,247}$/.test(k);

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

export function stripeKeyPath(dir: string): string {
  return path.join(dir, STRIPE_FILE);
}

/** The host's key, or null when there is none (then nothing is ever sent to Stripe). */
export function loadStripeKey(dir: string, env: Record<string, string | undefined> = {}): StripeKey | null {
  const fromEnv = env.STRIPE_SECRET_KEY?.trim();
  if (fromEnv) {
    if (!isStripeSecretKey(fromEnv)) throw new SetupError("STRIPE_SECRET_KEY is not a Stripe secret key (sk_test_…, sk_live_…, rk_test_… or rk_live_…).");
    return { key: fromEnv, live: /_live_/.test(fromEnv), source: "environment" };
  }
  const file = stripeKeyPath(dir);
  if (!existsSync(file)) return null;
  let parsed: { secretKey?: unknown };
  try {
    parsed = JSON.parse(stripBom(readFileSync(file, "utf8"))) as { secretKey?: unknown };
  } catch {
    throw new SetupError(`${STRIPE_FILE} cannot be read: run "fairnight pagamenti collega" again.`);
  }
  if (typeof parsed.secretKey !== "string" || !isStripeSecretKey(parsed.secretKey)) throw new SetupError(`${STRIPE_FILE} has no valid key: run "fairnight pagamenti collega" again.`);
  return { key: parsed.secretKey, live: /_live_/.test(parsed.secretKey), source: "file" };
}

export function saveStripeKey(dir: string, key: string, platform: NodeJS.Platform = process.platform): string {
  return writePrivateFile(stripeKeyPath(dir), { secretKey: key }, platform);
}

/** Stripe's form encoding: nested objects and lists as a[b][0]=c. */
export function formEncode(data: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === "object" && item !== null ? formEncode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export interface PaymentIntentView {
  id: string;
  /** requires_payment_method, requires_capture, succeeded, canceled, processing… */
  status: string;
  amount: number;
  amountCapturable: number;
  amountReceived: number;
  currency: string;
  /** Unix seconds: the last moment the hold can be captured, when Stripe says it. */
  captureBefore: number | null;
}

export class StripeClient {
  private readonly fetchFn: SmoobuFetchLike;
  private readonly base: string;

  constructor(
    private readonly key: StripeKey,
    io: Io,
  ) {
    this.fetchFn = io.stripeFetch ?? ((url, init) => fetch(url, init));
    this.base = (io.stripeBaseUrl ?? STRIPE_API).replace(/\/+$/, "");
  }

  get live(): boolean {
    return this.key.live;
  }

  private async call<T>(method: "GET" | "POST", pathAndQuery: string, body?: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.key.key}` };
    let encoded: string | undefined;
    if (method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded";
      // A retried request never makes a second link or a second capture.
      headers["idempotency-key"] = randomBytes(16).toString("hex");
      encoded = formEncode(body ?? {}).join("&");
    }
    let res;
    try {
      res = await this.fetchFn(`${this.base}${pathAndQuery}`, { method, headers, ...(encoded !== undefined ? { body: encoded } : {}), signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new StripeError(`Stripe cannot be reached (${(e as Error).message}).`);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (res.status < 200 || res.status >= 300) {
      const msg = (parsed as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 200);
      throw new StripeError(`Stripe said no (HTTP ${res.status}): ${msg}`, res.status);
    }
    return parsed as T;
  }

  /** A check that the key works, without touching anything: the balance. */
  async check(): Promise<void> {
    await this.call("GET", "/v1/balance");
  }

  /** A one-off price (and its product) for one payment link. */
  async createPrice(p: { currency: string; unitAmount: number; name: string }): Promise<string> {
    const r = await this.call<{ id: string }>("POST", "/v1/prices", { currency: p.currency.toLowerCase(), unit_amount: p.unitAmount, product_data: { name: p.name.slice(0, 250) } });
    return r.id;
  }

  /**
   * A payment link usable once. `manual` makes a hold (the deposit): the
   * money is only blocked on the card until the host keeps or releases it.
   */
  async createPaymentLink(p: { price: string; manual: boolean; metadata: Record<string, string>; locale?: string }): Promise<{ id: string; url: string }> {
    const r = await this.call<{ id: string; url: string }>("POST", "/v1/payment_links", {
      line_items: [{ price: p.price, quantity: 1 }],
      metadata: p.metadata,
      payment_intent_data: { capture_method: p.manual ? "manual" : "automatic", metadata: p.metadata },
      payment_method_types: ["card"],
      restrictions: { completed_sessions: { limit: 1 } },
    });
    return { id: r.id, url: r.url };
  }

  async deactivateLink(id: string): Promise<void> {
    await this.call("POST", `/v1/payment_links/${encodeURIComponent(id)}`, { active: false });
  }

  /** The finished checkouts of a link: at most one, since the link takes one. */
  async completedSessions(linkId: string): Promise<{ id: string; paymentIntent: string | null }[]> {
    const r = await this.call<{ data: { id: string; status: string; payment_intent: string | { id: string } | null }[] }>(
      "GET",
      `/v1/checkout/sessions?payment_link=${encodeURIComponent(linkId)}&status=complete&limit=5`,
    );
    return r.data.map((s) => ({ id: s.id, paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null) }));
  }

  async paymentIntent(id: string): Promise<PaymentIntentView> {
    const r = await this.call<RawIntent>("GET", `/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`);
    return intentView(r);
  }

  /** Keep the deposit, all of it or part of it (the rest is released). */
  async capture(id: string, amount?: number): Promise<PaymentIntentView> {
    return intentView(await this.call<RawIntent>("POST", `/v1/payment_intents/${encodeURIComponent(id)}/capture`, amount !== undefined ? { amount_to_capture: amount } : {}));
  }

  /** Release the deposit: nothing is charged. */
  async cancel(id: string): Promise<PaymentIntentView> {
    return intentView(await this.call<RawIntent>("POST", `/v1/payment_intents/${encodeURIComponent(id)}/cancel`, {}));
  }
}

interface RawIntent {
  id: string;
  status: string;
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  currency: string;
  latest_charge?: string | { payment_method_details?: { card?: { capture_before?: number } } } | null;
}

function intentView(r: RawIntent): PaymentIntentView {
  const charge = typeof r.latest_charge === "object" && r.latest_charge !== null ? r.latest_charge : null;
  return {
    id: r.id,
    status: r.status,
    amount: r.amount,
    amountCapturable: r.amount_capturable ?? 0,
    amountReceived: r.amount_received ?? 0,
    currency: r.currency.toUpperCase(),
    captureBefore: charge?.payment_method_details?.card?.capture_before ?? null,
  };
}
