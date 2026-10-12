import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalQuery, canonicalString, rfc3986, signature, signedHeaders, smoobuTimestamp } from "../src/signing.js";

const CREDS = { apiKey: "test-key-0000-not-real", apiSecret: "test-secret-0000-not-real" };
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("HMAC signing (docs.smoobu.com, HMAC authentication)", () => {
  it("signs a known GET exactly as computed by hand", () => {
    // Written out by hand from the documented recipe: method, path, sorted
    // RFC 3986 query, timestamp, nonce, SHA-256 of the empty body, API key.
    const canonical = [
      "GET",
      "/api/rates",
      "apartments%5B%5D=398&apartments%5B%5D=401&end_date=2026-11-30&start_date=2026-11-01",
      "2026-11-01T09:00:00Z",
      "3f2c1a9e-6b7d-4c1e-9a8b-0d1e2f3a4b5c",
      EMPTY_SHA256,
      "test-key-0000-not-real",
    ].join("\n");
    const input = {
      method: "GET",
      path: "/api/rates",
      query: canonicalQuery({ start_date: "2026-11-01", end_date: "2026-11-30", apartments: [401, 398] }),
      body: "",
      timestamp: "2026-11-01T09:00:00Z",
      nonce: "3f2c1a9e-6b7d-4c1e-9a8b-0d1e2f3a4b5c",
    };
    expect(canonicalString(input, CREDS.apiKey)).toBe(canonical);
    // Value computed once by hand with openssl/node and pasted here: if the
    // recipe changes, this test fails.
    expect(signature(input, CREDS)).toBe("ck0tVvhMY75h8HB2TXzA9AgTc7GCiwwtHwbkoqikjVM=");
    expect(createHmac("sha256", CREDS.apiSecret).update(canonical).digest("base64")).toBe("ck0tVvhMY75h8HB2TXzA9AgTc7GCiwwtHwbkoqikjVM=");
  });

  it("signs a known POST, hashing the exact body", () => {
    const body = JSON.stringify({ apartments: [398], operations: [{ dates: ["2026-11-03"], daily_price: 95, min_length_of_stay: 2 }] });
    expect(createHash("sha256").update(body).digest("hex")).toBe("96c51f65a8651026e38268678287c5e99ad4cbfbe3cb675f15e6dac8ac8548bd");
    const input = { method: "POST", path: "/api/rates", query: "", body, timestamp: "2026-11-01T09:00:00Z", nonce: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" };
    expect(canonicalString(input, CREDS.apiKey).split("\n")).toEqual([
      "POST",
      "/api/rates",
      "",
      "2026-11-01T09:00:00Z",
      "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      "96c51f65a8651026e38268678287c5e99ad4cbfbe3cb675f15e6dac8ac8548bd",
      "test-key-0000-not-real",
    ]);
    expect(signature(input, CREDS)).toBe("fKFNqBOIQE375mmlWK3d/h7uF9/a6I6rNZ5KRdpQjoI=");
  });

  it("uses UTC timestamps without milliseconds", () => {
    expect(smoobuTimestamp(new Date("2026-11-01T10:00:00.789+01:00"))).toBe("2026-11-01T09:00:00Z");
  });

  it("uses a new UUID v4 nonce for every request, and only the four documented headers", () => {
    const req = { method: "GET", path: "/api/apartments", query: "", body: "" };
    const a = signedHeaders(req, CREDS, new Date("2026-11-01T09:00:00Z"));
    const b = signedHeaders(req, CREDS, new Date("2026-11-01T09:00:00Z"));
    expect(Object.keys(a).sort()).toEqual(["X-API-Key", "X-Nonce", "X-Signature", "X-Timestamp"]);
    expect(a["X-Nonce"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a["X-Nonce"]).not.toBe(b["X-Nonce"]);
    expect(a["X-Signature"]).not.toBe(b["X-Signature"]);
    expect(JSON.stringify(a)).not.toContain(CREDS.apiSecret); // the secret is never sent
  });

  it("encodes the query the RFC 3986 way and sorts it", () => {
    expect(rfc3986("a b!'()*")).toBe("a%20b%21%27%28%29%2A");
    expect(canonicalQuery({ b: "2", a: "x y", c: undefined, list: [2, 1] })).toBe("a=x%20y&b=2&list%5B%5D=1&list%5B%5D=2");
    expect(canonicalQuery()).toBe("");
  });
});
