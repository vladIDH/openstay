# fairnight-market

Zone data for [Fairnight](https://github.com/vladIDH/openstay). Hosts use it through the `fairnight mercato` commands of [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli). This package is the library underneath.

The engine never reads the network: these adapters turn a source into zone figures per night (occupancy, average price, number of comparable listings), and the engine's zone demand factor compares each night with the zone's own average.

**No scraping, ever.** Nothing here reads Airbnb, Booking, PriceLabs or any other website.

## Sources

### Your own CSV

For zone figures you are allowed to use, from any source. A header line names the columns, in any order, in English, Italian or Spanish:

```
date,occupancy,average_price,comparables
2026-11-01,72,118,40
2026-11-02,65%,,38
```

- Occupancy is a percentage from 0 to 100.
- One of occupancy or average price can be left empty.
- With `;` as separator, decimals can use a comma.
- Bad lines are listed with their number and never stop the good ones.

### Inside Airbnb

**Only the files you download yourself.** Fairnight never downloads them and never visits the site. Download a city once from [insideairbnb.com/get-the-data](https://insideairbnb.com/get-the-data/): `calendar.csv.gz` and, if you want to keep only comparable listings, `listings.csv.gz`.

- **Licence:** the data is licensed [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Every explanation that uses it says "Inside Airbnb (insideairbnb.com), CC BY 4.0".
- **Their rules:** cite the source, do not republish the data, do not scrape the site, download once. Keep the files and the imported figures on your own computer.
- **Occupancy is an estimate.** A night marked "not available" can be booked or closed by the host, and the file cannot tell them apart. Listings closed on every night of the file are left out. Explanations say "occupancy estimated".
- **Coverage:** only the cities Inside Airbnb publishes; for example, the Canary Islands are not covered.
- Comparable listings: same room type, number of bedrooms and neighbourhood, as you choose.
- The files are read as a stream, so a large city does not need much memory.

### AirROI (switched off until AirROI confirms its terms in writing)

With **your own** AirROI API key, for your own pricing: no Fairnight key, no hosted service. The client calls only two zone endpoints: `GET /markets/search` and `POST /markets/metrics/all`. It never calls the price recommendation endpoints or listing-level data.

- **Attribution:** "powered by AirROI", wherever the data is shown.
- **Retention:** no AirROI data is kept for more than 30 days, and all of it is deleted on request (`fairnight mercato cancella`).
- **Cost:** AirROI charges every call to your account. See [airroi.com/api/pricing](https://www.airroi.com/api/pricing).
- **Granularity:** AirROI gives one figure per past month. Each night uses the most recent month with the same calendar month, so it shows the zone's season, not a forecast.
- The key never appears in an error message.

The adapter stays off (`market.airroi.enabled: false`) until AirROI answers in writing on how its terms apply. See `docs/fonti-mercato.md`.

## Tests

The tests use invented data only, and a fake AirROI server on 127.0.0.1 (`test/fake-airroi.ts`). They never call the real AirROI.

```
npm test -w fairnight-market
```

## Licence

AGPL-3.0-only.
