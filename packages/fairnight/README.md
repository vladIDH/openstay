# Fairnight

Open-source dynamic pricing engine for short-term rentals. Part of [OpenStay](https://github.com/vladIDH/openstay).

```
npm install fairnight
```

Give it the price rules of a listing and its calendar of stays. For every night of the next N days it returns:
- a price;
- a minimum stay;
- the list of factors that produced them, with what each one changed.

The engine is a pure library:
- no network, no files, no database, no clock (you pass `today`), no runtime dependencies;
- the same input always gives the same output.

> This is the engine library. Hosts want [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli): it reads your calendars, runs this engine and shows a calendar page.

## Usage

```ts
import { priceListing, parseEventsCsv } from "fairnight";

const listing = JSON.parse(listingJson); // see examples/annuncio-esempio.json
const { events } = parseEventsCsv(eventsCsvText); // optional: the host's own events
listing.factors.events = { enabled: true, list: events };

const result = priceListing(listing, { stays }, { today: "2026-11-01", days: 365 });
for (const night of result.nights) console.log(night.explanation);
```

Invalid input throws a `ConfigError` that lists **every** problem with its path. For example:
- `listing.factors.limits: floorPrice (300) is higher than ceilingPrice (200)`;
- `listing.factors.celing: unknown field`.

Use `validateListingConfig()` instead if you want the list without an exception.

## Factors

Every factor can be switched on and off. They are applied in this order:

| # | Factor | What it does |
|---|---|---|
| 1 | **Base price** | Starting point of every night. |
| 2 | **Seasons** | Yearly periods (`MM-DD` → `MM-DD`, may wrap the new year) with a multiplier or a fixed price. The first matching period wins. |
| 3 | **Day of week** | A percentage per weekday (e.g. Saturday +15%). |
| 4 | **Last minute** | Discount steps by distance from the night: within 3 days -15%, within 7 days -8%… The tightest step applies. |
| 5 | **Far out** | Premium steps for nights far ahead: from 120 days +5%, from 240 days +10%. The farthest step reached applies. |
| 6 | **Gaps** | Free stretches of up to N nights between two stays (or blocks): a discount, and a minimum stay lowered to the gap length so one booking can fill it. If a last-minute discount also applies, only the larger of the two counts. |
| 7 | **Occupancy** | Within the next N days (default 60): if the month is booked above a threshold the price goes up, below another threshold it goes down. Only nights from today count, and blocked nights are left out. |
| 8 | **Zone demand** (off by default) | Compares each night of the zone with the zone's own average, from zone data passed in `calendar.market` (the engine never fetches it). If the zone is at least 10% busier (or quieter) than usual, the price moves by **half** of that difference, at most **+15% / -10%**. Nights measured on fewer than 5 comparable listings are skipped. Weight, thresholds and caps are per listing. The explanation names the source and its attribution, and says when the occupancy is an estimate. |
| 9 | **Events** | The host's own events (CSV: date, name, impact 1–5). Each impact level has a percentage (default 0 / 5 / 12 / 25 / 40). Overlapping events do not add up: the highest impact counts. |
| 10 | **Stale calendar** (off by default) | No new booking for N days: a discount that grows step by step up to a cap, on the next nights only. It goes back to zero as soon as a new booking arrives. Needs `lastBookingReceived` in the calendar input. |
| 11 | **Historical floor** (off by default) | The price never goes below a share (e.g. 75%) of the average price sold in the same month a year earlier, when there are enough sold nights. Needs `priceHistory` in the calendar input. |
| 12 | **Floor and ceiling** | The price is kept between the two. |
| 13 | **Rounding** | To a step (1, 5, 10…), never back outside floor and ceiling. |
| 14 | **Date overrides** | A price and/or a minimum stay set by hand for a date. They win over everything, floor and ceiling included. |

**Minimum stay** follows this precedence:
1. the date override;
2. the far-out step;
3. the last-minute step;
4. the default.

After that the gap rule applies, but only if it **lowers** the minimum (and never below an override).

Reserved and blocked nights get no price (`price: null`).

## Explanation of a night

Real output for the invented example in `examples/`, with today = 2026-11-01:

```
Sat 2027-02-13 · 230 EUR: base 100 → season "Carnival week" = 160 (fixed price) → sat +15% = 184
→ event "Jazz weekend" (impact 4) +25% = 230 (highest impact counts; also "Street market" (impact 2))
→ within floor 60 and ceiling 260. Min stay 3 (default).
```

```
Mon 2026-11-09 · 88 EUR: base 100 → gap of 2 nights -12% = 88 (last-minute discount 4% not added)
→ within floor 60 and ceiling 260. Min stay 2 (lowered to fill the gap).
```

With zone data (invented here, from the host's own CSV):

```
Sat 2026-11-14 · 115 EUR: base 100 → zone demand "costa" +15% = 115 (zone 90% booked vs 61% average
· capped at +15% · 25 comparable listings · your file "zona.csv" · read 2026-11-01). Min stay 2 (default).
```

The same information is available as data: `night.steps` holds `{ factor, label, before, after, percent?, note? }` for every step.

## Configuration

See [`examples/annuncio-esempio.json`](https://github.com/vladIDH/openstay/blob/main/packages/fairnight/examples/annuncio-esempio.json) for a complete listing with every factor. All data there is invented. The types are in [`src/engine/types.ts`](https://github.com/vladIDH/openstay/blob/main/packages/fairnight/src/engine/types.ts).

Example files:
- `examples/prenotazioni-esempio.json`: the stays (`checkIn` = first night, `checkOut` = departure day, optional `kind: "blocked"`);
- `examples/eventi-esempio.csv`: an events file.

## Fairnight and PriceLabs: an honest comparison

Based only on PriceLabs' public pages (see [`docs/mappa-pricelabs.md`](https://github.com/vladIDH/openstay/blob/main/docs/mappa-pricelabs.md), in Italian). PriceLabs is a mature commercial product, while Fairnight is at its first step.

**Already in Fairnight:**
- base price, floor and ceiling;
- seasons;
- day of week;
- last-minute discounts and far-out premiums in steps;
- gap (orphan night) pricing and minimum stay;
- monthly occupancy adjustment;
- a historical floor from last year's sold prices;
- a discount when no new bookings arrive;
- date overrides;
- rounding;
- minimum stay by lead time with a clear precedence;
- a per-night explanation.

**Things Fairnight does differently today:**
- events come from the host's own file (in PriceLabs users can only suggest events to a curated list);
- every rule is visible and versioned in code;
- no per-listing fee;
- data stays with the host.

**Around the engine (other OpenStay packages):** iCal calendar sync, CSV import of past prices, a local calendar page, CSV export and a read-only MCP server.

**Phase 2:**
- rules per group and portfolio, reusable rule sets, preview before applying;
- length-of-stay discounts, extra-guest fees, check-in/out days;
- PMS connectors (Smoobu first, then Beds24) with scheduled sync;
- alerts;
- portfolio analytics and pacing against last year;
- backtesting on a past year;
- MCP with write access behind confirmation.

**Phase 3:**
- market data (comparable listings, neighbourhood percentiles) through optional adapters that use the user's own key;
- base-price suggestions;
- computed minimum stay;
- demand forecasting.

**Not planned:**
- direct Airbnb/Vrbo connections, which need partner agreements;
- listing-quality scoring;
- any scraping, ever.

## Development

```
npm install            # at the repo root
npm run check          # typecheck + lint + tests
npm run coverage -w fairnight
npm run regen:expected -w fairnight   # after an intentional change to the engine
```

The regression test prices 365 nights of the example and compares them with `test/fixtures/expected-365.json`. If you change the engine on purpose, regenerate that file and review the diff.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
