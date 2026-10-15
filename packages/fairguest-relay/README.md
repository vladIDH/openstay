# fairguest-relay

The mailbox behind the Fairguest check-in link: a Cloudflare Worker, one Durable Object per stay. *0.1.0, in development, not deployed yet.*

The guest opens `https://<relay>/c/<box>#v1.<…>` on a phone. The page fills in the form and reads the passport or identity card photo (MRZ) **in the browser**. It seals each guest **in the browser** with the host's public key and only then posts it. The host's computer downloads the sealed guests (`fairnight ospiti scarica`, or by itself while `fairnight serve` runs) and deletes them from the relay.

## What the relay sees, and what it never sees

| Seen | Never seen |
|---|---|
| The box id; hashes of the read and write secrets; the expiry | Names, documents or any field typed by the guest: they arrive sealed (`fg1.…`) and the relay has no key to open them |
| Sealed messages of a fixed size (padded) | How many characters a guest wrote |
| The IP address and time of each request (Cloudflare, as for any website) | The host's public key, the listing and the dates: they stay after `#` in the link, which browsers never send |
| | The photo of the document: it never leaves the phone |

**More facts about the relay**
- **Expiry:** every box deletes itself two days after check-out, read or not. Messages are deleted as soon as the host's computer downloads them.
- **No logs:** Workers observability is off (`wrangler.toml`).
- **Region:** boxes are created in the EU jurisdiction of Durable Objects.

**The limit that remains: the page's code.** Whoever runs the relay serves the page's code, so a changed page could read what the guest types before it is sealed. Two answers:
- `fairnight ospiti verifica-pagina` compares the SHA-256 of every file the relay serves with the hashes of the page built from this repository (`packages/fairnight-cli/src/guests/page-hashes.ts`, checked by this package's tests);
- anyone can host their own relay (below).

## Files

| | |
|---|---|
| `src/worker.ts` | routes, security headers (strict CSP: nothing from other sites), the Durable Object |
| `src/mailbox.ts` | the box: create, post, read, delete, expire; limits (24 KB per message, 60 messages, 120 days) |
| `src/client/` | the guest's page (TypeScript, bundled by esbuild); the form and the rules come from `fairguest/browser`, the same code as the host's own form |
| `scripts/build.mjs` | `public/`: page, styles, OCR files from npm, licences; writes the hashes for `verifica-pagina` |
| `scripts/assets.mjs` | downloads the MRZ model (DoubangoTelecom/tesseractMRZ, BSD-3-Clause), fixed commit and checked SHA-256, into `assets/` (not in git) |
| `scripts/dev.mjs` | the relay on your own computer, boxes in memory, for trying the link before a deploy |

**Third-party code in the page**, all served by the relay itself:
- Tesseract.js and tesseract.js-core, Apache-2.0;
- @noble/curves, MIT: X25519 for browsers without it in Web Crypto;
- the MRZ model, BSD-3-Clause.

Their licences are published under `/licenses/`.

## Try it locally

```
npm run assets -w fairguest-relay      # once: the MRZ model
npm run build -w fairguest-relay
node packages/fairguest-relay/scripts/dev.mjs 8788
```

Then put `"fairguestRelay": "http://localhost:8788"` in `fairnight.config.json` and run `fairnight ospiti link <stay>`.

## Deploy on Cloudflare

Needs a Cloudflare account and a domain on it. The free plan is enough for a few hosts: 100,000 Worker requests a day, plus SQLite-backed Durable Objects.

1. Run `npm run assets -w fairguest-relay`, then `npm run build -w fairguest-relay`.
2. In `wrangler.toml`, set `routes` to your domain (the official instance uses `fairguest.khlumen.com`).
3. Run `npx wrangler@4.151.0 login`, then `npx wrangler@4.151.0 deploy --config packages/fairguest-relay/wrangler.toml`.
4. Run `fairnight ospiti verifica-pagina` with `"fairguestRelay"` pointing at your domain. Every line must say `same`.

**To check on the first deploy [NV]:**
- the EU jurisdiction of Durable Objects on the free plan;
- the size limit of static assets (each OCR core file is about 3.9 MB).
