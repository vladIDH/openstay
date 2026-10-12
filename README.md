# OpenStay · Fairnight

**Fair nightly prices for your holiday rental, worked out on your own computer.**

Fairnight looks at your Airbnb, Booking.com and Vrbo calendars and at the rules you set. It then gives every night of the coming year a price and a minimum stay, and tells you **why**:

> Sat 13 Feb · 230 EUR: base 100 → season "Carnival week" = 160 → Saturday +15% = 184 → event "Jazz weekend" +25% = 230 → within floor 60 and ceiling 260. Min stay 3.

It is free and open source (AGPL-3.0). It has no account, no monthly fee per listing, and it does not send your data anywhere.

![Fairnight calendar page](docs/images/calendar.png)

## What it does

- **Reads your calendars** through the iCal links that Airbnb, Booking.com, Vrbo and most channel managers give you.
- **Prices every night** from your rules:
  - base price, floor and ceiling;
  - seasons and weekdays;
  - last-minute discounts and far-ahead premiums;
  - gaps between two stays;
  - how full the month is;
  - your local events;
  - last year's prices;
  - a discount when no booking has come in for a while.
- **Sets the minimum stay** too: shorter close to the date, longer far ahead, and lowered so a single booking can fill a gap.
- **Explains each price**, step by step.
- **Shows a calendar page** in your browser, on your computer or your phone.
- **Exports a CSV** (date, price, minimum stay) to upload where you need it.
- **Answers questions in Claude** through an optional read-only MCP server: "which gaps do I have before Christmas?"

What it does **not** do (yet): it does not change prices on Airbnb or Booking.com by itself. You copy the prices, or upload the CSV. Connectors for channel managers (Smoobu first) come in phase 2.

## Five-minute setup

You need [Node.js](https://nodejs.org) 20 or newer (free; the installer takes a minute).

```
npm install -g fairnight-cli
fairnight init my-rentals
cd my-rentals
```

1. Open `fairnight.config.json`. Replace the two example listings with yours:
   - a short name;
   - the iCal links from your channels;
   - your base, minimum and maximum price.
2. Read your calendars: `fairnight sync`
3. Open the calendar page: `fairnight serve`, then go to http://localhost:4321

Details, with where to find the iCal links on each channel, are in [fairnight-cli](packages/fairnight-cli).

## The commands

| Command | What it does |
|---|---|
| `fairnight init my-rentals` | Creates your folder with an example to copy from. |
| `fairnight sync` | Reads your calendars again. Safe to run as often as you like. |
| `fairnight price` | Prints every night with its price, minimum stay and reason (`--explain` for the full story). |
| `fairnight serve` | The calendar page (`--lan` to open it from your phone). |
| `fairnight export` | A CSV with date, price and minimum stay. |
| `fairnight import prices.csv --listing <name>` | Last year's prices, for the historical floor. |

## Fairnight today and PriceLabs

PriceLabs is a mature, paid service with market data from millions of listings. Fairnight is a first version that works only with **your** data. This is where it stands, compared with PriceLabs' public feature pages:

| Feature | PriceLabs | Fairnight today | Coming in |
|---|---|---|---|
| Base price, floor and ceiling, rounding | ✓ | ✓ | — |
| Seasons, day of week | ✓ | ✓ | — |
| Last-minute discount, far-ahead premium | ✓ | ✓ (steps you choose) | market-driven version: phase 3 |
| Gap (orphan night) pricing and minimum stay | ✓ | ✓ | — |
| Minimum stay by lead time | ✓ | ✓ | computed minimum stay: phase 3 |
| Occupancy adjustment | ✓ | ✓ (per month) | portfolio-wide: phase 2 |
| Historical floor | ✓ | ✓ (same month last year) | — |
| Discount when no bookings arrive | ✓ | ✓ | — |
| Events | curated list, users can only suggest | ✓ your own events file | public holidays file: phase 2 |
| Date overrides | ✓ | ✓ | — |
| Explanation of each price | tooltip | ✓ every step, reproducible | — |
| Calendar page | ✓ | ✓ local | — |
| AI assistant connection (MCP) | ✓ | ✓ read-only, local | write access with confirmation: phase 2 |
| Rules per group / portfolio, reusable rule sets | ✓ | — | phase 2 |
| Length-of-stay discounts, extra-guest fees, check-in days | ✓ | — | phase 2 |
| Pushing prices to channel managers | ✓ 160+ | — (CSV export) | Smoobu, then Beds24: phase 2 |
| Alerts, portfolio reports, pacing vs last year | ✓ | — | phase 2 |
| Try the rules on last year first (backtest) | preview of new rules only | — | phase 2 |
| Market data: neighbourhood prices, comp sets | ✓ | — | phase 3, optional, with your own data key |
| Price per listing | about $20 a month (third-party sources) | free | — |
| Your data | in their cloud | on your computer | — |

Direct connections to Airbnb and Vrbo need partner agreements, and OpenStay will never scrape any website.

## Privacy

Everything stays in your folder: your rules, your calendars, your prices. The only internet requests go to the calendar links you write yourself. Guest names, phone numbers and messages are never stored. There is no account, no tracking and no telemetry.

## The packages

| Package | For whom |
|---|---|
| [`fairnight-cli`](packages/fairnight-cli) | Hosts: the `fairnight` command and the calendar page. |
| [`fairnight-mcp`](packages/fairnight-mcp) | Hosts who use Claude Desktop or another MCP client. |
| [`fairnight`](packages/fairnight) | Developers: the pricing engine as a pure library (no network, no files). |

## Contributing

Bug reports, ideas and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md). What changed in each version: [CHANGELOG.md](CHANGELOG.md).

Contact: [hello@khlumen.com](mailto:hello@khlumen.com).

## License

[AGPL-3.0](LICENSE). You can use, study, change and share Fairnight. If you offer a modified version to others, including as an online service, you must share your changes under the same license.
