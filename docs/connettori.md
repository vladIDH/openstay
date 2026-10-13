# Connettori ai gestionali: chi permette di scrivere le tariffe

Verifica fatta il 12 ottobre 2026 solo sulla documentazione pubblica: nessuna iscrizione, nessuna chiamata con chiavi. **[NV]** = non verificato su fonte ufficiale.

| Gestionale | Endpoint prezzo per notte | Soggiorno minimo | Accesso | Limiti | Prova gratuita | Fonte |
|---|---|---|---|---|---|---|
| **Smoobu** | `POST /api/rates`: elenco di appartamenti e operazioni con date (singole o intervalli) e prezzo giornaliero | sì, nella stessa chiamata (solo su date che hanno già un prezzo) | **chiave del cliente** (Impostazioni → Avanzate → API Keys, firma HMAC). OAuth solo per i partner | 700 richieste/min. API completa solo sul piano **Professional**. **Le chiavi vecchie smettono di funzionare il 31 ottobre 2026**: va usata HMAC | prova di 14 giorni, ma **durante la prova non si genera la chiave** (va chiesta al supporto). Niente sandbox | docs.smoobu.com |
| **Beds24** | `POST /inventory/rooms/calendar` (API v2), più `/inventory/fixedPrices` | sì, per data (nomi dei campi nella Swagger **[NV]**) | **chiave del cliente** con codice invito (Impostazioni → Marketplace → API), poi token rinnovabile | 100 crediti ogni 5 minuti per account (200 a 10 €/mese). Ogni chiamata costa crediti in base alla complessità | niente sandbox, uno staging non uguale alla produzione | wiki.beds24.com/index.php/API_V2.0 |
| **Hostaway** | calendario per annuncio, singolo e in blocco **[NV: path da fonti esterne]** | sì, per data, fino a 200 giorni | **chiave del cliente** (Account ID + segreto, token valido 24 mesi) | 200 richieste ogni 10 s. Prodotto costoso, su preventivo | niente sandbox documentata | api.hostaway.com/documentation |
| **Guesty** | `PUT /v1/availability-pricing/api/calendar/listings/{id}` con intervallo di date e prezzo. Esiste anche per più annunci | sì (`minNights`) | **credenziali del cliente** (Client ID / Secret) | 15/s, 120/min, 5.000/h. **Massimo 5 token al giorno.** Piano Pro costoso | niente sandbox | open-api-docs.guesty.com |
| **Hospitable** | `PUT /v2/properties/{uuid}/calendar` con prezzo per data in centesimi | sì, per data **[NV]**. La tariffa base e quella del weekend non si cambiano via API | **token personale del cliente**. OAuth per i fornitori | serve un piano a pagamento (non Essentials). Limiti non pubblicati | **[NV]** | help.hospitable.com |
| **Lodgify** | salvataggio delle tariffe **[NV, fonte esterna]** | **[NV]** | chiave del cliente (`X-ApiKey`) | piano base escluso o limitato. Un forum di sviluppatori riporta "Permission denied" sulla scrittura delle tariffe | **[NV]** | docs.lodgify.com (la pagina non si apre alla lettura automatica) |
| **Krossbooking** | nessuna API pubblica trovata | – | **passa dal supporto**: anche PriceLabs va attivato da loro | – | – | help.pricelabs.co (guida Kross) |
| **Avantio** | nessuna documentazione pubblica, solo pagine commerciali | – | da partner, a quanto pare **[NV]** | costo 375–650 $/mese (fonte esterna) | – | avantio.com/api-integrations |

Tutti tranne Krossbooking e Avantio hanno un'integrazione con PriceLabs. Quindi l'invio dei prezzi da uno strumento esterno è un caso d'uso supportato.

## Primo connettore proposto: Smoobu

1. **Basta la chiave del cliente**, senza approvazione da partner: l'host la crea e la incolla nella configurazione. È il modello giusto per un'installazione fatta in casa.
2. **È l'endpoint più semplice**: una sola chiamata scrive prezzo e soggiorno minimo su più appartamenti e intervalli di date. Il limite di 700 richieste al minuto è largo.
3. **È diffuso tra i piccoli host** in Germania, Spagna e Italia, e costa poco rispetto a Guesty, Hostaway e Avantio.

**Cose da sapere prima di scrivere codice:**
- va scritto direttamente con firma **HMAC**, perché le chiavi vecchie muoiono il 31 ottobre 2026; lo schema di firma sulle tariffe va verificato;
- serve un account sul piano Professional, o una chiave chiesta al supporto durante la prova;
- non c'è una modalità "solo anteprima", quindi i primi invii vanno su un appartamento di prova;
- Smoobu accetta il minimo di notti solo su date che hanno già un prezzo, quindi prezzo e minimo vanno sempre inviati insieme.

**Secondo connettore: Beds24.** È il più orientato agli sviluppatori (OpenAPI pubblica, attivazione self-service, uno staging), economico e diffuso in Europa. Il limite di crediti però è stretto, e servono invii in blocco.

**Più avanti:**
- Hostaway e Guesty hanno buone API, ma il loro pubblico sono gestori medio-grandi;
- Hospitable serve per gli host USA e Airbnb;
- Lodgify solo dopo aver chiarito piani e permessi;
- **Krossbooking e Avantio sono esclusi**: senza documentazione pubblica non si può fare un connettore open source.

**Sempre disponibile, senza connettore:** export CSV dei prezzi per notte, da caricare a mano su Airbnb e Booking o nel gestionale.

## Smoobu: il connettore (0.2.0, in lavorazione)

Pacchetto `packages/fairnight-smoobu` e comandi `fairnight smoobu …`. Usa solo la documentazione pubblica ufficiale (docs.smoobu.com), letta il 12 ottobre 2026.

**Firma: solo HMAC.** Il connettore usa solo la firma HMAC-SHA256: serve una chiave API creata **con il suo secret**. La vecchia intestazione `Api-Key` smette di funzionare il 31 ottobre 2026 e Fairnight non la usa nemmeno come ripiego.

**Come si ottiene la chiave:**
1. In Smoobu: *Settings → Advanced → API Keys → Create API Key*, poi *Generate Secret*.
2. Copiare subito chiave e secret: Smoobu mostra il secret una volta sola.
3. Poi `fairnight smoobu collega`: li chiede tutti e due senza mostrarli e li prova su Smoobu prima di salvarli.

In alternativa si usano le variabili `SMOOBU_API_KEY` e `SMOOBU_API_SECRET`, che hanno la precedenza sul file.

**Cosa legge:**
- `GET /api/apartments` e `GET /api/apartments/{id}`: alloggi, valuta, prezzo minimo e massimo. Un alloggio nuovo diventa un annuncio, con sorgente `smoobu`.
- `GET /api/reservations`: prenotazioni dagli ultimi 400 giorni in avanti, cancellazioni comprese, 100 per pagina.
  - Le prenotazioni entrano nelle stesse tabelle degli iCal.
  - Le date bloccate (`is-blocked-booking`) entrano come indisponibili, non come prenotazioni.
  - Le cancellazioni sono segnate come tolte, mai cancellate.
- `GET /api/rates`: prezzo, minimo di notti e disponibilità per giorno, per confrontarli con Fairnight.

**Cosa scrive:**
- Solo `POST /api/rates`, con prezzo e minimo di notti **sempre insieme**: Smoobu rifiuta un minimo su una data senza prezzo («Price is required»).
- **Mai di default.** `fairnight smoobu spingi` mostra la tabella delle differenze; solo `--applica` scrive.
- Dopo la scrittura rilegge da Smoobu e controlla notte per notte.
- Ogni invio resta registrato nel database (`smoobu_pushes`).

**Limiti trovati nella documentazione:**
- 700 richieste al minuto (abbassate da 1.000 il 17 settembre 2026). Fairnight si ferma a **300**.
- Il 429 porta `X-RateLimit-Retry-After`, che nonostante il nome è l'ora (Unix) in cui finisce la finestra. Fairnight aspetta fino a quell'ora più un secondo.
- I 5xx senza messaggio vengono ritentati dopo 1, 2, 4 e 8 secondi.
- Gli errori di validazione arrivano come **HTTP 500 con `detail`**: non vengono ritentati, Fairnight si ferma e mostra il messaggio.
- Su 401, 403, 404 e rete assente Fairnight si ferma e spiega cosa controllare. Su 401 controllare chiave e secret, e l'orologio: Smoobu accetta 5 minuti di scarto.
- Non è documentato un massimo di date per chiamata: Fairnight manda al massimo 50 operazioni per richiesta.
- Non è documentato un piano necessario per l'API.

**Fine degli intervalli «da:a» (non documentata).** La documentazione accetta date singole e intervalli `2026-11-03:2026-11-07`, ma non dice se l'ultimo giorno è incluso. Quindi:
- finché non è verificato, Fairnight scrive **una notte per operazione**;
- al primo `spingi --applica` vero scrive una sola operazione di 2 notti uguali, rilegge con `GET /api/rates` e controlla se la seconda notte è stata scritta;
- registra il risultato nel database (`meta.smoobu_range_end`, con la data) e lo stampa;
- se l'ultimo giorno è incluso, da lì in poi raggruppa le notti consecutive uguali in intervalli di **massimo 7 notti**, un'operazione per intervallo.

**Risultato della verifica: non ancora fatta.** Non abbiamo un account Smoobu su cui provarla: va fatta al primo giro vero e scritta qui.

**Prezzi delle prenotazioni:**
- Smoobu dà il **totale del soggiorno**. Fairnight salva totale, notti e prezzo medio per notte (totale / notti).
- È una media per **soggiorno**, non il prezzo di ogni notte: per questo il pavimento storico la usa solo con `fairnight price --usa-storico-smoobu`.
- Se per la stessa notte c'è un prezzo importato da CSV, vince quello del CSV.

**Credenziali:**
- Il file `smoobu-credentials.json` sta nella cartella dell'host e ha permessi solo per l'utente (600 su Mac e Linux, ACL dell'utente su Windows).
- È nel `.gitignore` del repo.
- Gitleaks ha due regole dedicate (`.gitleaks.toml`), e un job della CI prova a ogni push che un file o una variabile con la chiave verrebbero presi.
- Chiave e secret non vengono mai stampati, nemmeno troncati, nemmeno negli errori.

## Beds24: il connettore (0.2.0, in lavorazione)

Pacchetto `packages/fairnight-beds24` e comandi `fairnight beds24 …`. Usa solo la documentazione pubblica ufficiale: il wiki (wiki.beds24.com, «API V2.0») e la specifica OpenAPI (`beds24.com/api/v2/apiV2.yaml`), lette il 13 ottobre 2026.

**Mappatura.** Un annuncio Fairnight corrisponde a una **stanza** Beds24 (`roomId`), perché prezzi e minimi in Beds24 sono per stanza. Una proprietà con più stanze diventa più annunci.

**Stanze con più unità identiche (`qty` > 1): non gestite in questa versione.** `importa` le salta e lo dice («4 identical units, not handled in this version»). Il motore oggi ragiona su una casa singola: per gestirle serve un pezzo futuro **del motore, non del connettore**, cioè l'occupazione calcolata come unità prenotate diviso `qty` (vedi `piano.md`).

**Come si ottiene l'accesso:**
1. Nel pannello di Beds24: *Settings → Marketplace → API → Generate invite code*.
2. **I permessi vanno scelti in quel momento e non si possono cambiare dopo:** `read:bookings`, `all:inventory` (lettura e scrittura del calendario), `read:properties`.
3. Il codice invito vale una volta e per 24 ore. `fairnight beds24 collega` lo chiede senza mostrarlo e lo scambia (`GET /authentication/setup`, intestazione `code`) con un **refresh token**.

**Token:**
- Il refresh token dà token brevi (`GET /authentication/token`, intestazione `refreshToken`). La durata è quella di `expiresIn` nella risposta: il wiki dice 24 ore, la specifica mostra 3600 secondi, e Fairnight usa sempre la risposta.
- Il token breve resta nel file con la sua scadenza e si rinnova da solo quando mancano meno di 2 minuti. Se Beds24 risponde 401 a metà giro, viene rinnovato una volta e si continua.
- Il refresh token **scade se non viene usato per 30 giorni**.
- `BEDS24_REFRESH_TOKEN` ha la precedenza sul file `beds24-credentials.json` (permessi solo per l'utente, nel `.gitignore`, con due regole gitleaks dedicate provate dal job della CI).
- Nessun token o codice viene mai stampato.

**Cosa legge:**
- `GET /properties?includeAllRooms=true`: proprietà, stanze, numero di unità, prezzo di listino e prezzo minimo.
- `GET /bookings`: prenotazioni delle stanze collegate, dagli ultimi 400 giorni in avanti, tutte le pagine.
  - `confirmed`, `new` e `request` sono prenotazioni;
  - `black` è una data bloccata (indisponibile, fuori da occupazione e storico);
  - `cancelled` è tolta, anche se era stata importata prima;
  - `inquiry` non viene chiesta.
  - `bookingTime` è la data vera di prenotazione, usata dallo sconto per calendario fermo.
- `GET /inventory/rooms/calendar`: prezzo (nel campo scelto), `minStay`, `numAvail` e `override`, a intervalli `from`/`to` che Fairnight espande notte per notte. `numAvail` 0 o `override: blackout` significano «non disponibile su Beds24»: quella notte non viene toccata.

**Cosa scrive:**
- Solo `POST /inventory/rooms/calendar`, e **solo il campo prezzo scelto** (`price1` di default, `price1`…`price16` per annuncio con `"priceField"`) **e `minStay`**. Mai `numAvail`, `override` o gli altri prezzi.
- **Mai di default.** `fairnight beds24 spingi` mostra la tabella delle differenze; solo `--applica` scrive.
- Un elemento per notte (o per intervallo), tutti nella stessa richiesta per stanza. La risposta 201 ha un esito per elemento: le notti rifiutate vengono elencate con il messaggio di Beds24.
- Dopo la scrittura Fairnight rilegge il calendario e controlla notte per notte. Ogni invio resta nel database (`beds24_pushes`, con i crediti spesi).

**Crediti e limiti (dalla documentazione):**
- **100 crediti ogni 5 minuti per account** (200 a 10 €/mese chiedendo al supporto). Ogni richiesta costa in base alla complessità, e anche chiedere un token costa crediti.
- La specifica chiama le intestazioni `X-FiveMinCreditLimit`, `-Remaining`, `-ResetsIn` e `X-RequestCost`; il wiki le scrive `x-five-min-limit-…`. Fairnight legge entrambe le forme.
- **Il nostro freno:** non scendere mai sotto metà finestra. Se restano meno crediti, aspetta la fine della finestra più un secondo.
- 429 («Usage limit exceeded»): aspetta la fine della finestra più un secondo. I 5xx vengono ritentati dopo 1, 2, 4 e 8 secondi. Su 400 Fairnight si ferma e mostra il messaggio di Beds24; su 403 spiega quali permessi servono.
- A fine comando Fairnight stampa i crediti usati nel giro e quelli rimasti.
- Altri limiti: circa 1 MB per POST, al massimo 10.000 elementi per array.
- Non esiste una sandbox: i test usano un finto server locale con la forma della specifica.

**Fine degli intervalli `from`/`to` in scrittura (non documentata).** L'esempio della specifica va «dal 1° aprile al 1° maggio», ma non dice se l'ultimo giorno è incluso. Quindi:
- finché non è verificato, Fairnight scrive giorni singoli (`from` = `to`);
- al primo `spingi --applica` vero scrive un intervallo di 2 notti uguali, rilegge la seconda notte e salva il risultato (`meta.beds24_range_end`);
- se l'ultimo giorno è incluso, da lì in poi usa intervalli di massimo 7 notti.

**Risultato della verifica: non ancora fatta** (nessun account Beds24 vero su cui provarla). Va scritto qui al primo giro vero.

**Lettura degli intervalli (ipotesi).** In lettura Fairnight considera `to` incluso (es. `from` = `to` = un giorno). La rilettura dopo ogni scrittura farebbe emergere subito un'ipotesi sbagliata come notti «non corrispondenti».
