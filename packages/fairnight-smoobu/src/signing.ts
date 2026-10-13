/**
 * HMAC-SHA256 request signing, as described in the official Smoobu docs
 * (docs.smoobu.com, "HMAC authentication").
 *
 * Canonical string, one component per line:
 *   METHOD \n PATH \n QUERY \n TIMESTAMP \n NONCE \n SHA256-HEX(BODY) \n API_KEY
 * - QUERY: parameters RFC 3986-encoded and sorted, joined with "&" (empty for none);
 * - TIMESTAMP: ISO 8601 UTC without milliseconds, e.g. 2026-04-01T12:00:00Z,
 *   accepted within 5 minutes of Smoobu's clock;
 * - NONCE: a UUID v4 used exactly once;
 * - BODY: the exact bytes sent; a GET hashes the empty string.
 * The signature is the Base64 HMAC-SHA256 of that string with the API SECRET.
 * The secret itself is never sent.
 *
 * The legacy `Api-Key` header is not supported on purpose: Smoobu stops
 * accepting it on 31 October 2026.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

/** RFC 3986: encodeURIComponent also leaves !'()* unescaped, so escape those too. */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type QueryValue = string | number | boolean | readonly (string | number)[];

/**
 * Query string in canonical form: every key and value encoded, pairs sorted by
 * key then value. The same string is used in the URL, so what is signed is
 * exactly what is sent. Arrays become repeated `key[]=value` pairs.
 */
export function canonicalQuery(query: Record<string, QueryValue | undefined> = {}): string {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) pairs.push([rfc3986(`${key}[]`), rfc3986(String(v))]);
    else pairs.push([rfc3986(key), rfc3986(String(value))]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/** 2026-04-01T12:00:00Z: UTC, no milliseconds. */
export function smoobuTimestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export interface SignInput {
  method: string;
  path: string;
  query: string;
  body: string;
  timestamp: string;
  nonce: string;
}

export function canonicalString(input: SignInput, apiKey: string): string {
  return [input.method.toUpperCase(), input.path, input.query, input.timestamp, input.nonce, sha256Hex(input.body), apiKey].join("\n");
}

export function signature(input: SignInput, credentials: Credentials): string {
  return createHmac("sha256", credentials.apiSecret).update(canonicalString(input, credentials.apiKey), "utf8").digest("base64");
}

/** The four authentication headers for one request. A fresh nonce every time. */
export function signedHeaders(
  request: { method: string; path: string; query: string; body: string },
  credentials: Credentials,
  now: Date,
  nonce: string = randomUUID(),
): Record<string, string> {
  const input: SignInput = { ...request, timestamp: smoobuTimestamp(now), nonce };
  return {
    "X-API-Key": credentials.apiKey,
    "X-Timestamp": input.timestamp,
    "X-Nonce": nonce,
    "X-Signature": signature(input, credentials),
  };
}
