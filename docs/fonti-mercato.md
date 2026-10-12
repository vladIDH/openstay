# Fonti di dati di mercato

Abbiamo letto solo le pagine dei due fornitori, il 12 ottobre 2026. Nessuna pagina di Airbnb, nessuna iscrizione, nessuna chiamata a pagamento. **Non è un parere legale:** i punti segnati «da chiarire» vanno confermati per iscritto dal fornitore.

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
| Conservazione | §10, §18, §32 | Non si conservano dati oltre l'«uso immediato». Si cancella tutto a fine rapporto o su richiesta |
| Concorrenza | §5.4(ii), §10 | Vietato usare i dati per prodotti che fanno concorrenza al servizio. **AirROI vende prezzi consigliati** (endpoint per il prezzo base e per i prezzi del calendario) |
| Opere derivate e metodo | §5.7, §5.4(iv) | Vietate le opere derivate senza permesso scritto. Vietato risalire al loro metodo |
| Provenienza dei dati | — | Non dichiarata. Nessuna garanzia o manleva per chi usa i dati |
| Legge applicabile | §20–21 | California, arbitrato a San Mateo |

### Copertura e costi

- Dichiarano oltre 20 milioni di annunci in più di 190 paesi.
- Hanno pagine di mercato per Santa Cruz de Tenerife, ma due pagine danno numeri molto diversi (862 contro 247 annunci attivi). La qualità del dato va verificata.
- Non c'è un piano gratuito: si paga a chiamata. Prezzo consigliato 0,10 $, calendario dal vivo 0,20 $, metriche di mercato 0,10 $ l'una. La ricarica minima è di 10 $.
- Una pagina parla di 10 $ di crediti iniziali, l'altra no: **da chiarire**.
- Limite di 1.000 richieste al minuto.

### Uso nel progetto open source (AGPL)

| Modo | Si può? |
|---|---|
| Adattatore che chiama l'API con la **chiave dell'utente** e non salva dati nel repo | **Plausibilmente sì.** Il contratto è tra l'utente e AirROI. Va detto chiaramente nel README e nella configurazione |
| Dati di esempio nel repo | **No** (§5.4(i), §10) |
| Statistiche aggregate incluse nel repo | **Da chiarire**: forse rientrano nell'eccezione §5.10 con l'avviso, ma la §5.7 (opere derivate) le complica |
| Cache locale di tariffe e calendari per il calcolo | **Da chiarire**: «uso immediato» non dice quanto si può tenere |

### Uso in un servizio ospitato a pagamento

**Rischio alto.** Un servizio che fissa i prezzi agli host fa proprio quello che vende AirROI, quindi ricade con buona probabilità nelle clausole sulla concorrenza (§5.4(ii), §10). In più la cache è limitata e non ci sono garanzie sulla provenienza dei dati. Si usa solo con un **accordo scritto** che autorizzi:
- l'uso nei prezzi notte per notte;
- una cache con una durata definita;
- l'esclusione esplicita della clausola sulla concorrenza.

## Inside Airbnb

Fonti: [insideairbnb.com/data-policies](https://insideairbnb.com/data-policies), [insideairbnb.com/get-the-data](https://insideairbnb.com/get-the-data/).

| Tema | Sintesi |
|---|---|
| Licenza | **Contraddittoria.** La pagina dei dati dichiara Creative Commons Attribution 4.0, ma in fondo alla stessa pagina c'è un badge CC0 (rinuncia a tutti i diritti). **Da chiarire** quale vale |
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

## Conclusione

1. **La fase 1 non usa fonti di mercato.** Fairnight funziona solo con i dati dell'host: calendari, storico, eventi caricati da lui. È la scelta più sicura e anche il nostro tratto distintivo.
2. **Nel codice open source** ogni fonte di mercato entra come **adattatore opzionale**, con la chiave o il file dell'utente, senza dati nel repo e con l'attribuzione mostrata in interfaccia. AirROI è il primo candidato, Inside Airbnb il secondo (solo dove ha copertura).
3. **Per un servizio ospitato a pagamento** nessuna delle due fonti è usabile così com'è. Serve un accordo scritto con AirROI, oppure dati di mercato aggregati costruiti con il consenso degli host che usano il servizio. Questa seconda strada va progettata a parte.

## Domande da mandare per iscritto

1. AirROI: un servizio di prezzi dinamici per host è un uso commerciale ammesso o un prodotto concorrente?
2. AirROI: per quanto tempo si possono tenere in cache tariffe e calendari?
3. AirROI: statistiche aggregate in un repo AGPL pubblico rientrano nella §5.10? Che testo deve avere l'avviso?
4. AirROI: i 10 $ di crediti iniziali esistono? Quale delle due pagine di Tenerife è corretta?
5. Inside Airbnb: vale CC BY 4.0 o CC0? Il «non ripubblicare» è vincolante? L'uso per i prezzi degli host è accettato?
6. Inside Airbnb: si può commissionare Tenerife o le Canarie, e a che costo?
