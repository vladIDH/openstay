import { describe, expect, it } from "vitest";
import { changePassphrase, createKeys, open, PassphraseError, passphraseProblem, publicKeyOf, seal, SealError, unlock } from "../src/crypto.js";

// Cheap scrypt for tests; the real default costs about a quarter of a second.
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASS = "frase di prova lunga";

describe("keys and sealing", () => {
  it("seals with the public key alone and opens with the passphrase", () => {
    const record = createKeys(PASS, FAST);
    const sealed = seal(publicKeyOf(record), { givenName: "Ospite", document: "ZZ0000000" }, "guest_people/a/data");
    expect(sealed).not.toContain("Ospite");
    expect(sealed).not.toContain("ZZ0000000");
    expect(open(unlock(record, PASS), sealed, "guest_people/a/data")).toEqual({ givenName: "Ospite", document: "ZZ0000000" });
  });

  it("gives a different ciphertext every time", () => {
    const pub = publicKeyOf(createKeys(PASS, FAST));
    expect(seal(pub, "x", "p")).not.toBe(seal(pub, "x", "p"));
  });

  it("refuses a wrong passphrase", () => {
    const record = createKeys(PASS, FAST);
    expect(() => unlock(record, "frase sbagliata di prova")).toThrow(PassphraseError);
  });

  it("refuses a value moved to another place or changed", () => {
    const record = createKeys(PASS, FAST);
    const key = unlock(record, PASS);
    const sealed = seal(publicKeyOf(record), "Ospite Prova", "guest_people/a/data");
    expect(() => open(key, sealed, "guest_people/b/data")).toThrow(SealError);
    const parts = sealed.split(".");
    parts[4] = Buffer.from("altro").toString("base64url");
    expect(() => open(key, parts.join("."), "guest_people/a/data")).toThrow(SealError);
    expect(() => open(key, "not-sealed", "guest_people/a/data")).toThrow(SealError);
  });

  it("refuses a value sealed for another key pair", () => {
    const a = createKeys(PASS, FAST);
    const b = createKeys(PASS, FAST);
    const sealed = seal(publicKeyOf(a), "x", "p");
    expect(() => open(unlock(b, PASS), sealed, "p")).toThrow(SealError);
  });

  it("changes the passphrase without touching the sealed data", () => {
    const record = createKeys(PASS, FAST);
    const sealed = seal(publicKeyOf(record), "Ospite Prova", "p");
    const changed = changePassphrase(record, PASS, "un'altra frase di prova", FAST);
    expect(changed.publicKey).toBe(record.publicKey);
    expect(changed.kdf.salt).not.toBe(record.kdf.salt);
    expect(() => unlock(changed, PASS)).toThrow(PassphraseError);
    expect(open(unlock(changed, "un'altra frase di prova"), sealed, "p")).toBe("Ospite Prova");
    expect(() => changePassphrase(record, "sbagliata sbagliata", "x".repeat(12), FAST)).toThrow(PassphraseError);
  });

  it("asks for a passphrase of at least 12 characters", () => {
    expect(passphraseProblem("corta")).toMatch(/12 characters/);
    expect(passphraseProblem(PASS)).toBeNull();
  });
});
