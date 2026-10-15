# Fonti di dati di mercato

Abbiamo letto solo le pagine dei fornitori, il 12 ottobre 2026, di nuovo il 13 ottobre prima di scrivere gli adattatori e una terza volta il 15 ottobre (AirROI, ISTAC, INE). Nessuna pagina di Airbnb, nessuna iscrizione, nessuna chiamata a pagamento. **Non è un parere legale:** i punti segnati «da chiarire» vanno confermati per iscritto dal fornitore.

## AirROI

Fonti: [airroi.com/tos](https://www.airroi.com/tos) (aggiornati il 10 settembre 2026), [airroi.com/api](https://www.airroi.com/api), [airroi.com/api/pricing](https://www.airroi.com/api/pricing).

### Cosa dicono i termini

| Tema | Clausola | Sintesi |
|---|---|---|
| Licenza | §5.2 | Limitata, non esclusiva, non trasferibile, senza sublicenze, revocabile. Ci sono due regimi: «Commercial» e «Non-Commercial» (§5.5, che vieta qualsiasi uso commerciale, anche dentro prodotti) |
| Uso dell'API | §5.3 | Ammesso per sviluppare e far girare applicazioni integrate con il servizio |
| Uso commerciale | §5.2(a) | Gli esempi sono tutti interni: analisi aziendale, ricerca di mercato, investimenti |
| Ridistribuzione | §5.4(i), §10 | Vietato vendere, concedere in licenza, distribuire o «sfruttare commercialmente» i dati |
| Report verso l'esterno | §5.9 | Serve un'appendice di ridistribuzione, concessa a loro discrezione |
| Eccezione per le piccole aziende | §5.10 | Sotto 1 milione di dollari di ricavi legati ai dati si possono distribuire risultati derivati **aggregati** (per mercato o zona), mai dati grezzi o per singolo annuncio |
| Attribuzione | §5.9(b), §5.10(b), §5.3(c) | Avviso obbligatorio e citazione di AirROI su tutto ciò che contiene dati derivati |
| Conservazione | §10, §18, §32 | Non si conservano dati oltre l'«uso immediato», **al massimo 30 giorni** salvo diverso accordo (§10, letto il 13 ottobre). Si cancella tutto a fine rapporto o su richiesta |
| Chiave | §5.3(b) | La chiave è riservata: si condivide solo con chi lavora per conto del titolare, che risponde di tutto ciò che passa dalla sua chiave |
| Accesso automatico | §6(5) | Vietati bot e script, **tranne** l'accesso all'API previsto e concesso in licenza, nel rispetto dei limiti |
| Uso commerciale | §2, §5.5 | «Commerciale» è l'uso rivolto a un vantaggio economico: un host che fissa i suoi prezzi lo è. Serve la licenza commerciale (l'API a pagamento), non quella non commerciale |
| Open source | — | I termini non ne parlano: nessun divieto esplicito, nessun permesso esplicito |
| Concorrenza | §5.4(ii), §10 | Vietato usare i dati per prodotti che fanno concorrenza al servizio. La §10 è più larga: vieta prodotti che «competes with AirROI or could reasonably be expected to substitute» la loro offerta. **AirROI vende prezzi consigliati** (endpoint per il prezzo base e per i prezzi del calendario): un prezzo base suggerito con i loro dati è il caso più a rischio |
| Autorizzazioni | §5.9 | Solo un documento formale vale: «No other communication — including email correspondence, verbal statements — constitutes such authorization.» Una mail di risposta potrebbe non bastare |
| Opere derivate e metodo | §5.7, §5.4(iv) | Vietate le opere derivate senza permesso scritto. Vietato risalire al loro metodo |
| Provenienza dei dati | — | Non dichiarata. Nessuna garanzia o manleva per chi usa i dati |
| Legge applicabile | §20–21 | California, arbitrato a San Mateo |

### Copertura e costi

- Dichiarano oltre 20 milioni di annunci in più di 190 paesi.
- Hanno pagine di mercato per Santa Cruz de Tenerife, ma due pagine danno numeri molto diversi (862 contro 247 annunci attivi). La qualità del dato va verificata.
- Non c'è un piano gratuito: si paga a chiamata. Al 15 ottobre: tutte le metriche di zona insieme (`/markets/metrics/all`) **0,50 $**, ogni metrica singola 0,10 $, «future pacing» 0,20 $, ricerca del mercato 0,01 $, prezzo base consigliato 0,10 $, calendario dal vivo 0,20 $. La ricarica minima è di 10 $ («starting from just $10»). Il 13 ottobre le metriche complete risultavano a 0,10 $: i prezzi cambiano («Pricing may be adjusted periodically»).
- La pagina dell'API dice «Begin with just $10 in Airbnb API credits» e «Credits never expire»; la pagina dei prezzi non parla di crediti iniziali: **da chiarire**.
- Limite di 1.000 richieste al minuto.

### Uso nel progetto open source (AGPL)

| Modo | Si può? |
|---|---|
| Adattatore che chiama l'API con la **chiave dell'utente** e non salva dati nel repo | **Plausibilmente sì.** Il contratto è tra l'utente e AirROI. Va detto chiaramente nel README e nella configurazione |
| Dati di esempio nel repo | **No** (§5.4(i), §10) |
| Statistiche aggregate incluse nel repo | **Da chiarire**: forse rientrano nell'eccezione §5.10 con l'avviso, ma la §5.7 (opere derivate) le complica |
| Cache locale per il calcolo | **Chiarito in parte**: al massimo 30 giorni (§10). L'adattatore usa questo tetto |

### Uso in un servizio ospitato a pagamento

**Rischio alto.** Un servizio che fissa i prezzi agli host fa proprio quello che vende AirROI, quindi ricade con buona probabilità nelle clausole sulla concorrenza (§5.4(ii), §10). In più la cache è limitata e non ci sono garanzie sulla provenienza dei dati. Si usa solo con un **accordo scritto** che autorizzi:
- l'uso nei prezzi notte per notte;
- una cache con una durata definita;
- l'esclusione esplicita della clausola sulla concorrenza.

## Inside Airbnb

Fonti: [insideairbnb.com/data-policies](https://insideairbnb.com/data-policies), [insideairbnb.com/get-the-data](https://insideairbnb.com/get-the-data/).

| Tema | Sintesi |
|---|---|
| Licenza | **Creative Commons Attribution 4.0 (CC BY 4.0).** Lo dichiara la pagina «Get the data» («This data is licensed under a Creative Commons Attribution 4.0 International License»), riletta il 13 ottobre. Il 12 ottobre avevamo visto anche un badge CC0; il 13 ottobre non l'abbiamo ritrovato, e la pagina «Data policies» non dichiara nessuna licenza. Ci regoliamo su CC BY 4.0, la più restrittiva delle due: attribuzione sempre |
| Regole d'uso | Non ripubblicare i dati, attribuire e citare, non fare scraping del sito, scaricare una volta sola e non a ogni analisi |
| Contrasto | «Non ripubblicare» contrasta con CC BY e CC0, che permettono la ridistribuzione. **Da chiarire** se è un obbligo o una richiesta |
| Uso commerciale | Non trattato esplicitamente. Le richieste di dati storici «fuori dalla missione» possono essere rifiutate o fatte pagare. La missione è a favore della casa e critica verso gli affitti brevi: uno strumento di prezzi per host va contro questo spirito |
| Accesso | Download libero solo degli ultimi 12 mesi (circa un'istantanea a trimestre). Lo storico si chiede ed è valutato caso per caso |
| Copertura | **Canarie assenti** (né Tenerife né Gran Canaria). Spagna: Barcellona, Madrid, Málaga, Mallorca, Menorca, Siviglia, Valencia, Girona, Euskadi. Italia: Milano, Roma, Firenze, Bologna, Napoli, Venezia, Bergamo, Puglia, Sicilia, Trentino |
| Provenienza | Dichiaratamente raccolti dal sito di Airbnb. Dentro un prodotto commerciale espongono a possibili reclami di Airbnb (in UE anche il diritto sulle banche dati). **Da valutare con un legale** |

### Uso nel progetto open source (AGPL)

- Uno script che scarica il file dell'utente una volta e lo tiene in locale, con attribuzione: **sì**.
- Dati grezzi nel repo: **no**.
- Statistiche aggregate citate (per esempio nella documentazione): probabilmente sì sotto CC BY, ma **da chiarire**.

### Uso in un servizio ospitato a pagamento

**Sconsigliato.** Non copre le Canarie, i dati sono istantanee trimestrali, l'uso è contrario alla missione del progetto e la provenienza è da scraping.

## Cosa abbiamo costruito (ramo `mercato`, 13 ottobre 2026)

Tutto è facoltativo e spento finché l'host non lo accende per un annuncio.

- **Motore.** Un fattore «domanda di zona» (`factors.market`) confronta ogni notte della zona con la media della zona stessa. Sposta il prezzo di metà della differenza, al massimo +15% o -10%, e salta le notti misurate su meno di 5 alloggi comparabili. Il motore riceve i dati già letti (`calendar.market`) e non va mai in rete. La spiegazione della notte nomina la fonte con la sua attribuzione.
- **CSV dell'host.** Data, occupazione di zona, prezzo medio, comparabili, per chi ha dati che può usare.
- **Inside Airbnb.** Solo import dei file che l'utente scarica da sé (`calendar.csv.gz`, facoltativo `listings.csv.gz` per i comparabili). Nel codice non c'è nessuno scaricatore. Ogni spiegazione dice «Inside Airbnb (insideairbnb.com), CC BY 4.0». L'occupazione è dichiarata **stimata**, perché `available = f` non distingue una notte prenotata da una chiusa dall'host. Gli alloggi chiusi su tutte le notti si scartano.
- **AirROI.** L'adattatore c'è, ma è **spento** (`market.airroi.enabled: false`) finché AirROI non risponde per iscritto alla domanda n. 1. `fairnight mercato collega` e `importa --fonte airroi` rifiutano con «in attesa di conferma scritta da AirROI sui termini d'uso». Quando sarà acceso:
  - usa la chiave dell'utente, letta prima da `AIRROI_API_KEY` e poi da `airroi-credentials.json`, e mai stampata;
  - chiama solo `GET /markets/search` e `POST /markets/metrics/all` (metriche di zona mensili), mai gli endpoint di prezzo consigliato né i dati per singolo annuncio;
  - mostra «powered by AirROI» in ogni spiegazione;
  - cancella i dati dopo 30 giorni, o su richiesta con `fairnight mercato cancella --fonte airroi`;
  - stampa a ogni import il numero di chiamate, perché sono a pagamento.
- **Mai** scraping di Airbnb, Booking, PriceLabs o altri siti. Nel repo e nei test ci sono solo dati inventati e un finto server AirROI.

**Future pacing:** il 15 ottobre la pagina dell'API elenca il percorso `/markets/metrics/future/pacing` (0,20 $). Non lo usiamo finché AirROI non risponde: è nella domanda n. 1. Per ora ogni notte prende il valore dello stesso mese dell'ultimo anno: è la stagione della zona, non una previsione.

## ISTAC: vivienda vacacional delle Canarie (15 ottobre 2026)

Fonti: [aviso legal ISTAC](https://www.gobiernodecanarias.org/istac/aviso_legal.html), API `datos.canarias.es/api/estadisticas/statistical-resources/v1.0`, metodologia «Estadística experimental de vivienda vacacional».

| Tema | Sintesi |
|---|---|
| Dati | Dataset `C00065A_000062`: tariffa media giornaliera (ADR) delle viviendas vacacionales per comune e mese, per fasce di posti (1–4, 5–8, più di 8, totale). Da 01/2019, ultimo mese 08/2026. Il dataset `C00065A_000061` ha viviendas disponibili e prenotate, posti, permanenza media e ricavi |
| Licenza | «Las presentes condiciones generales permiten la reutilización de los documentos sometidos a ellas para fines comerciales y no comerciales.» Nessuno ShareAlike |
| Obblighi | Citare «Fuente: Instituto Canario de Estadística (ISTAC)» e la data dell'ultimo aggiornamento; non far credere che l'ISTAC sostenga il riuso; non «desnaturalizar el sentido de la información» |
| API | Non modificare i dati e i metadati che l'API dà quando li si presenta; niente richieste ripetute della stessa informazione in poco tempo |
| Provenienza | La metodologia parla di «ficheros capturados de propiedades ofertadas en las principales plataformas digitales». Chi cattura i file non è dichiarato. Per noi conta che sia una statistica pubblica con licenza di riuso pubblica |
| Definizioni | Solo alloggi interi. ADR = «ingresos medios diarios obtenidos por vivienda vacacional ocupada». Una casa è «disponible» se prenotata almeno una volta nel mese o nel mese prima: per questo il tasso di case prenotate sta intorno al 95% e non lo usiamo |

**Uso in Fairnight:** `fairnight mercato importa --fonte istac --zona <nome> --comune <codice INE> [--ospiti N]`. Una chiamata CSV per comune, senza chiave. Ogni notte prende l'ADR dello stesso mese più recente; la spiegazione dice «Fuente: Instituto Canario de Estadística (ISTAC), data up to AAAA-MM». Il prezzo base suggerito è una nostra elaborazione e lo dice («median of…»).

Codici dei comuni turistici più frequenti (verificati sull'API ISTAC il 15 ottobre): Tenerife `38001` Adeje, `38006` Arona, `38017` Granadilla de Abona, `38019` Guía de Isora, `38028` Puerto de la Cruz, `38035` San Miguel de Abona, `38040` Santiago del Teide; Gran Canaria `35019` San Bartolomé de Tirajana, `35012` Mogán; Lanzarote `35034` Yaiza, `35028` Tías, `35024` Teguise; Fuerteventura `35015` Pájara, `35014` La Oliva.

## INE: apartamentos turísticos (15 ottobre 2026), spento

Fonti: [aviso legal INE](https://www.ine.es/dyngs/AYU/index.htm?cid=125), tabella 2083 di `servicios.ine.es/wstempus` («Plazas, apartamentos, grados de ocupación y personal empleado por puntos turísticos»).

- Il testo dell'aviso legal: «La licencia de uso general a aplicar a la información estadística de este sitio web, salvo que se indique lo contrario, es la Creative Commons Reconocimiento 4.0 (CC BY 4.0)», riuso «comercial o no comercial», citando «Elaboración propia con datos extraídos del sitio web del INE: www.ine.es».
- Il piè di pagina dello stesso sito: «Este sitio web y su contenido están bajo licencia CC BY-SA 4.0» (il link però porta a CC BY 4.0).
- I record di datos.gob.es per la tabella rimandano solo all'aviso legal.

**Decisione:** le due frasi ufficiali si contraddicono, quindi l'adattatore c'è ma è **spento** (`market.ine.enabled` assente o false: `mercato importa --fonte ine` rifiuta senza chiamare). Si accende dopo una conferma scritta dell'INE che vale CC BY 4.0 per i dati statistici. Serve solo come stagione di zona: sono appartamenti turistici registrati, non case vacanza, e non c'è prezzo.

## Prezzo base suggerito (15 ottobre 2026)

- **Calcolo** (`suggestBasePrice` nel motore, fuori dal calcolo delle notti): notti con prezzo medio e almeno 5 comparabili, raggruppate per mese; ultimi 12 mesi con dati; suggerimento = **mediana** delle medie mensili, arrotondata. Con meno di 6 mesi nessun suggerimento, e si dice perché.
- **Comparabili:** zona dell'annuncio; camere, ospiti, tipo e quartiere come scelti all'import (Inside Airbnb filtra davvero, il CSV lo dichiara, ISTAC usa la fascia di posti). L'annuncio può dire `guests`.
- **Avvisi:** dati di tutta la zona; ospiti diversi; sotto il minimo o sopra il massimo; differenza oltre il 30%.
- **Conferma:** non cambia mai da solo. `fairnight mercato prezzo-base --listing <nome> --applica`, oppure «Usa questo prezzo» con conferma nella pagina, solo dal computer dove gira Fairnight e solo per la cifra mostrata. La configurazione precedente resta in `fairnight.config.json.bak`.
- **Fonti:** CSV dell'host, Inside Airbnb, ISTAC. AirROI solo se la risposta scritta lo permette in modo esplicito.

## Conclusione

1. **La fase 1 non usa fonti di mercato.** Fairnight funziona solo con i dati dell'host: calendari, storico, eventi caricati da lui. È la scelta più sicura e anche il nostro tratto distintivo.
2. **Nel codice open source** ogni fonte di mercato entra come **adattatore opzionale**, con la chiave o il file dell'utente, senza dati nel repo e con l'attribuzione mostrata in interfaccia. AirROI è il primo candidato, Inside Airbnb il secondo (solo dove ha copertura).
3. **Per un servizio ospitato a pagamento** nessuna delle due fonti è usabile così com'è. Serve un accordo scritto con AirROI, oppure dati di mercato aggregati costruiti con il consenso degli host che usano il servizio. Questa seconda strada va progettata a parte.

## Domanda n. 1 ad AirROI: testo da mandare

Mittente: Vlad, da hello@khlumen.com. Destinatario: **admin@airroi.com**, l'unico indirizzo sulla loro pagina [contatti](https://www.airroi.com/contact) e nei termini (verificato il 15 ottobre; support@airroi.com veniva da una scheda esterna). Il 15 ottobre il testo è pronto come bozza in Gmail, con due aggiunte: la domanda sul prezzo base suggerito e il future pacing, e la richiesta di una conferma scritta formale (§5.9).

> **Subject:** Terms of use question: open-source pricing tool using each host's own AirROI API key
>
> Hello AirROI team,
>
> I am Vlad Humenny, the developer of Fairnight, an open-source (AGPL-3.0) tool that helps short-term rental hosts set the nightly prices of their own listings. Fairnight runs on the host's own computer. There is no hosted service and no Fairnight account.
>
> We would like to offer an optional AirROI adapter, and before switching it on we want to be sure it fits your Terms of Use (version of 10 September 2026). This is how it would work:
>
> 1. **The host's own key.** Each host buys their own AirROI API access and enters their own key. We have no key, we never see theirs, and nothing goes through a server of ours: requests go straight from the host's computer to api.airroi.com.
> 2. **Zone metrics only.** The adapter calls only `GET /markets/search`, `POST /markets/metrics/all` and, if you agree, `/markets/metrics/future/pacing`, to read the occupancy, average daily rate and active listings of the host's market, filtered by bedrooms and room type. It never calls your price recommendation endpoints and never reads listing-level data.
> 3. **The host's own pricing.** The figures are used only on the host's computer, as one input among others (their own calendars and past prices), to adjust the prices of the host's own listings. Fairnight may also show the host a suggested base price derived from the zone's average daily rate for similar homes, which the host must confirm by hand. Nothing is resold, published or shared with anyone.
> 4. **Retention and attribution.** Data is kept for at most 30 days (your §10) and deleted on request. Wherever a figure is shown, the tool says "powered by AirROI".
> 5. **Open source, but no data in it.** The public repository contains only the adapter's code and invented test data: no AirROI data and no key.
>
> Our questions:
>
> - Is this use permitted by your Terms, in particular §5.4(ii) and §10 on competing products, given that the tool sets prices only for the host's own listings and never uses your price recommendations?
> - Does a suggested base price computed by Fairnight from your zone metrics (point 3) count as a product that "could reasonably be expected to substitute" for your base price recommendation? If so, we will leave that part out.
> - If it is permitted, may we say so in our documentation (for example "used with AirROI's agreement")? We understand from §5.9 that only a written document counts, so a short written confirmation would be ideal.
> - Is the 30-day limit of §10 the right retention for this use, or would you prefer a shorter one?
> - Is there an attribution text or logo you would like us to show instead of "powered by AirROI"?
>
> We will keep the adapter switched off until we have your written answer. Thank you for your time.
>
> Best regards,
> Vlad Humenny
> Fairnight (OpenStay project), hello@khlumen.com

## Domande da mandare per iscritto

1. AirROI: un servizio di prezzi dinamici per host è un uso commerciale ammesso o un prodotto concorrente?
2. AirROI: per quanto tempo si possono tenere in cache tariffe e calendari?
3. AirROI: statistiche aggregate in un repo AGPL pubblico rientrano nella §5.10? Che testo deve avere l'avviso?
4. AirROI: i 10 $ di crediti iniziali esistono? Quale delle due pagine di Tenerife è corretta?
5. Inside Airbnb: vale CC BY 4.0 o CC0? Il «non ripubblicare» è vincolante? L'uso per i prezzi degli host è accettato?
6. Inside Airbnb: si può commissionare Tenerife o le Canarie, e a che costo?
