# Installer per gli host

La guida per gli host è [docs/installa.md](../docs/installa.md). Qui c'è come funziona l'installer, come si prova e come si pubblica.

## Come funziona

| File | Cosa fa |
|---|---|
| `Installa Fairnight.cmd` (radice del repo) | doppio clic su Windows: lancia `installa/windows.ps1` con `-ExecutionPolicy Bypass` solo per quel processo |
| `Installa Fairnight.command` (radice del repo) | doppio clic su Mac (la prima volta tasto destro › Apri): lancia `installa/mac.sh` |
| `windows.ps1`, `mac.sh` | lo stesso percorso sui due sistemi: Node.js ≥ 22, installazione, file da doppio clic, icona, `fairnight configura`, `fairnight apri` |
| `fairnight.ico`, `fairnight.png` | l'icona (la `.png` è 1024 px: su Mac diventa `.icns` con `sips` e `iconutil`) |
| `pacchetto.mjs` | crea `installa/pacchetto/Fairnight-installa.zip` per GitHub Releases |
| `prova/calendari-finti.mjs` | calendari iCal inventati su `127.0.0.1:8765`, per la CI e le schermate |

Da dove installa:

- **copia del progetto** (beta tester collaboratori del repo privato): se accanto a `installa/` c'è `packages/fairnight-cli`, fa `npm ci`, `npm run build`, `npm pack` dei 6 pacchetti e `npm install` dei `.tgz` in `~/Fairnight/programma`;
- **npm** (dopo il lancio, dallo zip delle Releases): `npm install fairnight-cli@latest` nella stessa cartella.

L'host vede e fa le stesse cose nei due casi. `~/Fairnight` contiene `programma/` (si rifà a ogni installazione), `fairnight.config.json`, `data/`, `Fairnight.cmd|.command`, `Cambia impostazioni.cmd|.command` e `installazione.log`. Non si usano Documenti né la Scrivania (OneDrive, iCloud), non si usa `npm -g` (su Mac vorrebbe sudo) e il PATH non si tocca.

**Perché Node 22 e non 20:** better-sqlite3 12.11.1 ha binari precompilati solo per Node 22, 24, 25 e 26 (ABI 127, 137, 141, 147), su win32-x64, darwin-x64 e darwin-arm64. Con Node 20, o con Node per Windows ARM, npm proverebbe a compilarlo e fallirebbe senza strumenti di compilazione. Il motore e `engines` del repo restano `>=20`. Se un giorno esce un Node senza binario (Node 27 prima di un nuovo better-sqlite3), l'installazione fallisce con il messaggio «Non sono riuscito a installare Fairnight» e il log: va aggiornato better-sqlite3. Se l'host aggiorna Node a una nuova versione maggiore dopo l'installazione, `fairnight` dice in italiano di rilanciare l'installer (vedi `newDatabase` in `packages/fairnight-cli/src/db.ts`).

## Opzioni per le prove

| Windows | Mac | |
|---|---|---|
| `-Cartella <percorso>` | `--cartella=<percorso>` | installa altrove invece che in `~/Fairnight` |
| `-SenzaDomande` | `--senza-domande` | nessuna domanda e nessuna pausa |
| `-NonAprire` | `--non-aprire` | non apre il calendario alla fine |
| `-SenzaCollegamenti` | `--senza-collegamenti` | niente icona né app |
| `FAIRNIGHT_NODE=<node>` | `FAIRNIGHT_NODE=<node>` | usa quel Node; un percorso che non esiste = Node mancante |

Le domande di `fairnight configura` accettano risposte da una pipe, una per riga (la CI fa così).

## CI

`.github/workflows/installer.yml` gira solo sulle PR che toccano `installa/**`, i due file da doppio clic o `packages/fairnight-cli/**`, perché sul repo privato i minuti macOS costano 10 volte tanto. Su `windows-latest` e `macos-latest`, con Node 22 e 24, controlla:

- l'installazione dal file da doppio clic in una cartella con uno spazio nel nome;
- che better-sqlite3 venga dal binario precompilato (niente `build/config.gypi`);
- l'icona su Windows, l'app firmata ad hoc con la sua icona e l'alias su Mac;
- `configura` con i calendari finti, `price`, la pagina del calendario (`/api/ping`, `/api/data`, `/`);
- che un secondo `apri` trovi il primo;
- che una seconda installazione aggiorni il programma e lasci le impostazioni come sono.

C'è anche shellcheck sugli script Mac, con il controllo del bit eseguibile in git.

## Da verificare a mano su un Mac vero

La CI prova gli script su macOS, ma non il Finder, Gatekeeper e il Dock. Su un Mac pulito (Apple Silicon, e se possibile anche Intel), senza Node.js:

1. Scarica lo zip da GitHub (Code › Download ZIP) con Safari e aprilo dal Finder. Verifica che `Installa Fairnight.command` sia ancora eseguibile: un doppio clic deve portare all'avviso di Gatekeeper, non a «non hai i permessi».
2. Doppio clic: Gatekeeper lo blocca. Poi tasto destro › Apri › Apri: deve partire. **Fai le due schermate per la guida** (menu con «Apri» e finestra di conferma). Su macOS 15 e successivi il tasto destro › Apri potrebbe non bastare più: in quel caso serve Impostazioni di Sistema › Privacy e sicurezza › «Apri comunque». Annota quale dei due e correggi la guida.
3. Senza Node: deve comparire il messaggio in italiano e Invio deve aprire nodejs.org/it/download. Installa il `.pkg` LTS e rilancia. Se puoi, prova prima anche con un Node vecchio (per esempio 20): deve comparire il messaggio «Node vecchio» della guida, e la LTS installata sopra deve prenderne il posto.
4. Installazione: le domande nel Terminale, gli accenti, i simboli ✓ e «», l'incolla con Cmd+V, il calendario che si apre nel browser predefinito (anche Safari).
5. `~/Applications/Fairnight.app`: ha l'icona di Fairnight? Si apre con doppio clic senza avvisi? Apre il Terminale con «Fairnight è acceso»? Verifica anche la prima apertura, quando macOS potrebbe chiedere il permesso di aprire il Terminale.
6. L'alias `Fairnight.app` sulla Scrivania: icona giusta, doppio clic funziona. Se la Scrivania è su iCloud Drive, l'alias si sincronizza senza danni?
7. Trascina Fairnight nel Dock da Applicazioni: resta, e il clic apre il calendario. **Fai la schermata per la guida.**
8. Chiudi la finestra del Terminale mentre Fairnight è acceso: il Terminale chiede «Terminare i processi?». Annota il testo esatto per la guida. Rifai doppio clic sull'icona: deve ripartire.
9. «Cambia impostazioni.command» nella cartella Fairnight: si apre con doppio clic (creato in locale, senza quarantena)?
10. Seconda installazione dallo stesso zip: «aggiornato», impostazioni intatte, app rifatta.
11. Mac Intel (se disponibile): binario darwin-x64; Node con Homebrew in `/opt/homebrew/bin` o `/usr/local/bin`: viene trovato da una finestra aperta dal Finder?

## Pubblicare l'installer dopo il lancio

Non è ancora fatto. Prima di tutto il repo deve essere pubblico: gli host scaricano senza account GitHub.

1. Pubblica su npm, in quest'ordine: `fairnight`, `fairguest`, `fairnight-smoobu`, `fairnight-beds24`, `fairnight-market`, `fairnight-cli`. In modalità npm l'installer scarica `fairnight-cli@latest`. Finché i nomi non sono nostri su npm, **lo zip delle Releases non va pubblicato**: installerebbe il pacchetto di chiunque prendesse il nome. Il 14 ott 2026 i nomi erano ancora liberi.
2. Crea lo zip: `node installa/pacchetto.mjs` → `installa/pacchetto/Fairnight-installa.zip` (contiene i due file da doppio clic, `installa/` e `LEGGIMI.txt`).
3. Provalo su Windows e su Mac puliti, estraendolo da un download vero.
4. Pubblicalo: `gh release create vX.Y.Z installa/pacchetto/Fairnight-installa.zip --title "Fairnight X.Y.Z" --notes "…"`. Il nome del file resta sempre `Fairnight-installa.zip`, così il link fisso `https://github.com/vladIDH/openstay/releases/latest/download/Fairnight-installa.zip` porta sempre all'ultima versione.
