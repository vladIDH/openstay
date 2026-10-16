# fairnight-market

Zone data for [Fairnight](https://github.com/vladIDH/openstay). Hosts use it through the `fairnight mercato` commands of [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli). This package is the library underneath.

The engine never reads the network: these adapters turn a source into zone figures per night (occupancy, average price, number of comparable listings), and the engine's zone demand factor compares each night with the zone's own average.

**No scraping, ever.** Nothing here scrapes any website.

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
- Comparable listings: same room type, number of bedrooms, number of guests (`accommodates`) and neighbourhood, as you choose.
- The files are read as a stream, so a large city does not need much memory.

### ISTAC: holiday homes of the Canary Islands

Open data of the [Instituto Canario de Estadística](https://www.gobiernodecanarias.org/istac/): dataset `C00065A_000062`, the average daily rate (ADR) of the holiday homes of each municipality, month by month, for whole homes of 1–4, 5–8 or more than 8 guests. One CSV call per municipality to `datos.canarias.es`, no key.

- **Licence:** [ISTAC's legal notice](https://www.gobiernodecanarias.org/istac/aviso_legal.html) allows reuse "para fines comerciales y no comerciales", citing "Fuente: Instituto Canario de Estadística (ISTAC)" and the date of the last update, without suggesting that ISTAC supports the reuse. The figures are shown as ISTAC gives them; our own results (the suggested base price) are said to be ours.
- **Requests:** ISTAC may limit repeated requests for the same data; the figures change once a month, so import once a month.
- **Granularity:** monthly and past. Each night uses the most recent month with the same calendar month.
- ISTAC's rate of booked homes is not used: by its definition (booked at least once in the month or the one before) it stays around 95%.

### INE: tourist apartments of Spain (switched off)

Table 2083 of INE's "Encuesta de Ocupación en Apartamentos Turísticos": the occupancy of the registered tourist apartments of each tourist point, month by month, as the zone's season (no prices). One JSON call to `servicios.ine.es`, no key. Citation: "Elaboración propia con datos extraídos del sitio web del INE: www.ine.es". Fairnight keeps it off while the licence is unclear (CC BY 4.0 in INE's legal notice, CC BY-SA 4.0 in the footer of the same site).

### AirROI (used with AirROI's agreement)

With **your own** AirROI API key, for your own pricing: no Fairnight key, no hosted service. The client calls only two zone endpoints: `GET /markets/search` and `POST /markets/metrics/all`. It never calls listing-level data.

- **Agreement:** the adapter is used with AirROI's agreement (15 October 2026), which covers the zone metrics in the host's prices and in the suggested base price.
- **Attribution:** "Powered by AirROI" with a link to [https://www.airroi.com](https://www.airroi.com), wherever the data is shown (`AIRROI_ATTRIBUTION`, `AIRROI_URL`).
- **Freshness:** no fixed retention limit; data older than 30 days (`AIRROI_REFRESH_DAYS`) is read again by the next `fairnight sync`, as AirROI suggests refreshing at least once a month. All of it is deleted on request (`fairnight mercato cancella`).
- **Cost:** AirROI charges every call to your account. See [airroi.com/api/pricing](https://www.airroi.com/api/pricing).
- **Granularity:** AirROI gives one figure per past month. Each night uses the most recent month with the same calendar month, so it shows the zone's season, not a forecast.
- The key never appears in an error message.

The adapter is optional: nothing is called without your key and a zone under `market.airroi.areas`, and `market.airroi.enabled: false` switches it off. See `docs/fonti-mercato.md`.

## Tests

The tests use invented data only, and a fake AirROI server on 127.0.0.1 (`test/fake-airroi.ts`). They never call the real AirROI.

```
npm test -w fairnight-market
```

## Licence

AGPL-3.0-only.
