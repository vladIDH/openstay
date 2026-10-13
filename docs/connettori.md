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
