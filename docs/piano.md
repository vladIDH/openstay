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
Documenti in `docs/`, repo locale, licenza.

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

### Fase 3: mercato e analisi (circa 18 giorni, dopo le risposte scritte dei fornitori)

| Pezzo | Giorni |
|---|---|
| Adattatore AirROI opzionale (chiave dell'utente, attribuzione, cache limitata) | 3 |
| Scaricatore Inside Airbnb opzionale (solo città coperte) | 1,5 |
| Suggeritore del prezzo base (storico + percentili della zona) | 2 |
| Pagina della zona (fasce di prezzo, occupazione futura) | 3 |
| Soggiorno minimo calcolato | 3,5 |
| Previsione della domanda | 5 |

**Totale fino alla fase 3: circa 49 giorni di lavoro.** La 0.1 pubblica esce dopo circa 13.

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

- Nessuno scraping di Airbnb, Booking o PriceLabs, mai.
- Nessun dato reale di host o ospiti nel repo.
- Nessun nome di funzioni di PriceLabs nel codice o nei testi del prodotto.
- Le fonti di mercato sono solo adattatori opzionali, con la chiave o il file dell'utente.
