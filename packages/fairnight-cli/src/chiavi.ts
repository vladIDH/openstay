/**
 * The optional passphrase of the Smoobu and Beds24 credentials, with the same
 * crypto as Fairguest (fairguest/src/crypto.ts) and a passphrase of its own, so
 * the autopilot never holds the key to the guests' data.
 *
 * Off until `fairnight chiavi cifra`: then chiavi-cifrate.json holds the key
 * pair, its private half locked with the passphrase, and each credentials file
 * becomes { "sealed": "fg1…" }. Writing needs only the public key, so `collega`
 * and a new Beds24 short token never need the passphrase; reading does.
 *
 * Where the passphrase comes from, in this order: this computer's keychain, the
 * variable FAIRNIGHT_FRASE_CHIAVI (for servers, see SECURITY.md for its limit),
 * or the terminal, asked once when the command starts. A scheduled run has no
 * terminal: without the first two it stops and sends nothing.
 * The passphrase and the credentials are never printed, not even in an error.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { open, publicKeyOf, seal, unlock, type KeyRecord } from "fairguest";
import type { KeyObject } from "node:crypto";
import { keyTexts } from "./chiavi-testi.js";
import { SetupError } from "./config.js";
import { stripBom, type Io } from "./io.js";
import { keychainOf, KeychainError } from "./portachiavi.js";
import { writePrivateFile } from "./private-file.js";

export const KEYS_FILE = "chiavi-cifrate.json";
export const PASSPHRASE_VARIABLE = "FAIRNIGHT_FRASE_CHIAVI";

/** The private key of the run, once opened: scrypt and the keychain only once per process. */
export interface OpenKeys {
  key?: KeyObject;
}

/** Anything that keeps the credentials closed. Sealed content stays where it is. */
export class KeysError extends SetupError {}
/** The passphrase is simply not here: a terminal could still ask for it. */
export class KeysLockedError extends KeysError {}

export const keysPath = (dir: string) => path.join(dir, KEYS_FILE);
export const keysOn = (dir: string) => existsSync(keysPath(dir));

type WhoAsks = Pick<Io, "env" | "locale">;

export function readKeys(dir: string, io: WhoAsks): KeyRecord | null {
  if (!keysOn(dir)) return null;
  let record: KeyRecord;
  try {
    record = JSON.parse(stripBom(readFileSync(keysPath(dir), "utf8"))) as KeyRecord;
  } catch {
    throw new KeysError(keyTexts(dir, io).damaged(KEYS_FILE));
  }
  if (typeof record?.publicKey !== "string" || typeof record.wrapped !== "string" || typeof record.kdf?.salt !== "string") {
    throw new KeysError(keyTexts(dir, io).damaged(KEYS_FILE));
  }
  return record;
}

/** The key if this passphrase opens it, null if not. */
function tryPassphrase(record: KeyRecord, passphrase: string): KeyObject | null {
  try {
    return unlock(record, passphrase);
  } catch {
    return null; // a wrong passphrase, or a key file that was changed: GCM cannot tell them apart
  }
}

/** Open the private key with what this computer offers, with nobody asked. */
export function openKey(dir: string, io: Io): KeyObject {
  if (io.openKeys?.key) return io.openKeys.key;
  const t = keyTexts(dir, io);
  const record = readKeys(dir, io);
  if (record === null) throw new KeysError(t.noKeysFile("smoobu-credentials.json / beds24-credentials.json"));
  const keychain = keychainOf(dir, io);
  let down = false;
  let key: KeyObject | null = null;
  if (keychain) {
    try {
      const saved = keychain.read();
      if (saved !== null) key = tryPassphrase(record, saved);
    } catch (e) {
      if (!(e instanceof KeychainError)) throw e;
      down = true;
    }
  }
  if (key === null) {
    const fromEnv = io.env?.[PASSPHRASE_VARIABLE];
    if (fromEnv) {
      key = tryPassphrase(record, fromEnv);
      if (key === null) throw new KeysError(t.wrong);
    }
  }
  if (key === null) throw new KeysLockedError(down ? t.keychainDown : t.notHere(keychain === null));
  if (io.openKeys) io.openKeys.key = key;
  return key;
}

/** With a terminal: the passphrase typed once at the start of a command that needs it. */
export function openKeyWith(dir: string, io: Io, passphrase: string): KeyObject {
  const t = keyTexts(dir, io);
  const record = readKeys(dir, io);
  if (record === null) throw new KeysError(t.notEncrypted);
  const key = tryPassphrase(record, passphrase);
  if (key === null) throw new KeysError(t.wrong);
  if (io.openKeys) io.openKeys.key = key;
  return key;
}

export const isSealed = (raw: unknown): raw is { sealed: string } => typeof (raw as { sealed?: unknown } | null)?.sealed === "string";

/** What a credentials file holds: its content as it is today, or sealed when the keys are on. */
export function sealedIfOn(dir: string, file: string, content: unknown, io: WhoAsks = {}): unknown {
  const record = readKeys(dir, io);
  return record ? { sealed: seal(publicKeyOf(record), content, file) } : content;
}

export function openWith<T>(dir: string, key: KeyObject, file: string, raw: { sealed: string }, io: WhoAsks = {}): T {
  try {
    return open<T>(key, raw.sealed, file);
  } catch {
    throw new KeysError(keyTexts(dir, io).damaged(file));
  }
}

/** The content of a sealed credentials file. */
export const openSealed = <T>(dir: string, file: string, raw: { sealed: string }, io: Io): T => openWith<T>(dir, openKey(dir, io), file, raw, io);

/** Write a credentials file, sealed when the keys are on. Returns how it is protected, for the host. */
export function writeCredentialsFile(dir: string, file: string, content: unknown, platform?: NodeJS.Platform): string {
  const value = sealedIfOn(dir, file, content);
  const protection = writePrivateFile(path.join(dir, file), value, platform);
  return isSealed(value) ? `encrypted with your passphrase, ${protection}` : protection;
}

/** Are the keys encrypted, with no way to open them in this run? */
export function keysClosed(dir: string, io: Io): boolean {
  if (!keysOn(dir)) return false;
  try {
    openKey(dir, io);
    return false;
  } catch (e) {
    if (e instanceof KeysError) return true;
    throw e;
  }
}

/** Can a run with nobody at the keyboard open the keys? null when they are not encrypted. */
export function canOpenAlone(dir: string, io: Io): boolean | null {
  if (!keysOn(dir)) return null;
  return !keysClosed(dir, { ...io, openKeys: {} });
}
