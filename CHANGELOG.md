# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [0.2.0] - in development, not released

### fairnight-smoobu (new)

- Smoobu API client using only HMAC-SHA256 request signing: a fresh UUID v4 nonce for every request and UTC timestamps. The legacy key-only header is never sent; Smoobu stops accepting it on 31 October 2026.
- Our own limit of 300 requests per minute (Smoobu allows 700).
  - On 429: wait until `X-RateLimit-Retry-After` plus one second.
  - On 5xx without a message: retry after 1, 2, 4 and 8 seconds.
  - Validation errors (HTTP 500 with a `detail`) and other errors: stop and explain.
- Reads apartments, bookings (cancellations and blocked dates included) and rates. Writes price and minimum stay together.
- Single-night operations until Smoobu's handling of a range end is checked; ranges of at most 7 nights after that.

### fairnight-cli

- `fairnight smoobu collega`: asks for the API key and secret without echo, checks them on Smoobu, and saves them for the current user only. `SMOOBU_API_KEY` and `SMOOBU_API_SECRET` take precedence.
- `fairnight smoobu importa`: new Smoobu apartments become listings (source `smoobu`), and bookings enter the local database.
- `fairnight smoobu spingi [--applica] [--da] [--a] [--alloggio]`: a table of differences; it writes only with `--applica`, then reads back from Smoobu.
- `fairnight sync` and the Recalculate button also read Smoobu bookings.
- The stale-calendar discount uses Smoobu's real booking day (`created-at`). iCal calendars keep the first-seen estimate.
- Smoobu stay prices are stored (total, nights, average per night). The historical floor uses them only with `--usa-storico-smoobu`, because they are an average per stay, not per night.
- Smoobu blocked dates are unavailable nights, never bookings: they do not count in occupancy or in the price history.
- Database schema 2: `booked_at`, `smoobu_stays`, `smoobu_pushes`. Older databases are upgraded on first use.

### fairnight-mcp

- New read-only tool `get_sync_status`: where each listing's data comes from (iCal or Smoobu) and when it was last read.

### Repository

- `smoobu-credentials.json` is git-ignored.
- `.gitleaks.toml` adds two rules for Smoobu credentials, and a CI job proves on every push that they catch a committed key.

## [0.1.0] - not released yet

First public version, published as three npm packages: `fairnight`, `fairnight-cli` and `fairnight-mcp`.

### fairnight (engine)

- Price and minimum stay for every night, with a step-by-step explanation. Deterministic, with no network, files or clock.
- Factors, each one can be switched on and off:
  - base price;
  - seasons (multiplier or fixed price);
  - day of week;
  - last-minute discount steps;
  - far-out premium steps;
  - gaps between stays;
  - monthly occupancy;
  - stale-calendar discount;
  - host events (CSV);
  - historical floor;
  - floor and ceiling;
  - rounding;
  - date overrides.
- Last-minute and gap discounts never stack: the larger one applies.
- Minimum stay precedence: date override → far out → last minute → default. The gap rule applies only when it lowers the minimum.
- Validation of the listing and the calendar that reports every problem at once, with the path of the field.

### fairnight-cli

- `fairnight init`, `sync`, `import`, `price`, `export` and `serve`.
- iCal reading for Airbnb, Booking.com, Vrbo and other calendars, stored in a local SQLite file. No duplicates; vanished stays are marked removed, not deleted.
- Import of past prices from CSV (comma, semicolon, tab or pipe; ISO or European dates).
- Local calendar page: month by month, explanation on click, Recalculate button, works on phones (`--lan`).
- CSV export (date, price, minimum stay). No Smoobu format, because Smoobu does not publish a CSV import format.

### fairnight-mcp

- Read-only MCP server over stdio with five tools: `list_listings`, `get_prices`, `explain_night`, `occupancy` and `next_gaps`.
