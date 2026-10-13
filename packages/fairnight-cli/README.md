# fairnight-cli

The `fairnight` command:
- reads your Airbnb, Booking and Vrbo calendars and keeps them on your computer;
- gives every night a price and a minimum stay, with the reason behind each;
- shows everything on a calendar page you open in your browser.

The pricing itself is done by the [Fairnight engine](https://github.com/vladIDH/openstay/tree/main/packages/fairnight).

## Five-minute setup

You need [Node.js](https://nodejs.org) 20 or newer.

1. **Install the command and create your folder** (any name, anywhere):
   ```
   npm install -g fairnight-cli
   fairnight init my-rentals
   cd my-rentals
   ```
   This creates three things and nothing else:
   - `fairnight.config.json`: two invented listings to copy from;
   - `data/fairnight.db`: an empty database;
   - `README.txt`: a three-line reminder.

2. **Put your listings in `fairnight.config.json`.** For each listing, give it a short `name`, the iCal links of its calendars, and its price rules (`pricing`).
   - Airbnb: *Calendar → Availability → Connect calendars → Export calendar*.
   - Booking.com: *Rates & availability → Sync calendars → Export calendar*.
   - Vrbo: *Calendar → Import/Export*.

   The price rules are described in the [engine README](https://github.com/vladIDH/openstay/tree/main/packages/fairnight#factors).
   ```json
   {
     "listings": [
       {
         "name": "seaview-loft",
         "calendars": [
           { "source": "airbnb", "url": "https://www.airbnb.com/calendar/ical/….ics?s=…" },
           { "source": "booking", "url": "https://ical.booking.com/v1/export?t=…" }
         ],
         "pricing": { "currency": "EUR", "basePrice": 100, "defaultMinStay": 3, "factors": { } }
       }
     ]
   }
   ```

3. **Read the calendars and open the calendar page:**
   ```
   fairnight sync
   fairnight serve
   ```
   Then open http://localhost:4321.

## Commands

Every command works in the current folder. Add `--dir <folder>` to use another one.

| Command | What it does |
|---|---|
| `fairnight init [folder]` | Creates the folder with the example config, an empty database and a README. Never overwrites a file, so it is safe to run again. |
| `fairnight sync [--listing <name>]` | Downloads the iCal links in the config and stores stays and blocked dates. Running it twice adds nothing. A stay that disappears is marked as removed, not deleted, and comes back if it reappears. If a calendar cannot be read, nothing changes for it. |
| `fairnight import <file.csv> --listing <name> [--dry-run]` | Stores past nightly prices. Columns: date and price, from a Booking/Airbnb export or written by hand. Separators `,` `;` tab `\|`; dates like `2026-11-03` or `03/11/2026`; prices like `92.50`, `92,50` or `€ 1.234,56`. Used by the historical floor. |
| `fairnight price [--listing <name>]` | Prices every night: `--days 365` (default), `--today YYYY-MM-DD`, `--explain` for the full reasoning, `--json` for the data. |
| `fairnight export [--listing <name>] [--format csv]` | Writes `exports/<listing>-<date>.csv` with `date,price,min_stay` for every night for sale, to upload by hand to a channel or channel manager. `--out <file>` chooses the file, `--days` the horizon. |
| `fairnight serve [--port 4321] [--lan]` | The calendar page: one cell per night with price and minimum stay, reserved and blocked nights marked, a click opens the full explanation. *Recalculate* reads the calendars again. With `--lan` you can open it from a phone on the same Wi-Fi. |
| `fairnight smoobu collega` | Asks for your Smoobu API key and secret (nothing typed is shown), checks them on Smoobu and saves them in `smoobu-credentials.json`, readable only by you. |
| `fairnight smoobu importa` | Each Smoobu apartment not linked yet becomes a listing (source `smoobu`, starting prices from Smoobu, to review). Its bookings and blocked dates come in. |
| `fairnight smoobu spingi [--applica] [--da DATE] [--a DATE] [--alloggio ID]` | Compares Smoobu's prices and minimum stays with Fairnight's (default: the next 90 days) and shows the differences. **Writes only with `--applica`**, then reads back from Smoobu to check. |

**About Smoobu:** Smoobu does not publish a CSV format for importing rates, so there is no `--format smoobu`: use the `fairnight smoobu` commands below.

## Smoobu (0.2.0, in development)

The connector uses only Smoobu's **HMAC request signing**: create the key **with its secret** in Smoobu (*Settings → Advanced → API Keys → Create API Key*, then *Generate Secret*). The secret is shown only once. The old key-only login stops working on 31 October 2026 and is not used.

```
fairnight smoobu collega                 # once: key and secret, asked without echo
fairnight smoobu importa                 # apartments become listings, bookings come in
fairnight smoobu spingi                  # dry run: the table of differences, nothing written
fairnight smoobu spingi --applica        # writes, then reads back from Smoobu
```

- **Credentials.** `SMOOBU_API_KEY` and `SMOOBU_API_SECRET` win over the saved file. Neither value is ever printed. Never commit `smoobu-credentials.json`.
- **Reading.** `fairnight sync` (and *Recalculate*) also reads the bookings of listings linked to Smoobu. Blocked dates are unavailable nights, never bookings.
- **Booking day.** For Smoobu listings the stale-calendar discount uses the real day each booking was made.
- **Past prices.** Smoobu gives the total of each stay. Fairnight stores it with its average per night, and uses that average in the historical floor only with `fairnight price --usa-storico-smoobu`, because it is an average per stay, not the price of each night.
- **Writing.** Price and minimum stay always go together. Smoobu does not document whether the end of a date range is included, so Fairnight writes one night per operation until the first real `--applica` has checked it once. After that it uses ranges of up to 7 equal nights.
- **Limits.** At most 300 requests per minute (Smoobu allows 700). It waits when Smoobu says so (429), retries outages, and stops with an explanation on anything else.

## Real output (invented calendars)

```
$ fairnight sync
seaview-loft · airbnb: 3 events · 3 new · 0 changed · 0 removed · 0 back
seaview-loft · booking: 2 events · 2 new · 0 changed · 0 removed · 0 back
garden-studio · vrbo: 3 events · 3 new · 0 changed · 0 removed · 0 back

$ fairnight price --listing seaview-loft --days 10 --today 2026-11-01
seaview-loft · 10 nights from 2026-11-01 · prices in EUR
date        day    price  min  why
2026-11-01  sun       81    1  sun -5%, last minute (≤3 days) -15%
2026-11-02  mon       85    1  last minute (≤3 days) -15%
2026-11-03  tue       85    1  last minute (≤3 days) -15%
2026-11-04  wed        —    —  reserved
…
2026-11-08  sun       84    2  sun -5%, gap of 2 nights -12%
2026-11-09  mon       88    2  gap of 2 nights -12%
2026-11-10  tue        —    —  reserved
5 for sale · 5 reserved · 0 blocked · average 84.60, from 81 to 88

$ fairnight export --listing seaview-loft --today 2026-11-01
seaview-loft: 344 nights for sale written to …/exports/seaview-loft-2026-11-01.csv
```

## Beds24 (0.2.0, in development)

One Fairnight listing is one Beds24 **room**. Rooms with several identical units (`qty` > 1) are skipped in this version.

```
fairnight beds24 collega                 # once: the invite code, asked without echo
fairnight beds24 importa                 # rooms become listings, bookings come in
fairnight beds24 spingi                  # dry run: the table of differences, nothing written
fairnight beds24 spingi --applica        # writes, lists refused nights, reads back
```

- **Invite code.** Create it in Beds24: *Settings → Marketplace → API → Generate invite code*. Choose the permissions **read:bookings, all:inventory, read:properties** at that moment: they cannot be changed later. The code works once, for 24 hours.
- **Refresh token.** `collega` exchanges the code for a refresh token and saves it in `beds24-credentials.json`, readable only by you. `BEDS24_REFRESH_TOKEN` wins over the file. **A refresh token stops working after 30 days without use.** Short tokens are renewed automatically. No token is ever printed.
- **Which price.** Fairnight writes `price1` unless the listing says otherwise, for example `{ "source": "beds24", "roomId": 1234567, "priceField": "price2" }`. It writes only that field and `minStay`: availability, overrides and the other prices are never touched.
- **Credits.** Beds24 allows 100 credits every 5 minutes by default. Fairnight never goes below half of them, waits for the reset when needed, and prints after each command: `Beds24 credits: 7 used in this run · 93 left of 100 in this 5-minute window.`
- **Bookings.**
  - `confirmed`, `new` and `request` count as bookings; `black` is a blocked date; `cancelled` is removed; enquiries are ignored.
  - The stale-calendar discount uses the real booking time.
  - Stay prices feed the historical floor only with `fairnight price --usa-storico-beds24`, because they are averages per stay.
- **Writing.** One element per night, all in one request per room, until the first real `--applica` has checked once how Beds24 reads the end of a range; then ranges of up to 7 equal nights. Nights Beds24 refuses are listed one by one, and everything is read back.

## How calendars are read

- **Airbnb**: "Reserved" counts as a stay; "Airbnb (Not available)" counts as a blocked date.
- **Booking.com**: the export does not tell stays from closed dates, so every event counts as a stay.
- **Vrbo**: "Blocked" or "Unavailable" counts as a blocked date; everything else is a stay.
- **Other**: "not available", "unavailable", "blocked" or "closed" counts as a blocked date.

If a calendar is read the wrong way, set `"treatAs": "reservation"` or `"treatAs": "blocked"` on it.

Calendars do not say when a booking was made. Fairnight counts a booking as new on the day `fairnight sync` first sees it, and the stale-calendar discount uses that date. Run `sync` often, for example every few hours with the Windows Task Scheduler or cron. Right after the first sync every stay looks new, so the discount waits.

## Where your data lives

Everything stays in your folder:
- `fairnight.config.json` holds your rules and your iCal links. Treat those links like passwords: anyone who has one can read that calendar.
- `data/fairnight.db` is a single SQLite file. It holds stay dates, blocked dates and imported prices. Guest names, phone numbers and descriptions are never stored.
- `exports/` holds the CSV files you asked for.

The only network requests go to the iCal links you wrote. The calendar page listens only on your computer unless you add `--lan`, and even then only devices on your own network can open it. No accounts, no telemetry. To back up, copy the folder. To start over, delete it.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
