# Security

## Reporting a problem

Please do not open a public issue for a security problem. Write to:

**hello@khlumen.com**

Include what you found, how to reproduce it and which version you used. You will get an answer within a week. Please give us a reasonable time to fix the problem before you talk about it publicly.

## What Fairnight protects

Fairnight runs on the host's own computer. The things worth protecting are:

- **iCal links.** Anyone who has one can read that calendar. They live only in `fairnight.config.json`. They are never logged, never shown by the MCP server and never sent anywhere except to the channel that issued them.
- **The local database** (`data/fairnight.db`). It holds dates and prices, never guest names or contact details.
- **The calendar page** (`fairnight serve`). It listens on `127.0.0.1` unless `--lan` is given. It sends a strict Content-Security-Policy and loads nothing from outside. The only action that changes anything (Recalculate) needs a custom header, so other websites cannot trigger it.
- **The MCP server.** Every tool is read-only, and the database is opened in SQLite read-only mode.

Interesting reports include:
- a way to make Fairnight send data anywhere other than the configured iCal links;
- a way to make the MCP server or the calendar page write data;
- a way to read the host's files from the calendar page.

## Supported versions

Only the latest released version receives security fixes.
