# Fairhello: le risposte agli ospiti

Fairhello è la parte di OpenStay che prepara le risposte ai messaggi degli ospiti. Gira sul computer dell'host, come Fairnight e Fairguest, e **non invia niente senza l'approvazione dell'host**.

Stato: 0.1.0, in lavorazione sul ramo `fairhello` (15 ottobre 2026).

## Come funziona

1. `fairnight risposte collega`: l'host sceglie il modello che scrive le bozze:
   - **Anthropic** (Claude Haiku, `claude-haiku-5-5`) con la **propria** chiave, salvata in `fairhello-credentials.json` oppure in `ANTHROPIC_API_KEY`;
   - **Ollama**, cioè un modello che gira sullo stesso computer (per esempio `qwen3:8b`). Nessun messaggio esce dal computer.
2. `fairnight risposte casa --listing <nome>`: una decina di domande scrivono `casa/<nome>.md`, la scheda della casa. Si può cambiare con qualunque editor di testo.
3. `fairnight risposte leggi`, oppure il pulsante sulla pagina `/risposte`:
   - legge i messaggi da Smoobu o Beds24 con le chiavi che Fairnight usa già;
   - scrive una bozza per ogni ospite che aspetta una risposta.
4. L'host apre `http://localhost:4321/risposte` (`fairnight serve`), legge la conversazione e la bozza, la corregge se serve e preme **Approva e invia**. In alternativa, da terminale: `fairnight risposte invia <n> --applica`.

Senza `casa/<nome>.md` non si scrive nessuna bozza per quella casa: l'assistente non indovina mai i dati di una casa che non conosce.

## Da dove arrivano i messaggi

Nella 0.1 solo dalle API ufficiali dei gestionali, con la chiave dell'host:

| Gestionale | Lettura | Risposta | Note |
|---|---|---|---|
| Smoobu | `GET /api/threads` (ultimo messaggio per prenotazione), `GET /api/reservations/{id}/messages` | `POST /api/reservations/{id}/messages/send-message-to-guest` | Smoobu non dà l'ora dei messaggi: l'ordine è il loro id. Il webhook `newMessage` vuole un indirizzo pubblico, quindi in locale si legge a richiesta. |
| Beds24 | `GET /bookings/messages` (fino a 50 prenotazioni per richiesta) | `POST /bookings/messages` | Il codice d'invito deve avere anche lo scope **bookings-personal** in scrittura. Beds24 invia solo per le prenotazioni arrivate da un canale (Airbnb, Booking.com, Expedia, Vrbo), e solo testo. |

Fonti: docs.smoobu.com (sezione Messages), beds24.com/api/v2/apiV2.yaml (`/bookings/messages`, schema `message`), wiki.beds24.com/index.php/Messages.

**Le mail di Airbnb e Booking.com arrivano in una versione successiva** (vedi `piano.md`): lettura IMAP in sola lettura. La risposta via mail non è documentata da nessuna delle due piattaforme come canale ufficiale.

## Cosa sa l'assistente, e cosa no

Va al modello:
- le regole fisse e la scheda della casa, senza la sezione dei codici. Sono la parte uguale per tutti i messaggi di una casa, che Anthropic tiene in cache;
- le date del soggiorno, gli orari di check-in e check-out (dal blocco `fairguest` dell'annuncio), il numero di ospiti e la loro lingua, se il gestionale li conosce;
- se la registrazione degli ospiti (Fairguest) è fatta o no: solo il numero di persone registrate;
- le notti libere subito prima e subito dopo il soggiorno, dai calendari di Fairnight: **solo le date**;
- gli ultimi 20 messaggi della conversazione, dentro un tag. Il modello li tratta come testo a cui rispondere, mai come istruzioni.

Non va mai al modello:
- **i prezzi.** Il modello non li vede e ha l'ordine di non scriverne. Se una bozza contiene comunque un importo, è segnata e **non si può inviare finché l'host non la modifica**. Sulla pagina l'host vede il prezzo Fairnight delle notti libere vicine: è solo per lui;
- il nome, i documenti, il telefono o la mail dell'ospite;
- **i codici d'accesso fuori dal soggiorno.** La sezione `## Codici d'accesso` (o `## Códigos de acceso`, `## Access codes`) va al modello solo dal giorno del check-in al giorno del check-out. Se l'annuncio usa Fairguest, va solo dopo che almeno un ospite si è registrato.

## Prima di inviare

Ogni invio, dalla pagina o da terminale, passa da questi controlli:
1. la conversazione viene **riletta dal gestionale**, perché l'ospite può aver scritto di nuovo;
2. **controllo di freschezza.** La bozza deve essere la più recente della conversazione e rispondere all'ultimo messaggio dell'ospite. La prenotazione non deve essere cancellata e il soggiorno deve essere finito da al massimo 2 giorni;
3. una bozza con un prezzo scritto dal modello è ferma finché l'host non la cambia;
4. la bozza viene presa in carico una volta sola: un doppio clic non la invia due volte;
5. se il gestionale rifiuta, la bozza resta «non riuscita» con il motivo e si può riprovare.

L'invio automatico **non c'è** nella 0.1: per ogni risposta serve l'ok dell'host.

## Lingue

La bozza è nella lingua dell'ultimo messaggio dell'ospite. La lingua indicata dal gestionale (`language` di Smoobu, `lang` di Beds24) è un aiuto. La lingua della bozza viene salvata sul soggiorno. La pagina `/risposte` è in italiano, spagnolo e inglese, come il calendario.

## Costi indicativi

Con circa 24 bozze al mese per casa (4 prenotazioni, 6 messaggi ciascuna), prezzi ufficiali di ottobre 2026:

| Modello | 1 casa | 10 case | 100 case |
|---|---|---|---|
| Claude Haiku 5.5 (predefinito) | circa 1 centesimo al mese | circa 0,12 $ | circa 1,2 $ |
| Ollama sul computer dell'host | 0 (elettricità e computer) | 0 | 0 |

`fairnight risposte stato` mostra i token usati negli ultimi 30 giorni.

**Escluso:** il piano gratuito di Gemini, che usa i dati per migliorare i prodotti di Google.

## Privacy

- I messaggi restano nel database dell'host (`data/fairnight.db`, tabelle `hello_*`) e vengono **cancellati 60 giorni dopo il check-out** (`retentionDays` in `fairhello.json`).
- Con Anthropic, la parte della conversazione necessaria a una bozza va ad Anthropic con la chiave dell'host. Anthropic cancella le chiamate API entro 30 giorni, salvo zero data retention concordata. Il contratto (DPA) è tra l'host e Anthropic. Con Ollama non esce niente.
- La pagina `/risposte` si apre **solo da questo computer**, anche con `--lan`, e rifiuta proxy e tunnel. Gli ospiti sulla stessa wifi non la vedono.
- Il server MCP ha un solo strumento in sola lettura, `get_guest_replies`. I testi li dà solo se li si chiede, e da lì non si approva né si invia niente.

## Rischi e regole delle piattaforme

- **Airbnb**: i Termini (§11.1) vietano bot, crawler, scraper e altri mezzi automatici per accedere alla piattaforma o raccoglierne i dati. Fairhello non tocca mai il sito o l'app: legge e scrive solo tramite Smoobu e Beds24, che sono partner software collegati ufficialmente. L'API diretta di Airbnb è riservata ai partner.
- **Booking.com**: la Messaging API è riservata ai Connectivity Partner certificati. La strada per l'host passa dal gestionale.
- **AI Act, articolo 50** (in vigore dal 2 agosto 2026): chi interagisce direttamente con un sistema AI deve saperlo. Con l'approvazione dell'host su ogni bozza, il messaggio è dell'host. È una nostra lettura, non c'è ancora una guida ufficiale su questo caso. Se l'ospite chiede se risponde un bot, l'assistente non lo nega.
- **Errori dell'AI**: approvazione obbligatoria, niente prezzi, codici solo durante il soggiorno, risposte limitate alla scheda della casa. I messaggi su soldi, reclami, cancellazioni ed emergenze sono segnalati all'host.

## File nella cartella dell'host

| File | Cosa contiene |
|---|---|
| `fairhello.json` | modello, firma, giorni di conservazione, bozze per lettura |
| `fairhello-credentials.json` | la chiave Anthropic (leggibile solo dall'utente; mai nel repo, gitleaks la blocca) |
| `casa/<annuncio>.md` | la scheda della casa scritta dall'host |
| `data/fairnight.db` | messaggi e bozze (tabelle `hello_*`, schema 7) |

## Cosa è stato riusato

Il controllo di freschezza delle bozze, il collegamento tra il nome di una struttura e la casa (qui serve solo a suggerire, mai a scegliere da solo), la pulizia del markdown e la forma della scheda della casa (sezioni libere, codici a parte) vengono da un nostro progetto precedente. Sono stati riscritti senza nessun dato reale, per girare in locale: niente Next.js, niente Vercel, niente server.
