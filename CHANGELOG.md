# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## Fairguest [0.1.0] - in development, not released

Guest registration for Spain (Real Decreto 933/2021). Everything runs on the host's computer; no server of ours in between.

### fairguest (new)

- One interface for every country (`Registry`: validate, deadlines, prepare, send, status, cancel, retention) over neutral `Guest` and `Stay` types. The network stays outside: send and status take a transport.
- The rules of RD 933/2021, every problem at once with its field path:
  - identity document from 18 years old for SES and from 14 for the Mossos;
  - support number for DNI and NIE, second surname with a DNI, INE code for addresses in Spain;
  - kinship for minors, a contact for each guest, the payment type.
- DNI and NIE check letters.
- 24-hour deadlines from the booking and from check-in. An unknown hour counts from midnight, so the deadline shown is never later than the real one.
- Retention: 3 years from check-out for professional hosts; for the others, erasure once the check-in communication is confirmed, or 48 hours after a cancellation.
- Encryption with `node:crypto` only:
  - X25519 sealing per value with HKDF-SHA256 and AES-256-GCM, bound to the row and column it is stored in;
  - private key locked with scrypt (N = 2¹⁷) from the host's passphrase;
  - passphrase change re-encrypts only the key.
- Mossos d'Esquadra file, from the public manual v8 (May 2025): record 1 with `V24`, record 2 with 32 fields, capitals, CR LF, ISO-8859-1, name `<ID>.001`…`.999`, one establishment per file.
- SES.HOSPEDAJES: validation, deadlines and retention. `prepare` is an explicit stub that fails with `SES_NOT_READY` until the Ministry's XSD schemas are available.
- Card numbers and IBANs have no place anywhere; unknown input fields are ignored.

### fairnight-cli

- `fairnight ospiti` with these subcommands: `attiva`, `frase`, `elenco`, `nuovo`, `mostra`, `correggi`, `prepara`, `inviato`, `esporta`, `cancella`, `pulisci`, and the deadlines by default (exit code 1 when something is late, `--json`).
- A `fairguest` block per listing in `fairnight.config.json`: country, establishment, name, professional, check-in and check-out times, rooms, internet.
- Database schema 5 (after the zone data of schema 4): `guest_stays`, `guest_people`, `guest_submissions`. Migrations now run as explicit ordered steps, and a test takes a schema 3 database to the latest version. Only random ids, dates and states are in clear.
- `fairnight sync` creates a stay to register for every booking that ends today or later, marks vanished bookings as cancelled, and applies retention.
- Check-in form at `/checkin/<code>` in `fairnight serve`:
  - local network only, refused through proxies and tunnels;
  - random 96-bit code valid until check-out, slowed down after 20 wrong codes;
  - signed form token;
  - no JavaScript, strict CSP;
  - Spanish, English and Italian;
  - guests sealed on arrival without the passphrase.
- The passphrase comes from a hidden prompt or `FAIRGUEST_FRASE`. Corrections are asked, never passed as arguments, so they never end up in the shell history.
- Erasure deletes the guests, the sealed details, the form code and the generated files, with SQLite `secure_delete`.

### fairnight-smoobu, fairnight-beds24

- Bookings also carry the holder's name, the number of guests (adults plus children) and the channel reference, for guest registration only. Pricing never reads them; they are sealed by Fairguest and never stored in `calendar_events` or printed.

### fairnight-mcp

- New read-only tool `get_guest_deadlines`: the communications due per stay, dates and states only.

## [0.2.0] - in development, not released

### fairnight (engine)

- Small hotels: a listing can be a room type with `units` identical rooms sold at one price (default 1, up to 99). See docs/piccoli-hotel.md.
  - Each night counts the rooms reserved, blocked and free. Stays of the same room (`unit`) are merged; a stay without one takes `units` rooms (default 1); overbookings are reported, never below 0 free.
  - A night is for sale while one room is free. Occupancy counts room-nights. Gaps are free stretches between two sold-out nights.
  - New factor `scarcity` (few rooms left), off by default: steps by share of rooms taken, capped by `maxRaisePercent` (default 20). Only with more than one unit.
  - `NightQuote.units` and the explanation ("3 of 6 rooms free", "Weighed most: …") only for room types: with one unit every output is the same as before.
  - `Availability` is exported, so other tools count nights with the engine's own rule.
- Every price step also carries its facts as data (`params`: season name, days ahead, gap nights, month occupancy, rooms free, floor and ceiling…), so a page can say them in another language. Labels, notes and explanations are unchanged.
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
- Room types made of several apartments (Smoobu has none of its own): `planTypePush` writes the same price to the apartments still free and skips nights whose free counts differ; `groupByApartments` gives one POST per set of apartments.

### fairnight-beds24 (new)

- Beds24 API v2 client:
  - an invite code becomes a refresh token;
  - short tokens are kept with their expiry and renewed when less than 2 minutes are left, or once at once after a 401 in the middle of a run;
  - every token lifetime is taken from `expiresIn`.
- Credits: never more than half of the 5-minute window. On 429, wait for the window to reset plus one second; 5xx are retried after 1, 2, 4 and 8 seconds; 400 stops with Beds24's message. Credits used are counted from `X-RequestCost`.
- Reads rooms (with their number of units), bookings and the calendar, expanding runs night by night.
- Writes only the chosen price field (`price1`…`price16`) and `minStay`, one element per night, in one request per room. Answers are checked element by element.
- Single nights until Beds24's handling of the range end is checked; ranges of at most 7 nights after that.
- Rooms with several units: bookings carry their `unitId` (or `roomQty` rooms while unassigned, to check on a real account); the calendar gives `numAvail`; nights where it differs from Fairnight's free rooms are not written (`unitsMismatch`).

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
- A new look for the calendar page: a summary of the month (nights for sale, booked, average price, occupancy), bigger prices, nights tinted above or below the base price, today and weekends marked, the night's steps as a small ladder of bars. Light or dark with the system, readable on a phone, the night panel opening from the bottom.
- The guests' check-in form, made for a phone: three steps on screen (details, document, confirmation), a line on what happens to the data, a message for each kind of field next to it, light or dark with the phone. Same fields, same checks, same data saved.
- The calendar page in Italian, Spanish and English: `language` in `fairnight.config.json` (English when missing), a small IT · ES · EN menu saved in the browser, dates, weekdays and prices formatted with `Intl`, the price rules said from the engine's `params`, the engine's English text folded at the bottom of the night panel. `fairnight configura` asks the language once, proposing it from the town (Italy → it, Spain and the Canary Islands → es) or from the computer's language.
- Small hotels: `beds24 importa` imports rooms with `qty` > 1 as a room type (`units`) and warns when `qty` changes; a listing with `units` can list up to that many Smoobu apartments; an iCal calendar of a room type names its room (`unit`), and calendars of a whole room type are refused. `fairnight price` and the calendar page show the rooms free. Database schema 6: `unit` and `units` of each stored stay.

### fairnight-mcp

- New read-only tool `get_sync_status`: where each listing's data comes from (iCal, Smoobu or Beds24) and when it was last read.
- New read-only tool `get_market_area`: the zone data a listing uses, with its attribution.
- Room types of small hotels: `get_prices`, `explain_night`, `occupancy` (room-nights) and `next_gaps` show the units and the rooms free. `occupancy` and `next_gaps` use the engine's availability.

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
