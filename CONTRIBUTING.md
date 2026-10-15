# Contributing to OpenStay

Thank you for helping. Hosts and developers are both welcome.

## Hosts: tell us what is wrong or missing

Open an issue and say:
- what you did;
- what you expected;
- what happened instead.

For a price, the output of `fairnight price --listing <name> --explain` for that night helps a lot.

**Never paste in an issue:** your iCal links, your `fairnight.config.json` with real links, any `*-credentials.json` file, API keys, or guest data (names, documents, messages). Replace links with `https://calendar.example.com/...` and names with invented ones.

## Developers

```
git clone https://github.com/vladIDH/openstay.git
cd openstay
npm install
npm run check      # typecheck, lint, tests and build of every package
```

Node.js 20 or newer (22 or newer to try the installer). The repository is an npm workspace; every package is in `packages/`:

| Package | What it is |
|---|---|
| `fairnight` | the pricing engine, pure, no runtime dependencies |
| `fairguest` | guest registration, pure: rules per country, deadlines, retention, encryption, authority files |
| `fairhello` | guest replies, pure: house file, request to the model, freshness, price check |
| `fairnight-smoobu`, `fairnight-beds24` | API clients of the two channel managers |
| `fairnight-market` | zone data readers |
| `fairnight-cli` | the `fairnight` command, SQLite storage, local web pages |
| `fairnight-mcp` | the read-only MCP server |
| `fairguest-relay` | the optional relay of the check-in link (private, not on npm) |

Run one package's tests with `npm test -w fairnight-cli`. The host installer is in `installa/` (see [installa/README.md](installa/README.md)).

### Rules of the project

- **No scraping, ever.** No unofficial APIs and no automated logins to any website. Data comes from the host (iCal links, CSV files), from official APIs with the host's own key, or from open data.
- **Libraries stay pure.** `fairnight`, `fairguest` and `fairhello` never touch the network, files, the database or the clock. "Today" is always an input; network calls take a transport passed in.
- **Nothing is sent without the host.** A write to a channel, a message to a guest or a communication to an authority is shown first and needs a confirmation, unless the host switched on an automatic mode for that listing.
- **Every price must be explainable.** A new factor adds a step to the explanation, with the price before and after it, and its facts in `params`.
- **Deterministic.** Same input, same output. The regression test prices 365 nights of the example and compares them with `packages/fairnight/test/fixtures/expected-365.json`. If you change the engine on purpose, run `npm run regen:expected -w fairnight` and explain the diff in your pull request.
- **No real data in the repository.** Examples, tests and screenshots use invented listings, invented guests (specimen documents, `Prova` surnames), `example.com` links and fake keys shaped like `xxx-0000-not-real`. The secret scan in CI fails on anything that looks like a real key.
- **Database changes are migrations.** A new column or table adds a step in `packages/fairnight-cli/src/db.ts` and raises `SCHEMA_VERSION`; a test takes an old database to the latest version.
- **Tests with every change.** The engine keeps its coverage above 90%. Tests never use the network: use the fake fetch in `packages/fairnight-cli/test/helpers.ts` and the fake servers of each connector.
- **Plain words.** Messages, explanations and docs are written for hosts, not for programmers. Pages are in Italian, Spanish and English; add every new text in all three.

### Pull requests

- One topic per pull request, with a short description of why. The template asks the rest.
- `npm run check` must pass. CI runs it on Node 20 and 22, plus a secret scan; changes to the installer or the command line also run the installer on Windows and macOS.
- Commit messages in English, imperative mood ("Add …", "Fix …").
- Add a line to the top section of [CHANGELOG.md](CHANGELOG.md) for anything a host or a developer would notice.
- By contributing you agree that your contribution is licensed under AGPL-3.0-only.

### Proposing a pricing factor

Open an issue first with:
- what it does in one sentence;
- the data it needs;
- whether it works with the host's data alone;
- an example night with the price before and after.

### Releases

Maintainers only: [docs/rilascio.md](docs/rilascio.md) (Italian). A `v*` tag runs `.github/workflows/release.yml`; npm publishing waits for a manual approval.

The plan of features and phases is in `docs/` (in Italian for now).
