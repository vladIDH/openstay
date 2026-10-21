# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org). Every package in this repository carries the same version.

## Fairguest: tourist tax and payments - in development, not released

Off unless a listing has a `touristTax` block (the tax) and `"payments": { "enabled": true }` (the payments). No money passes through Fairnight or Khlumen.

### fairguest

- `tax/rules.ts`: rate per person per night, seasons, cap on nights, age and residents exemptions, reduced rates by age band (an amount or a percent of the night's rate), in cents. The class of a guest (pays, reduced:<ages>, exempt-age, exempt-resident, exempt-other).
- Points of the starting values to check with the town (`verify`): the words of the regulation and the source, shown until the host writes `"confirmed": true` or their own value. Napoli, Genova, Bari and Catania: the exempt age («entro il quattordicesimo anno»).
- `tax/places.ts`: starting values for 12 Italian towns, Barcelona and the rest of Catalonia, each with its official source and the day it was read (2026-10-15). Bologna has no single rate and is left empty. The Canary Islands have no tax.
- `tax/summary.ts`, `tax/pdf.ts`: the month or quarter summary for the town, as CSV and as PDF (a small PDF writer, no dependency).
- The «Carta» check-in: the payments card (links to Stripe's pages only) and the question «resident in …» where residents do not pay. Italian, Spanish, English.

### fairguest-relay

- `PUT/GET /api/box/<box>/pay`: the host's computer leaves the Stripe links and amounts; the page shows them. Only Stripe addresses and the expected fields are accepted.

### fairnight-cli

- `fairnight tassa tariffe|soggiorno|riepilogo|esenta|classifica|conferma`.
- `fairnight pagamenti [stato]|collega|prepara|rilascia|trattieni`: the host's own Stripe key (file or `STRIPE_SECRET_KEY`), payment links usable once, the deposit as a hold (manual capture). No key, no call.
- Page `/pagamenti` in `fairnight serve`, this computer only: release or keep a deposit, download the summary, «Ho verificato» for the points to check.
- Database schema 11: `guest_people.tax_class`, `guest_stays.tax_counts`, `guest_payments`.

## [0.2.0] - 2026-10-24

The first version published on npm and on GitHub Releases. It brings the connectors to Smoobu and Beds24, the autopilot, zone data, small hotels, the calendar page in three languages, the installer for hosts, and two new tools: **Fairguest** (guest registration for Spain and Italy) and **Fairhello** (draft replies to guests, approved by the host).

### Highlights

- **Smoobu connector** (#1): HMAC-signed API, import of apartments and bookings, prices and minimum stays written only after the host confirms.
- **Beds24 connector** (#2): invite code and refresh token, credits kept under half of the window, same confirm-then-write flow.
- **Zone data** (#3, #10): the host's own CSV, Inside Airbnb files the host downloads, ISTAC open data for the Canary Islands, AirROI with the host's own key (used with AirROI's agreement), and a suggested base price the host confirms by hand.
- **Fairguest** (#4, #9, #13, #14, #15): guest registration on the host's computer, encrypted with a passphrase only the host knows. Spain: the Mossos d'Esquadra file and the SES.HOSPEDAJES rules; Italy: Alloggiati Web and the regional Istat data. A check-in form on the host's network or through a link, with the document read in the guest's browser.
- **Installer for hosts** (#5, #16): a double-click file for Windows and Mac, a guided setup in Italian (`fairnight configura`) and a one-click calendar (`fairnight apri`), tried in CI on both systems.
- **Small hotels** (#6): room types with several identical rooms, occupancy by room-night, a few-rooms-left factor.
- **Calendar page in Italian, Spanish and English** (#7) and **a new look** for the calendar page and the check-in form (#8).
- **Autopilot** (#11): off by default, per listing; every day it reads, prices the next 90 nights, writes to Smoobu or Beds24 within limits and reads back.
- **Fairhello** (#12): draft replies to guests from the host's house file, with the host's own model key or a local model; nothing is sent without the host's approval.

### Upgrading from 0.1.0

- The database in `data/fairnight.db` is upgraded on first use, from schema 1 to schema 10. Keep a copy of the folder before the first run if you want to go back.
- A `fairnight.config.json` written by 0.1.0 still works: every new field is optional.
- Node.js 20 or newer for the npm packages; Node.js 22 or newer for the installer, which needs the precompiled SQLite module.

### Fairnight: pricing, connectors and the calendar page

#### Market data, second part (mercato2)

- fairnight: `suggestBasePrice`, a suggested base price from zone data (median of the monthly averages of the 12 most recent months, at least 6), with its explanation. Outside the nightly pricing: the expected prices do not change.
- fairnight-market: ISTAC holiday homes of the Canary Islands (ADR by municipality and size, open data), INE tourist apartments (occupancy by tourist point), Inside Airbnb filter by guests (`accommodates`).
- fairnight-cli: `fairnight mercato prezzo-base [--listing] [--applica]`; `mercato importa --fonte istac --comune <code> [--ospiti N]`; `mercato importa --fonte ine --punto <name>`, off (`market.ine.enabled`) while INE's licence is unclear; `--ospiti` on import; a listing field `guests`; which homes a zone describes is kept and shown by `mercato stato`.
- Calendar page: the suggested base price with "Use this price" after a confirmation, only on the computer that runs Fairnight.
- AirROI is on, used with AirROI's agreement (15 October 2026), and still optional: it needs the host's own key and a zone under `market.airroi.areas`, and `market.airroi.enabled: false` switches it off.
  - No 30-day limit any more: the first `fairnight sync` (also the autopilot's and the page's Recalculate) 30 days after the last read reads the AirROI zones again; on failure the old data stays and the sync says why.
  - "Powered by AirROI (https://www.airroi.com)" wherever AirROI data appears; on the calendar page it is a link to https://www.airroi.com.
  - AirROI zone data also feeds the suggested base price.

#### fairnight (engine)

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

#### fairnight-market (new)

- The host's own zone CSV: date, occupancy, average price, comparables, with headers in English, Italian or Spanish.
- Inside Airbnb: only the files the host downloads (`calendar.csv(.gz)`, optional `listings.csv(.gz)` for comparables), read as a stream. Attribution "Inside Airbnb (insideairbnb.com), CC BY 4.0". The occupancy is marked as estimated, and listings closed on every night are left out.
- AirROI client with the host's own key:
  - only `GET /markets/search` and `POST /markets/metrics/all`;
  - retries on 429 and 5xx;
  - the key never appears in an error.
- A fake AirROI server for tests, with invented data.

#### fairnight-smoobu (new)

- Smoobu API client using only HMAC-SHA256 request signing: a fresh UUID v4 nonce for every request and UTC timestamps. The legacy key-only header is never sent; Smoobu stops accepting it on 31 October 2026.
- Our own limit of 300 requests per minute (Smoobu allows 700).
  - On 429: wait until `X-RateLimit-Retry-After` plus one second.
  - On 5xx without a message: retry after 1, 2, 4 and 8 seconds.
  - Validation errors (HTTP 500 with a `detail`) and other errors: stop and explain.
- Reads apartments, bookings (cancellations and blocked dates included) and rates. Writes price and minimum stay together.
- Single-night operations until Smoobu's handling of a range end is checked; ranges of at most 7 nights after that.
- Room types made of several apartments (Smoobu has none of its own): `planTypePush` writes the same price to the apartments still free and skips nights whose free counts differ; `groupByApartments` gives one POST per set of apartments.

#### fairnight-beds24 (new)

- Beds24 API v2 client:
  - an invite code becomes a refresh token;
  - short tokens are kept with their expiry and renewed when less than 2 minutes are left, or once at once after a 401 in the middle of a run;
  - every token lifetime is taken from `expiresIn`.
- Credits: never more than half of the 5-minute window. On 429, wait for the window to reset plus one second; 5xx are retried after 1, 2, 4 and 8 seconds; 400 stops with Beds24's message. Credits used are counted from `X-RequestCost`.
- Reads rooms (with their number of units), bookings and the calendar, expanding runs night by night.
- Writes only the chosen price field (`price1`…`price16`) and `minStay`, one element per night, in one request per room. Answers are checked element by element.
- Single nights until Beds24's handling of the range end is checked; ranges of at most 7 nights after that.
- Rooms with several units: bookings carry their `unitId` (or `roomQty` rooms while unassigned, to check on a real account); the calendar gives `numAvail`; nights where it differs from Fairnight's free rooms are not written (`unitsMismatch`).

#### fairnight-cli

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
  - `AIRROI_API_KEY` first, then `airroi-credentials.json` (for the current user only); data read again every 30 days, deleted on request.
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
- Autopilot, off by default per listing (`pilot` in `fairnight.config.json`): `fairnight pilota giro | prova | stato | accendi | spegni | riprendi | registro | pianifica | togli`.
  - One run reads, prices the next 90 nights, writes to Smoobu or Beds24 where it is on, reads back.
  - Limits: at most 15% a day from the price on the channel, never outside the lowest and highest price (needed), nothing written when a calendar could not be read, pause after 3 failed runs or more than 5 nights not matching.
  - The daily run: a Task Scheduler task on Windows, a LaunchAgent on a Mac, at the chosen time and at sign-in; the open calendar page does the run if it was missed.
  - Log of every night written with its reason (`pilot_runs`, `pilot_changes`, `pilot_state`, new tables only), kept 400 days.
  - The calendar page shows the last run and why each night changed, and switches the autopilot on (after a preview) from this computer only. `fairnight configura` asks about it for houses on Smoobu or Beds24.
- The write step of `smoobu spingi` and `beds24 spingi` moved into `channel.ts` (push targets), shared with the autopilot.

#### fairnight-mcp

- New read-only tool `get_sync_status`: where each listing's data comes from (iCal, Smoobu or Beds24) and when it was last read.
- New read-only tool `get_market_area`: the zone data a listing uses, with its attribution.
- Room types of small hotels: `get_prices`, `explain_night`, `occupancy` (room-nights) and `next_gaps` show the units and the rooms free. `occupancy` and `next_gaps` use the engine's availability.

#### Repository

- `smoobu-credentials.json` is git-ignored.
- `beds24-credentials.json` is git-ignored.
- `airroi-credentials.json` is git-ignored.
- `.gitleaks.toml` adds rules for Smoobu and Beds24 credentials, and a CI job proves on every push that they catch a committed key or token.

### Fairhello: replies to guests

Draft replies to guests, approved by the host before anything is sent. Everything runs on the host's computer.

#### fairhello (new)

- The house file `casa/<listing>.md`: free `##` sections. The access codes section is kept apart. Amounts of money are reported.
- The request to the model:
  - the rules and the house file in a cacheable system part;
  - the stay, the conversation inside tags (text to answer, never instructions) and, only from check-in to check-out and after the guest registration, the access codes.
- No prices: the model never sees one, and a draft with one is flagged.
- Freshness: newest draft of the conversation, answers the guest's last message, booking not cancelled, stay ended at most 2 days ago.
- Sensitive topics (money, complaint, cancellation, emergency) in six languages.
- Request and answer shapes for Anthropic (`claude-haiku-5-5`, JSON schema, low effort) and Ollama. Errors say whether to stop the whole reading.

#### fairnight-smoobu, fairnight-beds24

- Smoobu: conversations (`/api/threads`), messages of a booking, `send-message-to-guest`, the guest's language and the channel.
- Beds24: `/bookings/messages` for up to 50 bookings per request, without internal notes, and the reply. Needs the bookings-personal scope.

#### fairnight-cli

- `fairnight risposte` (`hello`): `collega`, `casa`, `leggi`, `mostra`, `invia` (sends only with `--applica`), `scarta`, `stato`.
- Page `/risposte` in `fairnight serve`:
  - this computer only, with signed forms and no JavaScript;
  - the "Notte" look, in Italian, Spanish and English;
  - Fairnight's price of the free nights nearby, shown to the host only.
- Before sending: the conversation is read again, freshness is checked, a draft with a price is blocked until the host edits it, and it is claimed once.
- Database schema 7: `hello_stays`, `hello_messages`, `hello_drafts`, `hello_runs`. Messages are erased 60 days after check-out.
- Secret scan: the Anthropic key file and `ANTHROPIC_API_KEY`.

#### fairnight-mcp

- `get_guest_replies`: the drafts waiting for the host, read only, texts only when asked.

### Fairguest: guest registration

Guest registration for Spain (Real Decreto 933/2021) and Italy (Alloggiati Web, Istat). Everything runs on the host's computer; the optional check-in link goes through a relay that only carries sealed data.

#### Italy, Alloggiati Web

- fairguest: country `IT` with `alloggiatiRegistry`, the Italian rules (document only for the holder, male or female, places of birth and of issue), deadlines of 24 hours from arrival and 6 for stays of 24 hours or less, erasure as soon as Alloggiati Web accepted the schedine.
- fairguest: `schedine` (lines of 168 characters, single guest, family or group), `alloggiatiFile` for the portal, `parseAlloggiatiTables`, `stateCode`, `municipalityCode`; `AlloggiatiClient` for the SOAP 1.2 service through a transport (token, Test, Send, Gestione Appartamenti, Ricevuta, Tabella).
- fairguest: `Place` for the places of birth and of issue; document types `id_card`, `electronic_id`, `driving_licence`; each registry says which document types its form offers and checks one guest for the form (`checkGuest`).
- fairnight-cli: `fairnight ospiti tabelle`, `credenziali` (sealed, `--verifica`), `riconosciuto`, `invia` (`--prova`, `--applica`; without a terminal only with `"autoSend": true`), `ricevute` (kept 5 years); `prepara` writes the file for the portal; `correggi` reaches three-level fields.
- fairnight-cli: the check-in form asks the Italian questions for a listing in Italy, and no address, contact or payment.
- fairnight-cli: database schema 8 (`guest_stays.recognized_at`, `guest_receipts`).
- fairnight-cli: the calendar page shows how many guest communications are late or due within 24 hours.
- docs: guide for the host in Italian and Spanish (docs/fairguest-italia.md, docs/fairguest-italia.es.md).

#### Spain: the same link and photo for SES.HOSPEDAJES and the Mossos

- fairguest: `formValuesFromMrz` fills the form of the listing's country from the MRZ (Spanish DNI with its support number; a document the form does not offer becomes the closest one it does).
- Tested from the link to the Mossos file; guide for Spanish hosts in Spanish and Italian (docs/fairguest-espana.es.md, docs/fairguest-spagna.md).
- fairguest: the town of residence in Spain is picked by its name from the INE's official list of municipalities (1 January 2026, 8,132 towns), and the form keeps its INE code: the traveller's part is complete without the host's corrections. 6 digits are kept for the Mossos file, the first 5 go to SES. `correggi` takes 5 or 6 digits and refuses a code that does not exist.

#### Istat, the regional tourist movement

- fairguest: `ISTAT_REGIONS`, the official map of 21 territories (13 with the ROSS1000 web service, Trento and Umbria by file, Puglia with the Alloggiati file, the rest by hand); `istatStay` (the statistical record, no name and no document); `rossFile` and `Ross1000Client` (SOAP inviaMovimentazione, HTTP Basic, result per day); `trentoCsv`, `umbriaDay` (C/59), `monthSummary`.
- fairguest: the Italian form asks the residence when the listing sends Istat data; `beds` and `istat` in the listing settings (rooms and beds required with ROSS1000).
- fairnight-cli: `fairnight ospiti istat [--mese] [--applica]`, `credenziali --istat`; the record is kept sealed when Alloggiati Web erases the guests and erased once the region has the month (an erasure on request takes it too); reminders of the previous month; `fairnight configura` asks rooms and beds only with ROSS1000; schema 10.

#### The check-in link from anywhere, and the photo of the document

- fairguest: the «Carta» form and its words move into the library (`renderForm`, `WORDS`), so the host's form and the link's page are the same code; `fairguest/browser` entry with only what a browser needs.
- fairguest: `webSeal` seals in the browser with Web Crypto in the same fg1 format (optional X25519 fallback); `padded` gives every guest the same size; `linkFor` / `readLinkFragment` for the link, whose key and stay stay after "#".
- fairguest: `parseMrz` (TD1, TD2, TD3, ICAO check digits, OCR repairs confirmed by the check digits) and `guestFromMrz` (Spanish DNI: DNI number and support number apart).
- fairguest-relay (new, private): Cloudflare Worker with one Durable Object per box in the EU jurisdiction; only sealed text, hashed secrets, limits, expiry two days after check-out, no logs; the guest's page with the photo read in the browser (Tesseract and the MRZ model served by the relay); hashes of the page for `verifica-pagina`; `scripts/dev.mjs` to try it locally.
- fairnight-cli: `fairnight ospiti link`, `scarica` (no passphrase: the guests stay sealed) and `verifica-pagina`; downloads also before `elenco` and `invia` and every 5 minutes while `serve` runs; `"fairguestRelay"` in the config (default https://fairguest-relay.openstay.workers.dev, the free workers.dev address: no DNS to move); schema 9.
- fairguest-relay: on workers.dev, files served at their own name (`html_handling = "none"`: a redirect made the phone lose the box); `verifica-pagina` reports a redirect instead of following it. The confirmation screen has one privacy text, with who receives the data and when it is erased.

#### fairguest (new)

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

#### fairnight-cli

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

#### fairnight-smoobu, fairnight-beds24

- Bookings also carry the holder's name, the number of guests (adults plus children) and the channel reference, for guest registration only. Pricing never reads them; they are sealed by Fairguest and never stored in `calendar_events` or printed.

#### fairnight-mcp

- New read-only tool `get_guest_deadlines`: the communications due per stay, dates and states only.

### Installer and release

- `Installa Fairnight (Windows).cmd` and `Installa Fairnight (Mac).command`: check Node.js and say what to do when it is missing or too old, install into `~/Fairnight/programma` from the project folder or from npm, put an icon on the desktop, and update in place without touching the host's settings.
- `fairnight configura`: a guided setup in Italian (name, town, calendar links, prices, seasons proposed from the town, language, autopilot for houses on Smoobu or Beds24); `fairnight apri` starts the calendar page and opens the browser, or finds the one already running.
- A guide for hosts in Italian with screenshots: `docs/installa.md`.
- CI tries the installer on Windows and macOS with Node.js 22 and 24, from a folder with a space in its name, with fake calendars.
- Release workflow on `v*` tags: tests on Node.js 20 and 22, the installer on Windows and Mac, a draft GitHub Release with the npm tarballs, `Fairnight-installa.zip` and checksums; npm publishing waits for a manual approval and only then the release becomes public. The steps are in `scripts/release.mjs`.
- `CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates.
- The double-click files are named `Installa Fairnight (Windows).cmd` and `Installa Fairnight (Mac).command`, so the two are told apart with extensions hidden.
- Opened from inside the zip, the installer says to extract the folder first instead of closing at once. Every failure, expected or not, ends with a message in Italian, the most likely reason (no internet, a file in use, a full disk, a package not on npm yet), the address to write to and the folder of the log; npm's own output stays in the log. An unknown option stops the script.
- The installer says it needs internet, shows its steps (1 of 3…) and that the window looks still while it downloads, says "updated from A to B" or "reinstalled", and asks to reopen Fairnight if it was open. npm's temporary files go to the system temp folder.
- The Windows launchers also find Node.js in `%LOCALAPPDATA%\Programs\nodejs`, where the installer finds it.
- `fairnight configura` leaves a short guide for the host in the folder, `LEGGIMI.txt` in Italian or `LEEME.txt` for a Spanish calendar, instead of the English `README.txt` (removed if the host never changed it). The zip carries the same steps in `LEGGIMI.txt` and `LEEME.txt`.
- `fairnight configura` proposes the computer's language first (an Italian host with a house in Spain gets Italian), then the town's, and says why; the calendar check and the first reading use the same words (bookings and blocked periods).
- `fairnight configura` and `fairnight apri` speak Spanish when the calendar is in Spanish, or the first time on a Spanish computer; the proposed seasons are named in Spanish too.
- The calendar page arrives in the folder's language (tab title, `lang` and the first texts), before its script runs.
- The installer says "2-4 minutes" only on the first installation, and its Node.js messages name the button to click on nodejs.org ("Windows Installer (.msi)", "macOS Installer (.pkg)", x64 instead of ARM64), checked on 15 October 2026.


## [0.1.0] - 2026-10-12, not published on npm

The first version, kept in the repository only: `fairnight`, `fairnight-cli` and `fairnight-mcp`.

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
