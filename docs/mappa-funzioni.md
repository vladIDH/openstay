# Mappa delle funzioni di un motore di prezzi

Le funzioni che un motore di prezzi dinamici per affitti brevi di solito offre, e lo stato di ciascuna in Fairnight.

- **Solo dati dell'host**: la funzione si fa con i soli dati dell'host? Sono i calendari iCal, lo storico dei prezzi e le prenotazioni importate.
- **Fase**:
  - 1 = motore base con i soli dati propri;
  - 2 = regole avanzate, gruppi e connettori;
  - 3 = dati di mercato e analisi.
- **Stato**: «fatto» vuol dire che c'è nel codice di `main`; «da fare» vuol dire che è nel piano ma non c'è ancora.

## 1. Prezzo base e limiti

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Prezzo di partenza | Il prezzo della notte "media", su cui agiscono tutti i fattori | prezzo deciso dall'host | sì | 1 | fatto (`basePrice`) |
| Pavimento e tetto | Limiti rigidi al prezzo finale | prezzo di partenza | sì | 1 | fatto |
| Pavimento storico | Non scende sotto una quota del prezzo venduto nello stesso periodo dell'anno prima | storico prezzi e prenotazioni | sì | 1 | fatto, spento di default: una quota della media venduta nello stesso mese dell'anno prima |
| Suggeritore del prezzo base | Propone il prezzo di partenza dal rendimento passato o dai dati della zona | storico, comparabili | parziale | 3 | fatto dai dati di zona (`fairnight mercato prezzo-base`), mai applicato da solo. Dallo storico dell'host: da fare |
| Pavimenti per finestra | Pavimento diverso per il weekend o per le date lontane | regole | sì | 2 | da fare |
| Arrotondamento | Prezzi a un passo scelto (1, 5, 10…) | – | sì | 1 | fatto, senza mai uscire da pavimento e tetto |
| Ritocco finale | Correzione fissa o in % applicata per ultima | – | sì | 2 | da fare |

## 2. Stagionalità e giorno della settimana

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Stagioni dell'host | Periodi dell'anno con un moltiplicatore o un prezzo fisso | calendario | sì | 1 | fatto |
| Curva stagionale | Il prezzo segue l'andamento dell'anno | storico ≥ 12 mesi, o comparabili per gli annunci nuovi | parziale | 1 (dallo storico) / 3 | dallo storico: da fare. Dai dati di zona: il fattore «domanda di zona» usa la stagione della zona (per esempio ISTAC) |
| Intensità stagionale | Quanto pesa la curva stagionale | – | sì | 2 | da fare |
| Peso del giorno della settimana | Una percentuale per ogni giorno | – | sì | 1 | fatto |
| Giorni di weekend | L'host sceglie quali notti contano come weekend | – | sì | 1 | coperto dal peso per giorno della settimana |
| Livellamento | Stesso prezzo su un intero periodo (per esempio una settimana) | – | sì | 2 | da fare |

## 3. Ultimo minuto e date lontane

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Sconto a ridosso | Sconto che cresce man mano che la data si avvicina | data | sì (gradini fissi) | 1 | fatto, a gradini |
| Ricarico per le date lontane | Ricarico sulle date molto lontane | data | sì (gradini fissi) | 1 | fatto, a gradini |
| Sconto per calendario fermo | Sconto sulle prossime notti se da giorni non entra nessuna prenotazione | prenotazioni con data di creazione | parziale (l'iCal non ha la data di prenotazione: la si stima dalla comparsa nel feed) | 1 | fatto, spento di default. Data vera da Smoobu e Beds24, stimata dall'iCal |

## 4. Notti orfane e buchi di calendario

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Prezzo sui buchi | Sconto sui buchi di poche notti fra due prenotazioni | calendario | sì | 1 | fatto |
| Minimo ridotto sui buchi | Abbassa il minimo di notti perché il buco si possa prenotare | calendario | sì | 1 | fatto |
| Ritocco accanto alle prenotazioni | Ritocca il prezzo nei giorni prima e dopo una prenotazione | calendario | sì | 2 | da fare |
| Combinazione con l'ultimo minuto | Come si combinano lo sconto sul buco e quello a ridosso | – | sì | 1 | fatto: conta solo il maggiore dei due |

## 5. Soggiorno minimo

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Minimo predefinito | Il minimo di notti di base | – | sì | 1 | fatto |
| Minimo per anticipo | Minimi diversi a ridosso della data e per le date lontane | – | sì | 1 | fatto |
| Soglia sotto cui non si scende | Il minimo non scende mai sotto questo valore | – | sì | 1 | da fare |
| Ordine di precedenza | Eccezione per data, poi date lontane, poi a ridosso, poi predefinito. La regola sui buchi vale solo se abbassa il minimo | – | sì | 1 | fatto |
| Minimo accanto alle date occupate | Minimo diverso il giorno prima o dopo una notte occupata | calendario | sì | 2 | da fare |
| Giorni di arrivo e partenza | Giorni della settimana ammessi per arrivare e partire | – | sì | 2 | da fare |
| Minimo calcolato | Bilancia il valore di una prenotazione con il rischio di creare buchi | durate e anticipi | parziale (serve molto storico) | 3 | da fare |

## 6. Eventi e festività

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Eccezioni per data | Prezzo e minimo di notti scelti a mano per una data | – | sì | 1 | fatto: vincono su tutto, pavimento e tetto compresi |
| Calendario eventi dell'host | Eventi caricati dall'host, con un peso da 1 a 5 per ognuno | file eventi (CSV) | sì | 1 | fatto: con più eventi nella stessa notte conta il più forte |
| Sensibilità agli eventi | Quanto si muove il prezzo intorno agli eventi | – | sì | 2 | fatto: una percentuale per ogni livello di impatto |
| Previsione della domanda | Stima la domanda da giorno della settimana, eventi e ritmo delle prenotazioni | storico + eventi | parziale | 3 | da fare |
| Tabella eventi curata | Elenco degli eventi della zona | – | no | 3 | da fare |

## 7. Regole per annuncio e per gruppo

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Spiegazione della notte | Mostra, notte per notte, ogni fattore applicato e il suo peso | – | sì | 1 | fatto (terminale, pagina calendario, MCP) |
| Regole a livelli | Regole su tutto il portafoglio, sul gruppo o sull'annuncio. Vince la più specifica | – | sì | 2 | da fare |
| Pacchetti di regole | Insiemi di regole riutilizzabili, applicati in blocco | – | sì | 2 | da fare |
| Anteprima prima di applicare | Mostra i prezzi che uscirebbero prima di salvarli | – | sì | 2 | in parte: `smoobu spingi` e `beds24 spingi` mostrano le differenze e scrivono solo con `--applica` |
| Modifiche in blocco | Cambia prezzi e minimi su più annunci insieme | – | sì | 2 | da fare |
| Sconti per durata | Sconti per soggiorni lunghi | – | sì | 2 | da fare |
| Supplemento per ospite in più | Supplemento per ogni ospite oltre una soglia | – | sì | 2 | da fare |

## 8. Dati di mercato e di quartiere

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Fasce di prezzo della zona | Confronto dei propri prezzi con i percentili degli annunci vicini | comparabili | no | 3 | da fare |
| Occupazione futura della zona | Occupazione di mercato prevista e prenotazioni recenti | comparabili | no | 3 | da fare |
| Storico della zona | Occupazione e tariffa medie della zona | comparabili | no | 3 | in parte: `fairnight mercato importa` (CSV dell'host, Inside Airbnb, ISTAC) e `mercato stato` |
| Annunci di confronto scelti | Confronto giorno per giorno con annunci scelti | comparabili | no | 3 | da fare |
| Ricerche sul sito diretto | Usa le date cercate sul sito dell'host come segnale di domanda | log del sito | sì (se l'host ha un sito) | 2 | da fare |

## 9. Occupazione e ritmo delle prenotazioni

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Ritocco per occupazione | Soglie di occupazione che fanno scattare sconti o ricarichi | calendario | sì | 1 | fatto: occupazione del mese nei prossimi giorni |
| Poche camere rimaste | Ricarico quando restano poche camere di una tipologia | calendario per camera | sì | 2 | fatto, spento di default (vedi [piccoli-hotel.md](piccoli-hotel.md)) |
| Occupazione del gruppo | Lo stesso ritocco, calcolato sull'occupazione di un gruppo di annunci | calendari | sì | 2 | da fare |
| Ritmo rispetto all'anno prima | Occupazione e ricavo di oggi confrontati con lo stesso punto dell'anno prima | storico | sì | 2 | da fare |
| Obiettivi | Obiettivo di ricavo con avviso se si resta indietro | storico + importi | sì | 2 | da fare |
| Ritocco rispetto al mercato | Ricarico o sconto quando la zona è più o meno piena del solito | occupazione della zona | parziale | 3 | fatto: fattore «domanda di zona», spento di default |

## 10. Analisi del portafoglio

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Indicatori del portafoglio | Occupazione, tariffa media, ricavo per notte disponibile, con export | prenotazioni con importi | sì (gli importi vanno importati: l'iCal non li ha) | 2 | da fare |
| Canali di provenienza | Da quale portale arrivano le prenotazioni | prenotazioni con canale | sì | 2 | da fare |
| Report per i proprietari | Report periodico da girare al proprietario | – | sì | 3 | da fare |
| Stima del ricavo per un indirizzo | Ricavo atteso di un immobile nuovo | comparabili | no | 3 | da fare |
| Qualità dell'annuncio | Voto a testi e foto | dati dei portali | no | – | fuori perimetro |

## 11. Calendari, gestionali e portali

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Lettura dei calendari | Occupazione dai feed iCal di Airbnb, Booking.com, Vrbo e dei gestionali | link iCal | sì | 1 | fatto (`fairnight sync`) |
| Export dei prezzi | Prezzi e minimi per notte in CSV, da caricare a mano | – | sì | 1 | fatto (`fairnight export`) |
| Connettori ai gestionali | Scrivono prezzo e minimo di notti nel gestionale | chiave del gestionale | sì | 2 | fatto per Smoobu e Beds24 (vedi [connettori.md](connettori.md)) |
| Invio programmato | Invio dei prezzi senza intervento, a orari fissi | – | sì | 2 | fatto: pilota automatico, una volta al giorno, solo dove l'host lo accende |
| Tetto giornaliero visibile | Il calendario mostra le notti frenate dal tetto (prezzo calcolato, prezzo mandato, differenza); l'host può confermare una notte o un intervallo perché il prezzo calcolato passi intero | Smoobu o Beds24, pilota acceso | sì | 2 | fatto: `fairnight pilota conferma`, `revoca`, `conferme`, o il pannello della notte. Mai automatica, scade dopo la data della notte |
| Collegamento diretto ai portali | Scrive direttamente sul portale | API partner del portale | – | – | escluso: servono accordi da partner, e niente scraping, mai |
| Uso dal telefono | Prezzi e andamento dal telefono | – | sì | 3 | in parte: la pagina calendario si apre dal telefono sulla stessa rete (`fairnight serve --lan`) |

## 12. Notifiche

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| Avvisi | Avvisa per mail o webhook: calendario fermo, buco creato, prezzo al pavimento, invio fallito | calendari + prezzi | sì | 2 | da fare |
| Report programmati | Riepilogo settimanale | – | sì | 2 | da fare |

## 13. API e AI

| Funzione | Cosa fa | Dati che servono | Solo dati dell'host | Fase | Stato in Fairnight |
|---|---|---|---|---|---|
| API locale | Legge i prezzi per notte e la spiegazione, scrive eccezioni e regole | – | sì | 2 | da fare |
| Server MCP | Domande e comandi da un assistente AI | – | sì | 1 (sola lettura) / 2 (scrittura) | sola lettura: fatto (`fairnight-mcp`). Scrittura: da fare |
