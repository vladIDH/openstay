/**
 * `fairnight chiavi`: the optional passphrase of the Smoobu and Beds24 keys.
 *
 *   stato      which files are encrypted, and whether the keychain has the passphrase
 *   cifra      encrypt the saved keys (asks to confirm)
 *   chiaro     back in clear (asks the passphrase and to confirm)
 *   ricorda    write the passphrase in this computer's keychain again
 *   dimentica  remove it from the keychain
 *   azzera     passphrase lost: delete the encrypted keys, to connect again
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createKeys, DEFAULT_SCRYPT, open, passphraseProblem, publicKeyOf, seal, unlock, type KeyRecord } from "fairguest";
import type { KeyObject } from "node:crypto";
import { BEDS24_CREDENTIALS_FILE } from "./beds24-credentials.js";
import { isSealed, KEYS_FILE, keysOn, keysPath, openKeyWith, openWith, readKeys } from "./chiavi.js";
import { keyTexts, type KeyTexts } from "./chiavi-testi.js";
import { SetupError } from "./config.js";
import { CREDENTIALS_FILE } from "./credentials.js";
import { UsageError } from "./errors.js";
import { stripBom, type Io } from "./io.js";
import { KeychainError, keychainOf } from "./portachiavi.js";
import { replacePrivateFile } from "./private-file.js";

const FILES = [
  { file: CREDENTIALS_FILE, name: "Smoobu" },
  { file: BEDS24_CREDENTIALS_FILE, name: "Beds24" },
];

const YES = ["y", "yes", "s", "si", "sì"];

function readRaw(dir: string, file: string, t: KeyTexts): unknown {
  const full = path.join(dir, file);
  if (!existsSync(full)) return undefined;
  try {
    return JSON.parse(stripBom(readFileSync(full, "utf8")));
  } catch {
    throw new SetupError(t.damaged(file)); // before anything is changed
  }
}

const stateOf = (dir: string, file: string, t: KeyTexts) => {
  const raw = readRaw(dir, file, t);
  return raw === undefined ? ("none" as const) : isSealed(raw) ? ("sealed" as const) : ("clear" as const);
};

function terminal(io: Io, t: KeyTexts): NonNullable<Io["prompt"]> {
  if (!io.prompt) throw new SetupError(t.needsTerminal);
  return io.prompt;
}

async function askPassphrase(io: Io, t: KeyTexts): Promise<string> {
  const answer = await terminal(io, t)(t.passphrase, { hidden: true });
  if (!answer) throw new SetupError(t.empty);
  return answer;
}

async function askNew(io: Io, t: KeyTexts): Promise<string> {
  const prompt = terminal(io, t);
  const first = await prompt(t.newPassphrase, { hidden: true });
  if (passphraseProblem(first)) throw new SetupError(t.tooShort);
  if ((await prompt(t.again, { hidden: true })) !== first) throw new SetupError(t.differ);
  return first;
}

const yes = async (io: Io, t: KeyTexts, question: string, byDefault = false) => {
  const answer = (await terminal(io, t)(question, { hidden: false })).trim().toLowerCase();
  return answer === "" ? byDefault : YES.includes(answer);
};

/** Keep the passphrase in the keychain, saying what happened. Encrypted keys stay encrypted either way. */
function remember(dir: string, io: Io, t: KeyTexts, passphrase: string): boolean {
  const keychain = keychainOf(dir, io);
  if (keychain === null) {
    io.out(t.noKeychain);
    return false;
  }
  try {
    keychain.save(passphrase);
    io.out(t.remembered);
    return true;
  } catch (e) {
    if (!(e instanceof KeychainError)) throw e;
    io.out(t.rememberFailed);
    return false;
  }
}

function status(dir: string, io: Io, t: KeyTexts): number {
  for (const { file, name } of FILES) io.out(t.stateFile(name, stateOf(dir, file, t)));
  if (!keysOn(dir)) {
    io.out(t.notEncrypted);
    return 0;
  }
  const keychain = keychainOf(dir, io);
  if (keychain === null) {
    io.out(t.stateKeychain("none"));
    return 0;
  }
  try {
    io.out(t.stateKeychain(keychain.read() !== null ? "yes" : "no"));
  } catch (e) {
    if (!(e instanceof KeychainError)) throw e;
    io.out(t.stateKeychain("down"));
  }
  return 0;
}

async function encrypt(dir: string, io: Io, t: KeyTexts): Promise<number> {
  terminal(io, t);
  const plain = FILES.map(({ file }) => ({ file, raw: readRaw(dir, file, t) })).filter((f) => f.raw !== undefined && !isSealed(f.raw));
  const existing = readKeys(dir, io);
  if (existing !== null && plain.length === 0) {
    io.out(t.nothingToEncrypt);
    return 0;
  }
  if (!(await yes(io, t, t.confirmEncrypt))) {
    io.out(t.leftAsIs);
    return 0;
  }
  // A run stopped halfway left some files in clear: finish them with the same key.
  const passphrase = existing !== null ? await askPassphrase(io, t) : await askNew(io, t);
  const record: KeyRecord = existing ?? createKeys(passphrase, io.scryptCost ?? DEFAULT_SCRYPT);
  const key = existing !== null ? openKeyWith(dir, io, passphrase) : unlock(record, passphrase);
  const sealed = plain.map((f) => {
    const value = seal(publicKeyOf(record), f.raw, f.file);
    // Nothing is replaced before it has been opened again.
    if (JSON.stringify(open(key, value, f.file)) !== JSON.stringify(f.raw)) throw new SetupError(t.damaged(f.file));
    return { file: f.file, value };
  });
  if (existing === null) replacePrivateFile(keysPath(dir), record);
  for (const s of sealed) replacePrivateFile(path.join(dir, s.file), { sealed: s.value });
  io.out(t.encrypted(sealed.length));
  io.out(t.lost);
  io.out(t.old);
  if (await yes(io, t, t.askRemember, true)) remember(dir, io, t, passphrase);
  return 0;
}

async function clear(dir: string, io: Io, t: KeyTexts): Promise<number> {
  terminal(io, t);
  if (!keysOn(dir)) {
    io.out(t.notEncrypted);
    return 0;
  }
  const key: KeyObject = openKeyWith(dir, io, await askPassphrase(io, t));
  // Everything is opened first: one damaged file and nothing changes.
  const opened = FILES.flatMap(({ file }) => {
    const raw = readRaw(dir, file, t);
    return isSealed(raw) ? [{ file, content: openWith<unknown>(dir, key, file, raw, io) }] : [];
  });
  if (!(await yes(io, t, t.confirmClear))) {
    io.out(t.leftAsIs);
    return 0;
  }
  for (const o of opened) replacePrivateFile(path.join(dir, o.file), o.content);
  rmSync(keysPath(dir), { force: true });
  forgetQuietly(dir, io);
  io.out(t.cleared);
  return 0;
}

function forgetQuietly(dir: string, io: Io): void {
  try {
    keychainOf(dir, io)?.remove();
  } catch (e) {
    if (!(e instanceof KeychainError)) throw e;
  }
}

async function rememberAgain(dir: string, io: Io, t: KeyTexts): Promise<number> {
  terminal(io, t);
  if (!keysOn(dir)) {
    io.out(t.notEncrypted);
    return 0;
  }
  const passphrase = await askPassphrase(io, t);
  openKeyWith(dir, io, passphrase); // a wrong one is refused here, not at 06:00
  return remember(dir, io, t, passphrase) ? 0 : 1;
}

async function reset(dir: string, io: Io, t: KeyTexts): Promise<number> {
  const prompt = terminal(io, t);
  const sealed = FILES.filter(({ file }) => isSealed(readRawLoose(dir, file))).map((f) => f.file);
  const gone = [...sealed, ...(keysOn(dir) ? [KEYS_FILE] : [])];
  if (gone.length === 0) {
    io.out(t.notEncrypted);
    return 0;
  }
  if ((await prompt(t.confirmReset(gone.join(", ")), { hidden: false })).trim() !== "AZZERA") {
    io.out(t.leftAsIs);
    return 0;
  }
  for (const file of gone) rmSync(path.join(dir, file), { force: true });
  forgetQuietly(dir, io);
  io.out(t.reset);
  return 0;
}

/** `azzera` is the way out of a damaged file, so it must not stop at one: damaged counts as encrypted. */
function readRawLoose(dir: string, file: string): unknown {
  const full = path.join(dir, file);
  if (!existsSync(full)) return undefined;
  try {
    return JSON.parse(stripBom(readFileSync(full, "utf8")));
  } catch {
    return { sealed: "" };
  }
}

export async function runKeys(dir: string, rest: string[], io: Io): Promise<number> {
  const [sub = "stato", ...extra] = rest;
  if (extra.length > 0) throw new UsageError(`Unexpected: ${extra.join(" ")}`);
  const t = keyTexts(dir, io);
  switch (sub) {
    case "stato":
    case "status":
      return status(dir, io, t);
    case "cifra":
    case "encrypt":
      return encrypt(dir, io, t);
    case "chiaro":
    case "decrypt":
      return clear(dir, io, t);
    case "ricorda":
    case "remember":
      return rememberAgain(dir, io, t);
    case "dimentica":
    case "forget":
      forgetQuietly(dir, io);
      io.out(t.forgotten);
      return 0;
    case "azzera":
    case "reset":
      return reset(dir, io, t);
    default:
      throw new UsageError(`Unknown: fairnight chiavi ${sub}. Use stato, cifra, chiaro, ricorda, dimentica or azzera.`);
  }
}

/** The commands that read the credentials, with a terminal to ask at the start. */
export function needsKeys(command: string, rest: string[], pianificato: boolean): boolean {
  if (pianificato) return false; // nobody is there: it opens them alone or stops
  const sub = rest[0];
  switch (command) {
    case "sync":
    case "serve":
    case "apri":
    case "open":
    case "configura":
    case "setup":
    case "risposte":
    case "hello":
    case "replies":
      return true;
    case "smoobu":
      return sub !== undefined && sub !== "collega" && sub !== "connect"; // saving needs only the public key
    case "beds24":
      return sub !== undefined;
    case "pilota":
    case "autopilot":
      return sub === undefined || ["giro", "run", "prova", "preview", "accendi", "on"].includes(sub);
    default:
      return false;
  }
}
