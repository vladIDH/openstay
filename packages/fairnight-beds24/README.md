# fairnight-beds24

The Beds24 connector of [Fairnight](https://github.com/vladIDH/openstay). Hosts use it through the `fairnight beds24` commands of [fairnight-cli](https://github.com/vladIDH/openstay/tree/main/packages/fairnight-cli). This package is the library underneath.

Built only from Beds24's public documentation: the API V2.0 wiki and the OpenAPI spec at `beds24.com/api/v2`. No scraping, and no dependencies besides the Fairnight engine's types. It uses Node's own `fetch`.

## What it does

- **Authenticates.**
  - It turns an invite code into a refresh token (`GET /authentication/setup`).
  - It gets short tokens from it (`GET /authentication/token`), with the lifetime from `expiresIn`.
  - It renews them when less than 2 minutes are left, and once, at once, after a 401 in the middle of a run.
  - It can reuse a token saved by a previous run.
- **Watches the credits:**
  - it reads `X-FiveMinCreditLimit`, `-Remaining`, `-ResetsIn` and `X-RequestCost` (also in the wiki's `x-five-min-limit-*` spelling);
  - it never uses more than half of the 5-minute window;
  - on 429 it waits for the window to reset, plus one second;
  - 5xx are retried after 1, 2, 4 and 8 seconds;
  - 400 and the rest stop with Beds24's message.
- **Reads** rooms (`GET /properties?includeAllRooms=true`), bookings (`GET /bookings`, every page) and the calendar (`GET /inventory/rooms/calendar`, expanded night by night).
- **Writes** (`POST /inventory/rooms/calendar`) only the chosen price field and `minStay`, one element per write. It reports the answer of each element.
- **Plans** a push (`planPush`, `buildWrites`) and maps bookings (`mapBookings`):
  - confirmed, new and request are bookings;
  - black is blocked;
  - cancelled is removed;
  - inquiry is ignored.

No token ever appears in an error message.

## Tests

Every test runs against a fake Beds24 server on 127.0.0.1. It follows the spec's shapes and reproduces:
- tokens that expire;
- credits that run out (429 with `ResetsIn`);
- paginated bookings;
- calendar runs;
- 201 answers with errors for some elements.

No test ever calls the real Beds24.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
