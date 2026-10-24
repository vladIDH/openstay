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

## 0.2.0, sabato 24 ottobre 2026: i passi in ordine

Il merge di «Release 0.2.0» è già su main; nessun tag esiste ancora. Su un repo privato col piano gratuito i minuti di Actions sono finiti e i revisori obbligatori non ci sono: per questo si rende pubblico **prima** del tag.

0. Prima di tutto, dalla cartella del repo: `git fetch` e `git log origin/main --format='%ae' | sort -u` → una sola riga, l'indirizzo noreply di vladIDH. Se GitHub ha confermato la pulizia degli oggetti chiesta col ticket, ricontrollarla qui.
1. **Repo pubblico.** *Settings → General → Danger Zone → Change repository visibility → Change to public*, conferma col nome `vladIDH/openstay`. Da terminale: `gh repo edit vladIDH/openstay --visibility public --accept-visibility-change-consequences`.
2. **Environment `npm`** (Vlad). *Settings → Environments → New environment* → nome `npm` → *Configure environment*:
   - *Required reviewers*: spunta, aggiungi `vladIDH`, *Save protection rules*;
   - *Deployment branches and tags*: *Selected branches and tags* → *Add deployment branch or tag rule* → tipo **Tag**, schema `v*`;
   - *Environment secrets → Add environment secret*: nome `NPM_TOKEN`, valore il granular token di npm (Read and write, permesso di creare pacchetti nuovi).
   - Nella stessa pagina *Settings → Code security*: *Private vulnerability reporting* acceso.
3. **Tag**, da main aggiornato:
   ```
   git checkout main && git pull --ff-only
   node scripts/release.mjs check v0.2.0
   git tag -a v0.2.0 -m "OpenStay 0.2.0"
   git push origin v0.2.0
   ```
4. **Approvazione** (Vlad). *Actions → Release → la corsa di v0.2.0*: quando test, installer, build e draft sono verdi il job **npm** resta giallo «Waiting». Prima guarda la bozza in *Releases* (9 tarball meno il relay privato = 8, `Fairnight-installa.zip`, `SHA256SUMS.txt`, note), poi *Review deployments* → spunta `npm` → *Approve and deploy*.
5. **Controlli finali.**
   ```
   for p in fairnight fairguest fairhello fairnight-smoobu fairnight-beds24 fairnight-market fairnight-cli fairnight-mcp; do npm view $p version; done   # 0.2.0 per tutti e 8
   npm view fairnight-cli dist.attestations.provenance --json                                                         # provenance presente
   ```
   Installazione pulita in una cartella vuota fuori dal repo:
   ```
   mkdir prova-020 && cd prova-020 && npm init -y && npm install fairnight-cli@0.2.0 && npx fairnight --version
   ```
   `npx fairnight --version` (o `-v`) stampa solo la versione, qui `0.2.0`, ed esce con 0. L'opzione c'è dalla versione dopo la 0.2.0: con `fairnight-cli@0.2.0` risponde «Unknown option», e al suo posto si usa `npx fairnight help`, che esce con 0.
   Infine la Release pubblica segnata *Latest* e il link `https://github.com/vladIDH/openstay/releases/latest/download/Fairnight-installa.zip` che scarica lo zip.
