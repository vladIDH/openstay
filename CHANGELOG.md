# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [0.2.0] - in development, not released

### fairnight (engine)

- Zone demand factor (`factors.market`), off unless switched on for a listing:
  - each night of the zone is compared with the zone's own average;
  - half of the difference is passed on, at most +15% or -10% (`weight`, `highPercent`, `lowPercent`, `maxRaisePercent`, `maxLowerPercent`, `withinDays`, `minComparables`);
  - nights measured on fewer than 5 comparable listings are skipped.
- Zone data comes in `calendar.market`, already read: the engine never fetches it. The explanation names the source and its attribution, and says when the occupancy is an estimate.

### fairnight-market (new)

- The host's own zone CSV: date, occupancy, average price, comparables, with headers in English, Italian or Spanish.
- Inside Airbnb: only the files the host downloads (`calendar.csv(.gz)`, optional `listings.csv(.gz)` for comparables), read as a stream. Attribution "Inside Airbnb (insideairbnb.com), CC BY 4.0". The occupancy is marked as estimated, and listings closed on every night are left out.
- AirROI client with the host's own key:
  - only `GET /markets/search` and `POST /markets/metrics/all`, never price recommendations;
  - retries on 429 and 5xx;
  - the key never appears in an error.
- A fake AirROI server for tests, with invented data.

### fairnight-smoobu (new)

- Smoobu API client using only HMAC-SHA256 request signing: a fresh UUID v4 nonce for every request and UTC timestamps. The legacy key-only header is never sent; Smoobu stops accepting it on 31 October 2026.
- Our own limit of 300 requests per minute (Smoobu allows 700).
  - On 429: wait until `X-RateLimit-Retry-After` plus one second.
  - On 5xx without a message: retry after 1, 2, 4 and 8 seconds.
  - Validation errors (HTTP 500 with a `detail`) and other errors: stop and explain.
- Reads apartments, bookings (cancellations and blocked dates included) and rates. Writes price and minimum stay together.
- Single-night operations until Smoobu's handling of a range end is checked; ranges of at most 7 nights after that.

### fairnight-beds24 (new)

- Beds24 API v2 client:
  - an invite code becomes a refresh token;
  - short tokens are kept with their expiry and renewed when less than 2 minutes are left, or once at once after a 401 in the middle of a run;
  - every token lifetime is taken from `expiresIn`.
- Credits: never more than half of the 5-minute window. On 429, wait for the window to reset plus one second; 5xx are retried after 1, 2, 4 and 8 seconds; 400 stops with Beds24's message. Credits used are counted from `X-RequestCost`.
- Reads rooms (with their number of units), bookings and the calendar, expanding runs night by night.
- Writes only the chosen price field (`price1`…`price16`) and `minStay`, one element per night, in one request per room. Answers are checked element by element.
- Single nights until Beds24's handling of the range end is checked; ranges of at most 7 nights after that.

### fairnight-cli

- `fairnight beds24 collega`: asks for an invite code without echo and keeps the refresh token for the current user only. `BEDS24_REFRESH_TOKEN` takes precedence.
- `fairnight beds24 importa`: each single-unit Beds24 room becomes a listing (source `beds24`). Rooms with several identical units are skipped with a message.
- `fairnight beds24 spingi [--applica] [--da] [--a] [--alloggio ROOM]`: the table of differences. With `--applica` it writes, lists the nights Beds24 refused, and reads back.
- Every Beds24 command prints the credits used and the credits left.
- `fairnight sync` and Recalculate also read Beds24 bookings.
  - `black` bookings are blocked dates.
  - `cancelled` bookings are removed.
  - `bookingTime` drives the stale-calendar discount.
  - Stay prices are used by the historical floor only with `--usa-storico-beds24`.
- Database schema 3: `beds24_stays`, `beds24_pushes`.
- `fairnight mercato importa <file> --zona <name>`: zone data from the host's CSV or from Inside Airbnb files. Use `--annunci`, `--tipo`, `--camere` and `--quartiere` to keep comparables, and `--dry-run` to check first.
- `fairnight mercato importa --fonte airroi`, `fairnight mercato collega`: AirROI with the host's own key.
  - Off (`market.airroi.enabled: false`) until AirROI confirms its terms in writing.
  - When on: `AIRROI_API_KEY` first, then `airroi-credentials.json` (for the current user only); data deleted after 30 days.
- `fairnight mercato stato` and `fairnight mercato cancella [--zona] [--fonte]`.
- Listings choose their zone with `marketArea`.
- Database schema 4: `market_areas`, `market_days`.
- gitleaks rules `airroi-api-key-env` and `airroi-credentials-file`, proved in CI.
- Shared code of the connectors moved into `channel.ts`.
- `fairnight smoobu collega`: asks for the API key and secret without echo, checks them on Smoobu, and saves them for the current user only. `SMOOBU_API_KEY` and `SMOOBU_API_SECRET` take precedence.
- `fairnight smoobu importa`: new Smoobu apartments become listings (source `smoobu`), and bookings enter the local database.
- `fairnight smoobu spingi [--applica] [--da] [--a] [--alloggio]`: a table of differences; it writes only with `--applica`, then reads back from Smoobu.
- `fairnight sync` and the Recalculate button also read Smoobu bookings.
- The stale-calendar discount uses Smoobu's real booking day (`created-at`). iCal calendars keep the first-seen estimate.
- Smoobu stay prices are stored (total, nights, average per night). The historical floor uses them only with `--usa-storico-smoobu`, because they are an average per stay, not per night.
- Smoobu blocked dates are unavailable nights, never bookings: they do not count in occupancy or in the price history.
- Database schema 2: `booked_at`, `smoobu_stays`, `smoobu_pushes`. Older databases are upgraded on first use.

### fairnight-mcp

- New read-only tool `get_sync_status`: where each listing's data comes from (iCal, Smoobu or Beds24) and when it was last read.
- New read-only tool `get_market_area`: the zone data a listing uses, with its attribution.

### Repository

- `smoobu-credentials.json` is git-ignored.
- `beds24-credentials.json` is git-ignored.
- `airroi-credentials.json` is git-ignored.
- `.gitleaks.toml` adds rules for Smoobu and Beds24 credentials, and a CI job proves on every push that they catch a committed key or token.

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
