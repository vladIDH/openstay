/**
 * Encryption at rest of the guests' personal data, with Node's own crypto only.
 *
 * - Every personal field is sealed for an X25519 public key: a fresh key pair
 *   per value, Diffie-Hellman, HKDF-SHA256, AES-256-GCM. Writing needs only the
 *   public key, so the check-in form can store a guest without knowing any secret.
 * - The private key is kept encrypted with AES-256-GCM under a key derived from
 *   the host's passphrase with scrypt. Reading needs the passphrase.
 * - Changing the passphrase re-encrypts only the private key: the data stays as it is.
 * - A sealed value is bound to its place (table, row, column) through the GCM
 *   additional data, so it cannot be moved to another row unnoticed.
 *
 * If the passphrase is lost, nothing can be decrypted: there is no way back.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  type KeyObject,
} from "node:crypto";

const VERSION = "fg1";
const INFO = Buffer.from("fairguest seal v1");

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** About a quarter of a second on a laptop, 128 MiB of memory. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

/** What is stored in the database: the public key and the wrapped private key. */
export interface KeyRecord {
  version: 1;
  publicKey: string;
  kdf: { name: "scrypt"; salt: string } & ScryptParams;
  iv: string;
  tag: string;
  wrapped: string;
}

export class PassphraseError extends Error {
  constructor(message = "Wrong passphrase: the guests' data cannot be opened with it.") {
    super(message);
    this.name = "PassphraseError";
  }
}

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function deriveKek(passphrase: string, salt: Buffer, params: ScryptParams): Buffer {
  return scryptSync(passphrase.normalize("NFC"), salt, 32, { ...params, maxmem: 256 * params.N * params.r + 1024 * 1024 });
}

/** Rules for a passphrase: long enough to resist guessing on a stolen database. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.normalize("NFC").length < 12) return "The passphrase must be at least 12 characters (a few words are easier to remember).";
  return null;
}

function wrap(privateDer: Buffer, passphrase: string, params: ScryptParams, publicKey: string): KeyRecord {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKek(passphrase, salt, params), iv);
  cipher.setAAD(Buffer.from(publicKey));
  const wrapped = Buffer.concat([cipher.update(privateDer), cipher.final()]);
  return { version: 1, publicKey, kdf: { name: "scrypt", salt: b64(salt), ...params }, iv: b64(iv), tag: b64(cipher.getAuthTag()), wrapped: b64(wrapped) };
}

/** A new key pair, its private half locked with the passphrase. */
export function createKeys(passphrase: string, params: ScryptParams = DEFAULT_SCRYPT): KeyRecord {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const pub = b64(publicKey.export({ type: "spki", format: "der" }));
  return wrap(privateKey.export({ type: "pkcs8", format: "der" }), passphrase, params, pub);
}

/** The private key, if the passphrase is right. */
export function unlock(record: KeyRecord, passphrase: string): KeyObject {
  const { salt, name: _name, ...params } = record.kdf;
  const decipher = createDecipheriv("aes-256-gcm", deriveKek(passphrase, unb64(salt), params), unb64(record.iv));
  decipher.setAAD(Buffer.from(record.publicKey));
  decipher.setAuthTag(unb64(record.tag));
  let der: Buffer;
  try {
    der = Buffer.concat([decipher.update(unb64(record.wrapped)), decipher.final()]);
  } catch {
    throw new PassphraseError();
  }
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

/** Same key pair, new passphrase (and new salt). The sealed data does not change. */
export function changePassphrase(record: KeyRecord, oldPassphrase: string, newPassphrase: string, params: ScryptParams = DEFAULT_SCRYPT): KeyRecord {
  const key = unlock(record, oldPassphrase);
  return wrap(key.export({ type: "pkcs8", format: "der" }), newPassphrase, params, record.publicKey);
}

export const publicKeyOf = (record: KeyRecord): KeyObject => createPublicKey({ key: unb64(record.publicKey), format: "der", type: "spki" });

function sharedKey(secret: Buffer, ephemeralPub: Buffer, recipientPub: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.concat([ephemeralPub, recipientPub]), INFO, 32));
}

/**
 * Seal a value for the public key. `place` names where it will be stored
 * (e.g. "guest_people/<id>/data") and must be given again to open it.
 */
export function seal(publicKey: KeyObject, value: unknown, place: string): string {
  const eph = generateKeyPairSync("x25519");
  const ephPub = eph.publicKey.export({ type: "spki", format: "der" });
  const recipientPub = publicKey.export({ type: "spki", format: "der" });
  const key = sharedKey(diffieHellman({ privateKey: eph.privateKey, publicKey }), ephPub, recipientPub);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${place}`));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, b64(ephPub), b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

export function open<T = unknown>(privateKey: KeyObject, sealed: string, place: string): T {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new SealError(`Not a sealed value of this version (${place}).`);
  const [, ephB64, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const ephPub = unb64(ephB64);
  const ephKey = createPublicKey({ key: ephPub, format: "der", type: "spki" });
  const recipientPub = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const key = sharedKey(diffieHellman({ privateKey, publicKey: ephKey }), ephPub, recipientPub);
  const decipher = createDecipheriv("aes-256-gcm", key, unb64(ivB64));
  decipher.setAAD(Buffer.from(`${VERSION}:${place}`));
  decipher.setAuthTag(unb64(tagB64));
  try {
    return JSON.parse(Buffer.concat([decipher.update(unb64(ctB64)), decipher.final()]).toString("utf8")) as T;
  } catch {
    throw new SealError(`A sealed value could not be opened (${place}): it was changed, moved, or sealed with another key.`);
  }
}
