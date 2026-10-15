## Why

<!-- The problem this solves, for a host or a developer. Link the issue if there is one. -->

## What changes

<!-- In plain words. For a pricing change: one night before and after, and the regenerated expected-365.json diff explained. -->

## Checklist

- [ ] `npm run check` passes (typecheck, lint, tests, build)
- [ ] Tests added or changed for the new behaviour; no test uses the network
- [ ] No real data: invented listings and guests, `example.com` links, fake keys like `xxx-0000-not-real`
- [ ] Nothing is sent to a channel, a guest or an authority without the host's confirmation (or an automatic mode the host switched on)
- [ ] New texts on the pages in Italian, Spanish and English
- [ ] Database change: a migration step and `SCHEMA_VERSION` raised
- [ ] A line in the top section of `CHANGELOG.md`, if a host or a developer would notice

By opening this pull request I agree that my contribution is licensed under AGPL-3.0-only.
