# Security

## Reporting a problem

Please do not open a public issue for a security problem. Either:

- use **Report a vulnerability** in the Security tab of this repository (private to the maintainers), or
- write to **hello@khlumen.com**.

Include what you found, how to reproduce it and which version you used. You will get an answer within a week. Please give us a reasonable time to fix the problem before you talk about it publicly.

## Supported versions

Only the latest released version receives security fixes.

| Version | Supported |
|---|---|
| 0.2.x | yes |
| older | no |

## What OpenStay protects

Everything runs on the host's own computer. The things worth protecting are:

- **Calendar links.** Anyone who has an iCal link can read that calendar. They live only in `fairnight.config.json`, are never logged, never shown by the MCP server and never sent anywhere except to the channel that issued them.
- **Credentials** for Smoobu, Beds24, the model provider and the authority services. They are asked without echo (never as command arguments, so never in the shell history), saved in files readable by the current user only, never logged and never printed in errors. Environment variables take precedence. Credentials of the authority services are sealed like guest data. Smoobu and Beds24 credentials can be encrypted too: see below. AirROI, Fairhello and Stripe keys are protected by file permissions only.
- **Guest data (Fairguest).** Each value is sealed (X25519, HKDF-SHA256, AES-256-GCM, bound to its row and column) before it reaches the database; the private key is locked with scrypt from a passphrase only the host knows. Only random ids, dates and states are stored in clear. Data is erased with SQLite `secure_delete` as soon as the law allows.
- **The local database** (`data/fairnight.db`). Pricing never stores guest names, contacts or messages. Fairhello keeps guest messages there and erases them 60 days after check-out.
- **The local pages** (`fairnight serve`). They listen on `127.0.0.1` unless `--lan` is given, send a strict Content-Security-Policy and load nothing from other sites. Actions that change data need a custom header or a signed form token, so other websites cannot trigger them; settings, the autopilot and replies are refused from other devices. The check-in form needs a random per-stay code, refuses proxies and tunnels and slows down after wrong codes.
- **The check-in relay** (`fairguest-relay`, optional). It only ever receives data sealed in the guest's browser with the host's public key, which stays after `#` in the link and never reaches it. `fairnight ospiti verifica-pagina` checks that the page it serves is the one built from this repository.
- **The MCP server.** Every tool is read-only, and the database is opened in SQLite read-only mode.
- **Models (Fairhello).** Guest messages are treated as text to answer, never as instructions; the model never sees a price or, outside the stay, an access code.

## Encrypted Smoobu and Beds24 keys (optional)

By default the Smoobu and Beds24 credentials are JSON in clear, protected by file permissions. `fairnight chiavi cifra` encrypts them with a passphrase of their own, separate from the Fairguest one, so the autopilot never holds the key to guest data. It uses the same code as guest data (X25519, HKDF-SHA256, AES-256-GCM, scrypt): no new cryptography and no new dependency. `fairnight chiavi chiaro` goes back. Folders that never turn it on work exactly as before.

The autopilot runs with nobody at the keyboard, so the passphrase has to come from somewhere. In this order:

1. **The computer's keychain** (`fairnight chiavi ricorda`). On Windows, DPAPI through `powershell.exe`, in a file under `%LOCALAPPDATA%\Fairnight`, outside the Fairnight folder. On a Mac, the login keychain through `/usr/bin/security`. The passphrase reaches them on stdin, never as a command argument. **The Mac path has not been tried on a real Mac yet.**
2. **The variable `FAIRNIGHT_FRASE_CHIAVI`**, a fallback for servers. Its limit: it protects only as well as the place it comes from. Use it with a secret store that keeps the passphrase off that disk. Saved in a Windows user variable, a plist, a crontab or an `.env` file next to the folder, it sits in clear on the same disk: anyone reading that disk or its backup gets both the lock and the key, and the encryption is worth little.
3. **The terminal**, asked once without echo. A scheduled run never asks.

If none of them opens the keys, a run stops, says why in the host's language and sends no price. It does not pause the listing, and it can run again the same day once the keys open.

**What this protects:** a backup of the Fairnight folder, and a copy of the disk or a stolen computer, as long as the sign-in password of the computer is strong (the keychain is locked by it).

**What this does NOT protect:**

- **A malicious program running as the host's user.** It can ask the keychain exactly as Fairnight does, or read the keys from memory during a run. Only keeping the computer clean helps, and only a restricted key in Smoobu or Beds24 limits the damage.
- **Someone at the computer while the host is signed in.**
- **Old backups** made before `fairnight chiavi cifra`: they still hold the keys in clear. If that matters, create new keys and connect again. Encrypting replaces the file but does not wipe the disk blocks it used.
- **A weak passphrase, or a weak sign-in password.** Whoever has the file can try guesses offline.
- **The keys while they are used.** Smoobu and Beds24 receive them on every request, as always.

If the passphrase is lost there is no way back: `fairnight chiavi azzera` deletes the encrypted keys, and the host connects again with `collega`. If only the keychain is lost (a password reset by an administrator, a restore on another computer), `fairnight chiavi ricorda` writes the passphrase again.

## Reports

Interesting reports include:
- a way to make OpenStay send data anywhere other than the services the host configured;
- a way to read guest data without the passphrase, or to make the relay learn anything it should not;
- a way to read encrypted Smoobu or Beds24 keys from a backup or a disk copy, or to make them appear in clear in a file, a log or an error;
- a way to make the MCP server or a local page write data, or to read the host's files through them;
- a way to make Fairhello send a reply, or a price or access code, the host did not approve.
