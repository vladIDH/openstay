# Come si fa un rilascio

Per chi mantiene il progetto. Un tag `v*` fa partire [.github/workflows/release.yml](../.github/workflows/release.yml); i passi stanno in [scripts/release.mjs](../scripts/release.mjs), così si provano sul proprio computer prima del tag.

Tutti i pacchetti hanno la stessa versione. Il workflow:

1. controlla che versioni, dipendenze interne e CHANGELOG corrispondano al tag, poi `npm run check` su Node 20 e 22;
2. prova l'installer su Windows e Mac (Node 22 e 24), lo stesso job delle pull request;
3. crea una Release **bozza** con i tarball npm, `Fairnight-installa.zip` e `SHA256SUMS.txt`, con le note prese dal CHANGELOG;
4. si ferma sull'environment protetto `npm`: solo dopo l'approvazione a mano pubblica su npm, in ordine di dipendenza, e rende pubblica la Release.

La bozza resta invisibile finché i pacchetti non sono su npm: lo zip installa `fairnight-cli@latest` da npm, quindi non deve mai essere scaricabile prima.

## Una volta sola, prima del primo rilascio

- **npm.** Account npm con 2FA. I nomi `fairnight`, `fairguest`, `fairhello`, `fairnight-smoobu`, `fairnight-beds24`, `fairnight-market`, `fairnight-cli`, `fairnight-mcp` erano liberi il 15 ottobre 2026 (`npm view <nome>` → E404). Un *granular access token* con permesso di pubblicare (Read and write, tutti i pacchetti, o «nuovi pacchetti» per il primo rilascio).
- **Environment `npm`** in *Settings → Environments*: *Required reviewers* = Vlad, *Deployment branches and tags* = solo tag `v*`, segreto `NPM_TOKEN` dentro l'environment (non tra i segreti del repo). Su un repo privato con piano gratuito i revisori obbligatori non ci sono: il workflow va usato a repo pubblico.
- **Segnalazioni private**: *Settings → Code security → Private vulnerability reporting* acceso (lo citano SECURITY.md e il modulo delle issue).
- Dopo il primo rilascio si può passare a *Trusted publishing* di npm (OIDC, senza token): si configura per ogni pacchetto che esiste già.

## Ogni rilascio

1. Su main, un commit «Release 0.2.0»: nel CHANGELOG `## [0.2.0] - unreleased` diventa `## [0.2.0] - 2026-10-20` (la data vera). Se cambia la versione: `npm version 0.3.0 --workspaces --no-git-tag-version`, poi le dipendenze interne e `VERSION` in `packages/fairnight-mcp/src/server.ts`; `node scripts/release.mjs check v0.3.0` dice cosa manca.
2. Prova in locale (sotto).
3. `git tag -a v0.2.0 -m "OpenStay 0.2.0"` e `git push origin v0.2.0`.
4. In *Actions → Release* aspetta il giallo su «npm», controlla la bozza in *Releases* (file, note), poi *Review deployments → Approve*.
5. Controlla: `npm view fairnight-cli version`, la Release pubblica, e il link fisso `https://github.com/vladIDH/openstay/releases/latest/download/Fairnight-installa.zip`.

Una prova generale si fa con un tag di prerelease (`v0.2.0-rc.1`, versioni `0.2.0-rc.1`): su npm va sotto il tag `next`, mai `latest`, e la Release è segnata come prerelease. Se un pacchetto è già su npm con quella versione, viene saltato: rilanciare il job dopo un errore a metà è sicuro.

## Prova in locale, senza toccare il repo

```
node scripts/release.mjs packages            # ordine di pubblicazione
node scripts/release.mjs check v0.2.0        # versioni e CHANGELOG
node scripts/release.mjs notes 0.2.0         # le note della Release
npm run build
node scripts/release.mjs pack release-files  # i tarball (release-files/ è ignorata da git)
node scripts/release.mjs publish --dry-run   # npm publish --dry-run per ogni pacchetto
node installa/pacchetto.mjs                  # lo zip per gli host
```

`check` fallisce finché il CHANGELOG dice «unreleased»: è voluto, il tag va messo sul commit di rilascio.
