/**
 * Where the computer keeps the passphrase of the credentials, so the daily run
 * can open them with nobody at the keyboard. No native module: only what the
 * system already has, and the passphrase never travels as a command argument.
 *
 * - Windows: DPAPI through powershell.exe. The sealed passphrase is a file in
 *   %LOCALAPPDATA%\Fairnight, outside the Fairnight folder, that only this
 *   Windows user can open while signed in.
 * - Mac: the login keychain through /usr/bin/security, commands on stdin.
 * - Elsewhere: nothing here. A server gives FAIRNIGHT_FRASE_CHIAVI (see chiavi.ts).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writePrivateFile } from "./private-file.js";
import { stripBom, type Io } from "./io.js";

export interface Keychain {
  /** The saved passphrase, null when there is none. Throws KeychainError when the system does not answer. */
  read(): string | null;
  save(passphrase: string): void;
  remove(): void;
}

/** Deliberately says nothing of what the system answered. */
export class KeychainError extends Error {}

type Run = NonNullable<Io["run"]>;

/** One entry per Fairnight folder, so two folders on one computer do not clash. */
const entryId = (dir: string) => createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 8);

const DPAPI = (call: string) =>
  `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;` +
  `$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim());` +
  `$r=[Security.Cryptography.ProtectedData]::${call}($b,$null,'CurrentUser');` +
  `[Console]::Out.Write([Convert]::ToBase64String($r))`;

export function windowsKeychain(file: string, powershell: string, run: Run): Keychain {
  const dpapi = (call: "Protect" | "Unprotect", input: string): string => {
    const r = run(powershell, ["-NoProfile", "-NonInteractive", "-Command", DPAPI(call)], input);
    if (r.status !== 0 || r.stdout.trim() === "") throw new KeychainError();
    return r.stdout.trim();
  };
  return {
    read() {
      if (!existsSync(file)) return null;
      let parsed: { dpapi?: unknown };
      try {
        parsed = JSON.parse(stripBom(readFileSync(file, "utf8")));
      } catch {
        return null;
      }
      if (typeof parsed.dpapi !== "string") return null;
      return Buffer.from(dpapi("Unprotect", parsed.dpapi), "base64").toString("utf8");
    },
    save(passphrase) {
      const sealed = dpapi("Protect", Buffer.from(passphrase, "utf8").toString("base64"));
      mkdirSync(path.dirname(file), { recursive: true });
      writePrivateFile(file, { dpapi: sealed }, "win32");
    },
    remove() {
      rmSync(file, { force: true });
    },
  };
}

const SECURITY = "/usr/bin/security";
const SERVICE = "Fairnight chiavi";
/** What `security` answers when the entry is not there. */
const NOT_FOUND = 44;

export function macKeychain(account: string, run: Run): Keychain {
  const read = (): string | null => {
    const r = run(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    if (r.status === NOT_FOUND) return null;
    if (r.status !== 0) throw new KeychainError();
    return Buffer.from(r.stdout.trim(), "base64url").toString("utf8");
  };
  return {
    read,
    save(passphrase) {
      // Letters, digits, - and _ only: `security` would show anything else as hex, and no quoting can go wrong.
      const value = Buffer.from(passphrase, "utf8").toString("base64url");
      run(SECURITY, ["-i"], `add-generic-password -U -s "${SERVICE}" -a ${account} -T ${SECURITY} -w ${value}\n`);
      // `security -i` does not report a failed command in its exit code.
      if (read() !== passphrase) throw new KeychainError();
    },
    remove() {
      run(SECURITY, ["delete-generic-password", "-s", SERVICE, "-a", account]);
    },
  };
}

/** The keychain of this computer, or null when it has none Fairnight can use. */
export function keychainOf(dir: string, io: Io): Keychain | null {
  if (io.keychain !== undefined) return io.keychain;
  if (!io.system || !io.run) return null;
  const id = entryId(dir);
  if (io.system.platform === "win32") {
    const local = io.env?.LOCALAPPDATA ?? path.win32.join(io.system.home, "AppData", "Local");
    const root = io.env?.SystemRoot ?? "C:\\Windows";
    return windowsKeychain(path.win32.join(local, "Fairnight", `chiavi-${id}.json`), path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), io.run);
  }
  return io.system.platform === "darwin" ? macKeychain(id, io.run) : null;
}
