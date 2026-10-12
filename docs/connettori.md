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
