# Contributing to OpenStay

Thank you for helping. Hosts and developers are both welcome.

## Hosts: tell us what is wrong or missing

Open an issue and say:
- what you did;
- what you expected;
- what happened instead.

The output of `fairnight price --explain` for the night in question helps a lot.

**Never paste your iCal links, your `fairnight.config.json` with real links, or guest data in an issue.** Replace links with `https://calendar.example.com/...`.

## Developers

```
git clone https://github.com/vladIDH/openstay.git
cd openstay
npm install
npm run check      # typecheck, lint, tests and build of every package
```

Node.js 20 or newer. The repository is an npm workspace:
- `packages/fairnight`: the engine;
- `packages/fairnight-cli`: the command and the calendar page;
- `packages/fairnight-mcp`: the MCP server.

### Rules of the project

- **No scraping, ever.** No unofficial APIs, no automated logins to Airbnb, Booking.com, Vrbo, PriceLabs or any other site. Data comes from the host (iCal links, CSV files) or from official APIs with the host's own key.
- **The engine stays pure.** `packages/fairnight` has no runtime dependencies and never touches the network, files, the database or the clock. "Today" is always an input.
- **Every price must be explainable.** A new factor adds a step to the explanation, with the price before and after it.
- **Deterministic.** Same input, same output. The regression test prices 365 nights of the example and compares them with `packages/fairnight/test/fixtures/expected-365.json`. If you change the engine on purpose, run `npm run regen:expected -w fairnight` and explain the diff in your pull request.
- **No real data in the repository.** Examples and tests use invented listings, invented calendars and `example.com` links.
- **Tests with every change.** The engine keeps its coverage above 90%. Tests never use the network: use the fake fetch in `packages/fairnight-cli/test/helpers.ts`.
- **Plain words.** Messages, explanations and docs are written for hosts, not for programmers.

### Pull requests

- One topic per pull request, with a short description of why.
- `npm run check` must pass. CI runs it on Node 20 and 22, plus a secret scan.
- Commit messages in English, imperative mood ("Add …", "Fix …").
- By contributing you agree that your contribution is licensed under AGPL-3.0.

### Proposing a pricing factor

Open an issue first with:
- what it does in one sentence;
- the data it needs;
- whether it works with the host's data alone;
- an example night with the price before and after.

The map of features and phases is in `docs/` (in Italian for now).
