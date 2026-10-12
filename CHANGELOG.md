# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

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
