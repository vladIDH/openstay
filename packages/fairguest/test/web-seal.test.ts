/** The browser's sealing must open with the host's own `open`. Invented data only. */
import { generateKeyPairSync, diffieHellman, createPublicKey, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKeys, open, unlock } from "../src/crypto.js";
import { fromBase64url, padded, rawPublicKey, toBase64url, webSeal, type X25519Fallback } from "../src/web-seal.js";

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASS = "frase segreta di prova";

/** A plain X25519 made with Node's crypto, standing in for a browser library. */
const nodeFallback: X25519Fallback = {
  keyPair() {
    const k = generateKeyPairSync("x25519");
    const priv = k.privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
    const pub = k.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
    return { privateKey: new Uint8Array(priv), publicKey: new Uint8Array(pub) };
  },
  shared(privateKey, publicKey) {
    const priv = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), privateKey]), format: "der", type: "pkcs8" });
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), publicKey]), format: "der", type: "spki" });
    return new Uint8Array(diffieHellman({ privateKey: priv, publicKey: pub }));
  },
};

describe("sealing in the browser", () => {
  it("seals with Web Crypto in the fg1 format that the host opens", async () => {
    const record = createKeys(PASS, FAST);
    const value = { guest: { givenName: "Ospite", surname1: "Prova" } };
    const sealed = await webSeal(record.publicKey, value, "relay/box-prova");
    expect(sealed.split(".")[0]).toBe("fg1");
    expect(open(unlock(record, PASS), sealed, "relay/box-prova")).toEqual(value);
    // Bound to its place.
    expect(() => open(unlock(record, PASS), sealed, "relay/another-box")).toThrow(/could not be opened/);
  });

  it("works with a plain X25519 when the browser has none", async () => {
    const record = createKeys(PASS, FAST);
    const subtle = globalThis.crypto.subtle;
    // A browser without X25519: generateKey refuses it.
    const old = new Proxy(subtle, {
      get(target, prop) {
        if (prop === "generateKey") return async () => Promise.reject(new Error("X25519 not supported"));
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const sealed = await webSeal(record.publicKey, { n: 1 }, "relay/x", { subtle: old, fallback: nodeFallback });
    expect(open(unlock(record, PASS), sealed, "relay/x")).toEqual({ n: 1 });
  });

  it("pads every value to the same size", () => {
    const a = JSON.stringify(padded({ name: "A" }));
    const b = JSON.stringify(padded({ name: "Un nome molto più lungo di prova" }));
    expect(a.length).toBe(4096);
    expect(b.length).toBe(4096);
  });

  it("reads the raw key and refuses anything else", () => {
    const record = createKeys(PASS, FAST);
    expect(rawPublicKey(record.publicKey)).toHaveLength(32);
    expect(() => rawPublicKey(toBase64url(new Uint8Array(44)))).toThrow(/Not an X25519/);
    expect(fromBase64url(toBase64url(Uint8Array.from([0, 250, 255])))).toEqual(Uint8Array.from([0, 250, 255]));
  });
});
