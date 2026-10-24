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
- **Credentials** for Smoobu, Beds24, the model provider and the authority services. They are asked without echo (never as command arguments, so never in the shell history), saved in files readable by the current user only, never logged and never printed in errors. Environment variables take precedence. Credentials of the authority services are sealed like guest data.
- **Guest data (Fairguest).** Each value is sealed (X25519, HKDF-SHA256, AES-256-GCM, bound to its row and column) before it reaches the database; the private key is locked with scrypt from a passphrase only the host knows. Only random ids, dates and states are stored in clear. Data is erased with SQLite `secure_delete` as soon as the law allows.
- **The local database** (`data/fairnight.db`). Pricing never stores guest names, contacts or messages. Fairhello keeps guest messages there and erases them 60 days after check-out.
- **The local pages** (`fairnight serve`). They listen on `127.0.0.1` unless `--lan` is given, send a strict Content-Security-Policy and load nothing from other sites. Actions that change data need a custom header or a signed form token, so other websites cannot trigger them; settings, the autopilot and replies are refused from other devices. The check-in form needs a random per-stay code, refuses proxies and tunnels and slows down after wrong codes.
- **The check-in relay** (`fairguest-relay`, optional). It only ever receives data sealed in the guest's browser with the host's public key, which stays after `#` in the link and never reaches it. `fairnight ospiti verifica-pagina` checks that the page it serves is the one built from this repository.
- **The MCP server.** Every tool is read-only, and the database is opened in SQLite read-only mode. It talks over stdio only: the advisories GHSA-jm63-cq47-j5jp, GHSA-46jr-4wx8-v453 and GHSA-rvq5-wwqv-78pq on `@modelcontextprotocol/server` 2.2.0 concern its HTTP transport and do not affect `fairnight-mcp`.
- **Models (Fairhello).** Guest messages are treated as text to answer, never as instructions; the model never sees a price or, outside the stay, an access code.

Interesting reports include:
- a way to make OpenStay send data anywhere other than the services the host configured;
- a way to read guest data without the passphrase, or to make the relay learn anything it should not;
- a way to make the MCP server or a local page write data, or to read the host's files through them;
- a way to make Fairhello send a reply, or a price or access code, the host did not approve.
