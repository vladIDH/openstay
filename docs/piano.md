# Piano di Fairnight

## Obiettivo della 0.1

Un host con 1–20 annunci installa Fairnight in 5 minuti. Incolla i link iCal di Airbnb e Booking, imposta base, minimo e massimo, e ottiene:
- un **calendario web con il prezzo e il soggiorno minimo per ogni notte**, con la spiegazione di ogni prezzo;
- un **export CSV** da caricare sui portali o nel gestionale;
- un **server MCP in sola lettura** per chiedere a Claude o ChatGPT «quanto costa il ponte?».

Niente dati di mercato, niente scraping, niente account da creare.

## Struttura del repo

Un solo pacchetto npm, perché l'installazione deve essere una riga. Dentro, le cartelle sono separate così che il motore resti una libreria pura.

```
fairnight/
├── src/
│   ├── core/            # motore PURO: niente database, niente rete
│   │   ├── factors/     # un file per fattore (stagione, giorno, anticipo, buchi, occupazione, eventi…)
│   │   ├── pipeline.ts  # applica i fattori in ordine → prezzo + soggiorno minimo + spiegazione
│   │   └── defaults.ts  # valori predefiniti versionati
│   ├── ingest/          # lettura dei calendari iCal, import CSV di prezzi ed eventi
│   ├── store/           # SQLite locale (un file in ./data)
│   ├── export/          # CSV; poi i connettori (smoobu, beds24…)
│   ├── web/             # piccolo server + pagina calendario (HTML statico, niente framework pesanti)
│   ├── mcp/             # server MCP (stdio), in sola lettura nella 0.1
│   └── cli.ts           # fairnight init | sync | price | serve | export | mcp
├── examples/            # configurazione d'esempio, eventi d'esempio con dati inventati
├── test/                # test del motore su casi costruiti a mano
├── docs/
├── LICENSE              # AGPL-3.0
└── README.md
```

**Installazione in 5 minuti:**

```
npx fairnight init      # domande: link iCal, prezzo base, minimo, massimo → crea fairnight.config.yaml
npx fairnight serve     # legge i calendari, calcola 365 notti, apre http://localhost:4321
```

È prevista anche un'immagine Docker con una riga sola, e `fairnight mcp` da aggiungere alla configurazione di Claude Desktop.

**Scelte tecniche:**
- TypeScript su Node 20+;
- SQLite incluso (nessun database da installare);
- configurazione in YAML leggibile;
- il motore non accede né al database né alla rete, quindi ogni prezzo è riproducibile.

## Fasi

### Fase 0: mappa e impianto (fatta, 12 ottobre 2026)
Documenti in `docs/` (la mappa delle funzioni è in [mappa-funzioni.md](mappa-funzioni.md)), repo locale, licenza.

### Fase 1: motore base e versione 0.1 pubblica (circa 13 giorni di lavoro)

| Pezzo | Giorni |
|---|---|
| Catena dei fattori e spiegazione notte per notte | 1 |
| Fattori di prezzo: partenza, pavimento e tetto, pavimento storico, arrotondamento, stagioni dell'host, curva stagionale dallo storico, giorno della settimana e weekend | 1,5 |
| Fattori di anticipo e calendario: sconto a ridosso, ricarico per date lontane, calendario fermo, buchi, ritocco per occupazione, eccezioni per data, eventi dell'host | 2 |
| Soggiorno minimo: predefinito, per anticipo, soglia, buchi, ordine di precedenza | 1 |
| Lettura iCal (scritta da zero) e import CSV di prezzi ed eventi (parser riusato) | 1,5 |
| Archivio SQLite e configurazione YAML | 1 |
| Comandi `init`, `sync`, `price`, `export` | 1 |
| **Pagina calendario** con prezzo, minimo, stato della notte e spiegazione al clic | 2 |
| **Server MCP in sola lettura**: prezzi di un periodo, perché di un prezzo, notti libere, buchi, occupazione | 1 |
| Test, README, guida rapida, esempi, pubblicazione su npm e GitHub | 1 |

### Fase 2: regole avanzate e connettori (circa 18 giorni)

| Pezzo | Giorni |
|---|---|
| Connettore **Smoobu** (firma HMAC, invio di prezzo e minimo, prova su un appartamento finto) | 2,5 |
| Connettore **Beds24** | 2 |
| Invio programmato e registro degli invii | 1 |
| Regole a livelli (portafoglio, gruppo, annuncio), pacchetti di regole, anteprima | 3 |
| Sconti per durata, supplemento per ospite in più, giorni di arrivo e partenza, ritocchi accanto alle prenotazioni | 1,5 |
| Avvisi per mail o webhook (calendario fermo, buco creato, prezzo al pavimento, invio fallito) | 1,5 |
| Import delle prenotazioni con importi, indicatori del portafoglio, ritmo rispetto all'anno prima, obiettivi | 3,5 |
| **Prova su un anno passato** (backtest) | 2 |
| API locale e MCP con scrittura, sempre con conferma | 1 |

**Stanze con più unità identiche: fatto (ramo `hotel`, 14 ottobre 2026).** Il motore conta le camere di ogni notte (`units` nell'annuncio), l'occupazione è in camere-notte, i buchi stanno fra notti tutto esaurito, e c'è il fattore «poche camere rimaste» (spento di default, tetto +20%). Beds24 importa le stanze con `qty` > 1, Smoobu unisce più appartamenti in una tipologia, l'iCal va per camera. Vedi [piccoli-hotel.md](piccoli-hotel.md). Resta fuori: i buchi di una sola camera (spostare gli ospiti fra le camere è il lavoro del gestionale).

**Pagina del calendario in tre lingue: fatto (ramo `lingue`, 14 ottobre 2026).** Italiano, spagnolo e inglese, con `language` nel config e un selettore nella pagina; le regole sono dette dai `params` del motore. **Lavoro futuro: tradurre i messaggi del terminale di `fairnight serve`** (oggi in inglese; quelli di `apri` e `configura` sono già in italiano).

### Fase 3: mercato e analisi (circa 18 giorni, dopo le risposte scritte dei fornitori)

| Pezzo | Giorni |
|---|---|
| Adattatore AirROI opzionale (chiave dell'utente, attribuzione, cache limitata) | 3 |
| Scaricatore Inside Airbnb opzionale (solo città coperte) | 1,5 |
| Suggeritore del prezzo base (storico + percentili della zona) | 2 |
| Pagina della zona (fasce di prezzo, occupazione futura) | 3 |
| Soggiorno minimo calcolato | 3,5 |
| Previsione della domanda | 5 |

**Anticipato sul ramo `mercato` (13 ottobre 2026):**
- il fattore «domanda di zona» nel motore, spento di default;
- l'import del CSV dell'host e dei file Inside Airbnb scaricati dall'utente (al posto dello «scaricatore»: nel codice non ce n'è);
- l'adattatore AirROI, acceso il 15 ottobre 2026 con l'accordo di AirROI (ramo `airroi-acceso`, vedi `fonti-mercato.md`);
- i comandi `fairnight mercato importa | collega | stato | cancella` e il tool MCP `get_market_area`.

**Totale fino alla fase 3: circa 49 giorni di lavoro.** La 0.1 pubblica esce dopo circa 13.

### Fairhello: risposte agli ospiti (ramo `fairhello`, 15 ottobre 2026)

Guida: `risposte-ospiti.md`.

**Nella 0.1:**
- messaggi letti e inviati tramite le API ufficiali di Smoobu e Beds24, con le chiavi dell'host;
- bozze scritte da Claude Haiku, con la chiave dell'host, oppure da un modello locale via Ollama;
- ogni risposta approvata dall'host, dalla pagina `/risposte` o con `fairnight risposte invia --applica`;
- scheda della casa in `casa/<annuncio>.md`;
- tool MCP in sola lettura `get_guest_replies`.

**Versioni successive:**
- **Lettura delle mail di Airbnb e Booking.com** (IMAP in sola lettura). I modelli di mail vanno riconosciuti in più lingue. La risposta via mail non è documentata dalle piattaforme: senza una fonte ufficiale resta solo la lettura.
- **Invio automatico**, spento di default, solo per categorie sicure (wifi, orari, indicazioni), mai per soldi, sconti, rimborsi, reclami o codici d'accesso. Va deciso con l'host.
- Altri gestionali con un'API messaggi ufficiale.
- Un modello OpenAI con la chiave dell'host, se richiesto. Il piano gratuito di Gemini resta escluso, perché usa i dati per migliorare i prodotti di Google.

## Cosa esce nella 0.1 pubblica

- Il motore con tutti i fattori della fase 1, ognuno spiegato notte per notte, con valori predefiniti documentati.
- La lettura dei calendari iCal di Airbnb, Booking e di qualsiasi gestionale che li esporta.
- L'import CSV dello storico prezzi e del calendario eventi.
- La pagina calendario locale.
- L'export CSV.
- Il server MCP in sola lettura.
- La guida rapida in italiano, inglese e spagnolo.
- Esempi solo con dati inventati.

**Non c'è nella 0.1:** connettori che scrivono, dati di mercato, account, servizio ospitato.

## Regole fisse del progetto

- Nessuno scraping di nessun sito, mai.
- Nessun dato reale di host o ospiti nel repo.
- Nessun nome di prodotti o funzioni di altri software di prezzi nel codice o nei testi del prodotto.
- Le fonti di mercato sono solo adattatori opzionali, con la chiave o il file dell'utente.
- AirROI è usato con l'accordo di AirROI (15 ottobre 2026): sempre con la chiave dell'host, sempre con «Powered by AirROI» e il link a https://www.airroi.com dove compare un dato (vedi `fonti-mercato.md`).

## Versioni dello schema del database

Ogni ramo che cambia `packages/fairnight-cli/src/db.ts` alza `SCHEMA_VERSION` di uno e aggiunge il suo passo in `MIGRATIONS`, nell'ordine in cui entra in main.

| Versione | Cosa | Stato |
|---|---|---|
| 1–6 | calendari, Smoobu, Beds24, zone, Fairguest, piccoli hotel | in main |
| 7 | Fairhello: tabelle `hello_*` | in main (merge della PR #12, 15 ottobre 2026) |
| 8 | Fairguest Italia: riconoscimento degli ospiti, ricevute | in main (PR #9) |
| 9 | link di check-in: la casella del relay | in main (PR #13) |
| 10 | Istat: record statistico sigillato | in main (PR #14) |
| 11 | tassa di soggiorno e pagamenti: classe dell'ospite per la tassa, conteggi, pagamenti | in main (PR #18) |

Il pilota automatico (`pilota`) aggiunge solo tabelle nuove (`pilot_runs`, `pilot_changes`, `pilot_state`) con `CREATE TABLE IF NOT EXISTS`, create all'apertura del database: per scelta non prende un numero di schema.

Chi rinumera aggiorna anche `test/db.test.ts`: la versione attesa e un fixture `schema-<n-1>.sql` con lo schema esatto della versione precedente.
