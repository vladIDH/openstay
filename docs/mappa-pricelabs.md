# Mappa delle funzioni di PriceLabs

Ricavata **solo da pagine pubbliche** (sito, centro assistenza, blog, stampa di settore), lette il 12 ottobre 2026. Nessun login, nessun codice, testo o schermata copiati: le descrizioni sono riscritte con parole nostre.

- **Nome nostro**: come chiameremo la funzione in Fairnight. Non riusiamo mai i nomi di PriceLabs.
- **Riferimento**: la funzione corrispondente di PriceLabs, indicata solo per orientarsi. Non va usata nel codice né nei testi del prodotto.
- **Nostri dati**: la funzione si fa con i soli dati dell'host? Sono i calendari iCal, lo storico dei prezzi e le prenotazioni importate.
- **Fase**:
  - 1 = motore base con i soli dati propri;
  - 2 = regole avanzate, gruppi e connettori;
  - 3 = dati di mercato e analisi.

## 1. Prezzo base e limiti

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Prezzo di partenza | Base Price | Il prezzo della notte "media", su cui agiscono tutti i fattori | prezzo deciso dall'host | sì | nessuna | 1 |
| Pavimento e tetto | Min/Max Price | Limiti rigidi al prezzo finale. Se mancano, PL usa un pavimento al 30% del base e un tetto a 10 volte il base | base | sì | nessuna | 1 |
| Pavimento storico | Safety Minimum Price | Non scende sotto la tariffa ottenuta nello stesso periodo dell'anno prima (±1 settimana), più una correzione per l'inflazione | storico prezzi e prenotazioni | sì | nessuna | 1 |
| Suggeritore del prezzo base | Base Price Help | Propone il base dal rendimento passato o dai percentili della zona | storico, comparabili | parziale (solo la parte storica) | comparabili | 3 |
| Pavimenti per finestra | Minimum Weekend / Far-out pricing | Pavimento diverso per il weekend o per le date lontane | regole | sì | nessuna | 2 |
| Arrotondamento | Rounding | Prezzi che finiscono con le cifre scelte (per esempio …9 o …5) | – | sì | nessuna | 1 |
| Ritocco finale | Pricing Offset | Correzione fissa o in % applicata per ultima, anche sotto il pavimento | – | sì | nessuna | 2 |

## 2. Stagionalità e giorno della settimana

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Curva stagionale | Seasonality factor | Il prezzo segue l'andamento dell'anno | storico ≥ 12 mesi | parziale | comparabili per gli annunci nuovi | 1 (dallo storico) / 3 |
| Intensità stagionale | Seasonality sensitivity | Quanto pesa la curva stagionale | – | sì | nessuna | 2 |
| Stagioni dell'host | Custom Seasonal Profile | Periodi con il loro min, base e max (fissi o in %) | calendario | sì | nessuna | 1 |
| Peso del giorno della settimana | Day of Week Adjustment | Una percentuale per ogni giorno | – | sì | nessuna | 1 |
| Giorni di weekend | Weekend Days | L'host sceglie quali notti contano come weekend | – | sì | nessuna | 1 |
| Livellamento | Smoothing | Stesso prezzo su un intero periodo (per esempio una settimana) | – | sì | nessuna | 2 |

## 3. Ultimo minuto e date lontane

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Sconto a ridosso | Last Minute | Sconto che cresce man mano che la data si avvicina. PL arriva a circa il 30% negli ultimi 15 giorni, o fino al 40% nella versione legata al mercato | data | sì (curva fissa) | mercato per la versione dinamica | 1 |
| Ricarico per le date lontane | Far-Out Premium | Ricarico sulle date molto lontane, fino a circa +20% | data | sì (curva fissa) | mercato per la versione dinamica | 1 |
| Sconto per calendario fermo | Booking Recency Factor | Sconto sui prossimi 30 giorni se da settimane non entra nessuna prenotazione | prenotazioni con data di creazione | parziale (l'iCal non ha la data di prenotazione: la ricaviamo dalla comparsa dell'evento nel feed) | nessuna | 1 |

## 4. Notti orfane e buchi di calendario

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Prezzo sui buchi | Orphan Day pricing | Sconto (o ricarico) sui buchi di 1–2 notti fra due prenotazioni. In PL è -20% di default | calendario | sì | nessuna | 1 |
| Minimo ridotto sui buchi | Orphan gap min stay | Abbassa il minimo di notti perché il buco si possa prenotare | calendario | sì | nessuna | 1 |
| Ritocco accanto alle prenotazioni | Adjacent Factor | Ritocca il prezzo nei N giorni prima e dopo una prenotazione | calendario | sì | nessuna | 2 |
| Combinazione con l'ultimo minuto | gerarchia | Se buco e ultimo minuto sono entrambi sconti vince il maggiore, altrimenti si sommano | – | sì | nessuna | 1 |

## 5. Soggiorno minimo

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Minimo predefinito | Default Min Stay | Il minimo di notti di base | – | sì | nessuna | 1 |
| Minimo per anticipo | Last-minute / Far-out min stay | Minimi diversi a ridosso della data e per le date lontane | – | sì | nessuna | 1 |
| Soglia sotto cui non si scende | Lowest Min Stay Allowed | Il minimo non scende mai sotto questo valore | – | sì | nessuna | 1 |
| Ordine di precedenza | gerarchia | Eccezione per data, poi minimo per date lontane, poi a ridosso, poi predefinito. La regola sui buchi vince solo se abbassa il minimo | – | sì | nessuna | 1 |
| Minimo accanto alle date occupate | Adjacent min stay | Minimo diverso il giorno prima o dopo una notte occupata | calendario | sì | nessuna | 2 |
| Giorni di arrivo e partenza | Check-in/out restrictions | Giorni della settimana ammessi per arrivare e partire | – | sì | nessuna | 2 |
| Minimo calcolato | Min Stay Recommendation Engine | Bilancia il valore di una prenotazione con il rischio di creare buchi, in base a durate e anticipi tipici | durate e anticipi | parziale (serve molto storico) | durate e anticipi di mercato | 3 |

## 6. Eventi e festività

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Eccezioni per data | Date-Specific Overrides | Prezzo fisso o in %, minimo di notti, date chiuse su date scelte | – | sì | nessuna | 1 |
| Calendario eventi dell'host | (non c'è: PL ha una tabella interna dove l'utente può solo segnalare) | Eventi caricati dall'host (CSV o iCal), con un peso da 1 a 5 per ognuno | file eventi | sì | nessuna (opzionale: festività pubbliche) | 1 |
| Sensibilità agli eventi | Demand Factor Sensitivity | Quanto si muove il prezzo intorno agli eventi | – | sì | nessuna | 2 |
| Previsione della domanda | Demand Factor | Stima la domanda da giorno della settimana, eventi e ritmo delle prenotazioni | storico + eventi | parziale | mercato | 3 |
| Tabella eventi curata | Events, Holidays & High Demand Dates | Elenco degli eventi di mercato con i prezzi medi | – | no | calendario eventi + mercato | 3 |

## 7. Regole per annuncio e per gruppo

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Spiegazione della notte | tooltip del calendario | Mostra, notte per notte, ogni fattore applicato e il suo peso | – | sì | nessuna | 1 |
| Regole a livelli | Customizations (Account / Group / Subgroup / Listing) | Regole su tutto il portafoglio, sul gruppo o sull'annuncio. Vince la più specifica | – | sì | nessuna | 2 |
| Pacchetti di regole | Pricing / Seasonal Profiles | Insiemi di regole riutilizzabili, applicati in blocco | – | sì | nessuna | 2 |
| Anteprima prima di applicare | Group-Level Preview | Mostra i prezzi che uscirebbero prima di salvare | – | sì | nessuna | 2 |
| Modifiche in blocco | Bulk updates / Multi-calendar | Cambia prezzi e minimi su più annunci insieme | – | sì | nessuna | 2 |
| Sconti per durata | Weekly / Monthly / LOS discount | Sconti per soggiorni lunghi | – | sì | nessuna | 2 |
| Supplemento per ospite in più | Extra Person Fee | Supplemento per ogni ospite oltre una soglia | – | sì | nessuna | 2 |

## 8. Dati di mercato e di quartiere

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Fasce di prezzo della zona | Neighborhood Data | Confronto dei miei prezzi con i percentili degli annunci vicini | – | no | comparabili | 3 |
| Occupazione futura della zona | Future Occupancy / Pickup | Occupazione di mercato prevista e prenotazioni recenti | – | no | comparabili | 3 |
| Storico della zona | Market History | Occupazione, tariffa, anticipo e durata medi per mese | – | no | comparabili | 3 |
| Concorrenti scelti | Competitor Map / Comp Sets / Market Dashboard | Confronto giorno per giorno con annunci scelti | – | no | comparabili | 3 |
| Ricerche sul sito diretto | Website Search Data | Usa le date cercate sul sito dell'host come segnale di domanda | log del sito | sì (se l'host ha un sito) | nessuna | 2 |

## 9. Occupazione e ritmo delle prenotazioni

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Ritocco per occupazione | Occupancy Based Adjustments | Soglie di occupazione per finestra (0–15 giorni, 16–30 giorni…) che fanno scattare sconti o ricarichi | calendario | sì | nessuna | 1 |
| Occupazione del gruppo | Portfolio OBA | Lo stesso ritocco, calcolato sull'occupazione dell'intero gruppo | calendari | sì | nessuna | 2 |
| Ritmo rispetto all'anno prima | Pacing / Booking curves | Occupazione e ricavo di oggi confrontati con lo stesso punto dell'anno prima | storico | sì | mercato facoltativo | 2 |
| Obiettivi | Forecasting & Goal Setting | Obiettivo di ricavo con avviso se si resta indietro | storico + importi | sì | nessuna | 2 |
| Ritocco rispetto al mercato | OBA market-driven | Ricarico o sconto se l'annuncio è sopra o sotto l'occupazione della zona | – | parziale | occupazione di mercato | 3 |

## 10. Analisi del portafoglio

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Indicatori del portafoglio | Portfolio Analytics | Occupazione, tariffa media, ricavo per notte disponibile, futuro e passato, con export | prenotazioni con importi | sì (gli importi vanno importati: l'iCal non li ha) | nessuna | 2 |
| Canali di provenienza | Booking Source reports | Da quale portale arrivano le prenotazioni | prenotazioni con canale | sì (dal feed di provenienza) | nessuna | 2 |
| Report per i proprietari | Owner Analytics | Report periodico da girare al proprietario | – | sì | nessuna | 3 |
| Stima del ricavo per un indirizzo | Revenue Estimator | Ricavo atteso di un immobile nuovo | – | no | comparabili | 3 |
| Qualità dell'annuncio | Listing Optimizer | Voto a testi e foto | – | no | dati dei portali | fuori perimetro |

## 11. Integrazioni con gestionali e portali

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Lettura dei calendari | (PL legge dal gestionale) | Occupazione dai feed iCal di Airbnb, Booking e di qualsiasi gestionale | link iCal | sì | nessuna | 1 |
| Export dei prezzi | Export rates CSV | Prezzi e minimi per notte in CSV, da caricare a mano o nel gestionale | – | sì | nessuna | 1 |
| Connettori ai gestionali | 160+ PMS / channel manager | Scrivono prezzo, minimo, giorni di arrivo e partenza fino a molti mesi avanti | chiave del gestionale | sì | nessuna | 2 (vedi `connettori.md`) |
| Invio programmato | Daily Sync / Timed Sync | Invio a un orario scelto o più volte al giorno. In PL ogni invio in più costa | – | sì | nessuna | 2 |
| Collegamento diretto ai portali | Airbnb / Vrbo diretti | Scrive direttamente sul portale | API partner del portale | **no** (servono accordi da partner; niente scraping, mai) | – | escluso |
| App per telefono | Mobile app | Prezzi e andamento dal telefono | – | sì | nessuna | 3 (pagina web responsive) |

## 12. Notifiche

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| Avvisi | AI Insights / Alerts (in PL ancora "in arrivo") | Avvisa per mail o webhook: calendario fermo, buco creato, prezzo al pavimento, invio fallito | calendari + prezzi | sì | nessuna | 2 |
| Report programmati | report via mail | Riepilogo settimanale | – | sì | nessuna | 2 |

## 13. API e AI

| Nome nostro | Riferimento | Cosa fa | Dati che servono | Nostri dati | Fonte di mercato | Fase |
|---|---|---|---|---|---|---|
| API locale | Customer API | Legge i prezzi per notte e la spiegazione. Scrive eccezioni e regole | – | sì | nessuna | 2 |
| Server MCP | MCP AI Connector (in PL da luglio 2026) | Domande e comandi da Claude o ChatGPT. Il nostro parte in sola lettura | – | sì | nessuna | 1 (sola lettura) / 2 (scrittura) |

## 14. Listino PriceLabs (per confronto)

- Prova gratuita di 30 giorni.
- Circa 19,99 $ per annuncio al mese in Europa e Stati Uniti. Questa cifra viene da fonti esterne: la pagina ufficiale non mostra cifre.
- Extra a pagamento: unità aggiuntive, canali aggiuntivi, invii in più, cruscotto di mercato, ottimizzatore dell'annuncio, stime di ricavo.

## Cosa PriceLabs non ha (o fa male) e Fairnight può avere

| Punto | Stato |
|---|---|
| Eventi locali caricati dall'host (CSV o iCal): PL permette solo di segnalarli | verificato |
| Annunci che vivono solo di iCal, senza gestionale, con prezzi esportati in CSV | assenza probabile (non trovato nelle pagine pubbliche) |
| Avvisi già funzionanti: in PL sono "in arrivo" | verificato |
| Invii più volte al giorno senza costo per annuncio | verificato che in PL si paga |
| Regole attivabili da soli: in PL alcune vanno chieste all'assistenza | verificato |
| Pavimento storico anche senza prenotazioni nell'anno prima | verificato il limite di PL |
| Nessun canone per annuncio, unità o canale | nostra scelta di modello |
| Dati in casa propria (self-hosting, SQLite locale) | nostra affermazione (PL è solo cloud) |
| Codice ispezionabile e valori predefiniti versionati: PL ha due algoritmi chiusi con default diversi | verificato che sono chiusi |
| Spiegazione riproducibile notte per notte (stesso input, stesso prezzo, con l'elenco dei fattori) | nostra affermazione (PL ha un tooltip, non la riproducibilità) |
| Prova su un anno passato prima di accendere il motore | nostra affermazione (PL ha solo l'anteprima) |
| MCP locale e gratuito, sui soli dati propri | PL **ha già** un MCP (luglio 2026), quindi non ci distingue in sé: ci distingue solo perché è locale e gratuito |

## Fonti consultate

- help.pricelabs.co, articoli: customization-hierarchy, default-discounts-and-premiums, list-of-all-pricelabs-customizations, base-price-help, occupancy-based-adjustments, how-pricelabs-handles-event-pricing, events-holidays-and-high-demand-dates, demand-factor-sensitivity, seasonal-minimum-base-and-max-price-settings, timed-sync, market-intel-dashboard, pagine di fatturazione.
- hello.pricelabs.co: dynamic-pricing, accelerate, minimum-stay-recommendation-engine, enterprise/mcp-api-integration, pricing, blog sul ritmo delle prenotazioni.
- developers.pricelabs.co: solo frammenti dalla ricerca, perché la pagina rifiuta la lettura automatica (HTTP 451).
- Stampa e recensioni: shorttermrentalz.com, learn.10xbnb.com, us.fitgap.com.

## Punti incerti

- Endpoint, limiti e costo dell'API di PriceLabs non verificati sulla documentazione.
- Il prezzo per annuncio viene solo da fonti esterne.
- La logica esatta del minimo calcolato non è pubblica.
- Non è confermato se in PL si possono caricare i prezzi via CSV per annunci senza gestionale.
