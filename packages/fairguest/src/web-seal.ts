/**
 * Sealing in the guest's browser, with the Web Crypto API only: the same
 * "fg1" format as crypto.ts, so the host's computer opens it with `open`.
 *
 * X25519 Diffie-Hellman with a fresh key pair, HKDF-SHA256 (salt: both public
 * keys in DER SPKI, info "fairguest seal v1"), AES-256-GCM with "fg1:<place>"
 * as additional data. Only the host's PUBLIC key is needed: the browser can
 * seal but never open.
 *
 * Browsers without X25519 in Web Crypto (Chrome before 133, Firefox before
 * 130, Safari before 17) can pass `fallback`, a plain X25519 implementation;
 * HKDF and AES-GCM always come from Web Crypto.
 */

/** Web Crypto as the runtime has it (browser, Node, Workers); no DOM types needed. */
type Subtle = typeof globalThis.crypto.subtle;
type KeyPair = Awaited<ReturnType<Subtle["generateKey"]>> & { publicKey: Parameters<Subtle["exportKey"]>[1]; privateKey: Parameters<Subtle["exportKey"]>[1] };

/** DER prefix of an X25519 SubjectPublicKeyInfo: the raw 32-byte key follows. */
const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);
const INFO = new TextEncoder().encode("fairguest seal v1");

export interface X25519Fallback {
  /** A fresh private key (32 random bytes) and its raw public key. */
  keyPair(): { privateKey: Uint8Array; publicKey: Uint8Array };
  /** The shared secret with a raw public key. */
  shared(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array;
}

export function toBase64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** The raw 32 bytes of a host public key given as base64url DER SPKI (the form stored in the KeyRecord). */
export function rawPublicKey(spkiB64url: string): Uint8Array {
  const der = fromBase64url(spkiB64url);
  if (der.length !== 44 || SPKI_PREFIX.some((b, i) => der[i] !== b)) throw new Error("Not an X25519 public key.");
  return der.slice(12);
}

/** Does this browser have X25519 in Web Crypto? */
export async function hasWebX25519(subtle: Subtle = globalThis.crypto.subtle): Promise<boolean> {
  try {
    await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    return true;
  } catch {
    return false;
  }
}

/** Bytes that own a plain ArrayBuffer, as Web Crypto's types want them. */
type Bytes = Uint8Array<ArrayBuffer>;

async function ephemeralSecret(subtle: Subtle, recipientSpki: Bytes, fallback: X25519Fallback | undefined): Promise<{ secret: Bytes; ephSpki: Bytes }> {
  if (!fallback || (await hasWebX25519(subtle))) {
    const eph = (await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as KeyPair;
    const recipient = await subtle.importKey("spki", recipientSpki, { name: "X25519" }, false, []);
    const secret = new Uint8Array(await subtle.deriveBits({ name: "X25519", public: recipient }, eph.privateKey, 256));
    const ephSpki = new Uint8Array(await subtle.exportKey("spki", eph.publicKey));
    return { secret, ephSpki };
  }
  const pair = fallback.keyPair();
  return { secret: new Uint8Array(fallback.shared(pair.privateKey, recipientSpki.slice(12))), ephSpki: concat(SPKI_PREFIX, pair.publicKey) };
}

/**
 * Seal a value for the host's public key (base64url DER SPKI). `place` binds
 * it to where it will be opened, as in crypto.ts.
 */
export async function webSeal(publicKeySpki: string, value: unknown, place: string, options: { subtle?: Subtle; fallback?: X25519Fallback } = {}): Promise<string> {
  const subtle = options.subtle ?? globalThis.crypto.subtle;
  const recipientSpki = concat(SPKI_PREFIX, rawPublicKey(publicKeySpki));
  const { secret, ephSpki } = await ephemeralSecret(subtle, recipientSpki, options.fallback);
  const ikm = await subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: concat(ephSpki, recipientSpki), info: INFO }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`fg1:${place}`) }, key, new TextEncoder().encode(JSON.stringify(value))),
  );
  // Web Crypto appends the 16-byte tag; the fg1 format keeps it apart.
  const ct = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);
  return ["fg1", toBase64url(ephSpki), toBase64url(iv), toBase64url(tag), toBase64url(ct)].join(".");
}

/**
 * The same length for every guest, so the size of what travels does not tell
 * how much was written: the object gets a filler field (ignored when read).
 */
export function padded<T extends object>(value: T, size = 4096): T & { _pad: string } {
  const bare = JSON.stringify({ ...value, _pad: "" }).length;
  const blocks = Math.max(1, Math.ceil(bare / size));
  return { ...value, _pad: ".".repeat(blocks * size - bare) };
}
