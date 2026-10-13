# Il motore di partenza (prototipo privato, `lib/pricing`)

Abbiamo riletto solo `lib/pricing/*` di un nostro prototipo privato: `config.ts`, `engine.ts`, `service.ts`, `persistence.ts` e `import.ts`. **Il modulo non ha test**: nessun file in `test/` lo usa. Esiste solo uno script di simulazione a mano. Nessun dato di quel prototipo entra in questo repo.

## Cosa fa oggi

| File | Contenuto | Valutazione |
|---|---|---|
| `config.ts` | Costanti: da impatto dell'evento (1–5) a moltiplicatore (1,00 / 1,05 / 1,12 / 1,25 / 1,40); parole che marcano un evento valido su tutta l'isola (`isola` e il nome dell'isola); arrotondamento all'euro | La buona idea è la configurazione separata dalla logica. Le parole chiave sono legate a una sola zona |
| `engine.ts` | Funzione pura `computeSuggestedPrice(regola, eventi, data)`. Parte dal prezzo base, sceglie fra gli eventi della data **quello con l'impatto più alto** (non li somma), applica il moltiplicatore, limita fra minimo e massimo, arrotonda. Restituisce anche i dati mancanti e una nota leggibile | Struttura giusta (pura, testabile, spiega il risultato), ma usa **un solo fattore**: gli eventi |
| `service.ts` | Legge dal database (Drizzle, sincrono) le regole della casa e gli eventi della data, poi chiama il motore | Legato allo schema del prototipo |
| `persistence.ts` | Salva i prezzi suggeriti, uno per (casa, data), aggiornandoli se la data esiste già | Concetto riusabile, codice legato allo schema |
| `import.ts` | Parser puro di CSV di prezzi: separatori `,` `;` e tab, date in vari formati (giorno prima del mese per gli export europei), prezzi con virgola, punto e simboli di valuta, intestazione riconosciuta da sola, righe scartate con il motivo. La casa viene riconosciuta da una funzione passata dall'esterno | **Il pezzo più maturo**: non dipende da niente |

Piccoli difetti da non portarsi dietro:
- l'arrotondamento avviene dopo i limiti, quindi può superare di poco il massimo se questo non è un numero intero;
- il confronto delle zone per sottostringa dà falsi positivi;
- gli identificativi sono in italiano, mentre il codice pubblico sarà in inglese.

## Cosa si riusa, cosa si riscrive

| Pezzo | Decisione | Note |
|---|---|---|
| Parser CSV dei prezzi (`import.ts`) | **Si riusa**, tradotto in inglese e con i test | Serve all'import dello storico prezzi e del calendario eventi |
| Idea del motore puro con spiegazione | **Si riusa l'idea**, il codice si riscrive | Diventa una catena di fattori: ognuno riceve il contesto della notte e restituisce un ritocco con la sua spiegazione |
| Scala di impatto degli eventi (1–5) | **Si riusa** come valore predefinito configurabile | Gli eventi diventano un file dell'host, senza parole chiave fisse |
| Limiti minimo e massimo | **Si riscrive** | Con il pavimento storico, i limiti per finestra e l'ordine corretto: limiti, poi arrotondamento, poi di nuovo limiti |
| Service e persistence | **Si riscrivono** | Su SQLite nostro, con uno schema pensato per Fairnight |
| Corrispondenza delle zone per sottostringa | **Si butta** | Le zone diventano etichette esplicite in configurazione |

## Cosa manca rispetto alla mappa (`mappa-pricelabs.md`)

Della fase 1 il motore attuale copre solo prezzo di partenza, pavimento e tetto, arrotondamento e un fattore eventi rudimentale. **Manca tutto il resto:**

- stagioni dell'host e curva stagionale ricavata dallo storico;
- peso del giorno della settimana e giorni di weekend;
- sconto a ridosso, ricarico per le date lontane, sconto per calendario fermo;
- prezzo e minimo ridotto sui buchi (notti orfane);
- tutto il soggiorno minimo: predefinito, per anticipo, soglia, ordine di precedenza;
- eccezioni per data;
- ritocco per occupazione;
- pavimento storico;
- lettura dei calendari iCal. Nel prototipo esiste in un altro modulo, che qui non abbiamo riletto: va **scritto da zero**;
- export CSV e pagina calendario;
- server MCP;
- test.

Delle fasi 2 e 3 non c'è nulla: gruppi, profili, connettori, avvisi, analisi, mercato.

**In sintesi:** dal motore attuale si recuperano circa mezza giornata di lavoro (il parser CSV) e l'impostazione. Il resto di Fairnight è codice nuovo.

## Aggiornamento 0.2.0: la data delle prenotazioni per il calendario fermo

Lo sconto per calendario fermo ha bisogno del giorno in cui è arrivata l'ultima prenotazione nuova. Il motore lo riceve come `lastBookingReceived`; la CLI lo calcola così:

- **Sorgente Smoobu:** usa il `created-at` di Smoobu, cioè il giorno vero in cui la prenotazione è stata fatta (colonna `booked_at`).
- **Sorgente Beds24:** usa il `bookingTime` di Beds24, che ha lo stesso significato (colonna `booked_at`).
- **Sorgente iCal:** i calendari non dicono quando una prenotazione è stata fatta. Resta la stima di prima: il giorno in cui `fairnight sync` l'ha vista per la prima volta. Subito dopo il primo sync tutte le prenotazioni sembrano nuove, e lo sconto aspetta.
- **Annuncio con tutte e due le sorgenti:** vale la data più recente fra le due.

Le date bloccate (anche quelle di Smoobu) non contano mai come prenotazioni: non spostano questa data, non entrano nell'occupazione e non entrano nello storico prezzi.
