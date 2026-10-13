# fairnight-smoobu

The Smoobu connector of [Fairnight](https://github.com/vladIDH/openstay). Hosts use it through the `fairnight smoobu` commands of [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli). This package is the library underneath.

Built only from Smoobu's public API documentation (docs.smoobu.com). No scraping, and no dependencies besides the Fairnight engine's types. It uses Node's own `fetch`.

## What it does

- **Signs every request with HMAC-SHA256**, as documented:
  - the canonical string is method, path, sorted RFC 3986 query, UTC timestamp, a fresh UUID v4 nonce, the SHA-256 of the body, and the key;
  - it is signed with the secret, which is never sent.

  The legacy `Api-Key` header is not supported: Smoobu stops accepting it on 31 October 2026.
- **Reads** apartments (`GET /api/apartments`, `/api/apartments/{id}`), bookings (`GET /api/reservations`, every page, cancellations included) and rates (`GET /api/rates`).
- **Writes** prices and minimum stays (`POST /api/rates`), always together, because Smoobu refuses a minimum stay on a date without a price.
- **Respects the limits:**
  - at most 300 requests per minute of its own (Smoobu allows 700);
  - on 429, it waits until `X-RateLimit-Retry-After` plus one second;
  - outages (5xx without a message) are retried after 1, 2, 4 and 8 seconds;
  - validation errors (HTTP 500 with a `detail`) and everything else stop with a plain explanation.
- **Plans a push** (`planPush`): the nights whose price or minimum stay differ, and the nights Smoobu marks unavailable, which are left alone.
- **Builds operations** (`buildOperations`): one night per operation until Smoobu's handling of a range end is known; after that, runs of at most 7 equal nights.

Credentials never appear in an error message.

```ts
import { SmoobuClient } from "fairnight-smoobu";

const smoobu = new SmoobuClient({
  credentials: { apiKey: process.env.SMOOBU_API_KEY!, apiSecret: process.env.SMOOBU_API_SECRET! },
  fetch: (url, init) => fetch(url, init),
});
const apartments = await smoobu.listApartments();
```

## Tests

Every test runs against a fake Smoobu server on 127.0.0.1. Like Smoobu, it checks:
- the HMAC signature;
- the timestamp, within 5 minutes;
- that no nonce is used twice;
- that the legacy header is absent.

Its responses follow the documented shapes. A signing test compares the signature with a value computed by hand, so a change in the recipe shows up at once. No test ever calls the real Smoobu.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
