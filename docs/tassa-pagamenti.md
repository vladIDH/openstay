# Tassa di soggiorno e pagamenti nel check-in

Fairguest calcola la **tassa di soggiorno** di ogni prenotazione, prepara il **riepilogo per il comune** (CSV e PDF) e, se vuoi, fa pagare all'ospite la tassa e una **cauzione** dentro il check-in, con il **tuo** conto Stripe.

> Spento di default. Nessun soldo passa da Fairnight o da Khlumen: l'ospite paga sulla pagina di Stripe e il denaro arriva sul tuo conto Stripe. Non è un parere fiscale: le tariffe di partenza vanno controllate con il tuo comune.

## 1. La tassa

Nel blocco `fairguest` dell'alloggio aggiungi `touristTax` con il tuo comune:

```json
"fairguest": {
  "country": "IT",
  "establishment": "IT000XX000000",
  "touristTax": { "place": "roma" }
}
```

`fairnight tassa tariffe` mostra i valori di partenza, ognuno con la pagina ufficiale da cui è stato letto e la data (15 ottobre 2026):

| place | Comune | € a persona a notte | notti tassate | esenti sotto i | residenti esenti | dichiarazione |
|---|---|---|---|---|---|---|
| roma | Roma | 6,00 | 10 | 10 anni | sì | trimestrale |
| milano | Milano | 9,50 | 14 | 18 anni | sì | trimestrale |
| napoli | Napoli | 6,00 | 14 | 14 anni | sì | trimestrale |
| torino | Torino | 3,80 | 7 | 13 anni | sì | trimestrale |
| palermo | Palermo | 4,00 | 4 | 12 anni | sì | trimestrale |
| genova | Genova | 5,00 | 8 | 14 anni | sì | trimestrale |
| bologna | Bologna | **vuoto**: fasce per prezzo, scrivi la tua | 5 | 14 anni | sì | trimestrale |
| firenze | Firenze | 6,00 | 7 | 12 anni | sì | mensile |
| bari | Bari | 2,00 | 4 | 14 anni | sì | trimestrale |
| venezia | Venezia | 4,00 (gennaio 2,80); metà da 10 a 15 anni | 5 | 10 anni | sì | trimestrale |
| verona | Verona | 3,50; 2,80 da 15 a 25 anni e da 70 | 4 | 15 anni | sì | trimestrale |
| catania | Catania | 3,00 | 4 | 16 anni | sì | trimestrale |
| barcelona | Barcelona | 9,50 (4,50 impost + 5,00 recàrrec) | 7 | 17 anni | no | semestrale |
| catalunya | resto della Catalogna | 1,75 | 7 | 17 anni | no | semestrale |
| canarias | Canarie | nessuna tassa | | | | |

Le fonti complete sono in `packages/fairguest/src/tax/places.ts`. Punti da controllare:

- **Napoli, Genova, Bari, Catania** scrivono «entro (fino al) il quattordicesimo (sedicesimo) anno di età»: può voler dire anche «fino a 14 anni compiuti». Finché non confermi, la pagina `/pagamenti`, `fairnight tassa` e il riepilogo (CSV e PDF) mostrano un riquadro **«Da verificare»** con le parole del regolamento e il link alla fonte. Per chiuderlo: premi **«Ho verificato»** nella pagina, oppure `fairnight tassa conferma napoli`, oppure scrivi tu `"exemptUnderAge"` (per esempio 15 se il comune intende «fino a 14 anni compiuti»).
- **Venezia**: la tariffa dipende dal gruppo catastale (4,00 è il gruppo 2, A/2 e A/3). Metà tariffa «tra i 10 ed i 16 anni (non compiuti)», cioè da 10 a 15 anni compiuti: calcolata.
- **Verona**: 2,80 «dal giorno del compimento di anni 70» e «dal compimento dei 15 anni fino al giorno prima del compimento dei 26 anni»: calcolato. Non calcolati: i gruppi oltre 25 persone (anche loro 2,80) e il tetto di 4 notti al mese.
- **Milano**: il tetto di 14 notti è scritto per le case e appartamenti per vacanze.
- **Roma**: il sito del comune non rispondeva; i valori vengono dagli atti di Roma Capitale pubblicati sul portale del MEF.

Le tue cifre vincono sempre su quelle di partenza:

```json
"touristTax": { "place": "bologna", "rate": 5.8 }
"touristTax": { "place": "borgo-prova", "name": "Borgo di Prova", "rate": 2, "maxNights": 7, "exemptUnderAge": 12, "residentsExempt": true,
                "seasons": [{ "from": "06-01", "to": "09-30", "rate": 3 }], "period": "quarterly" }
```

### Tariffe ridotte per età

Ogni fascia ha due età comprese (anni compiuti il giorno dell'arrivo) e la sua tariffa: un importo (`rate`) oppure una percentuale della tariffa della notte (`percent`). Vale la prima fascia che va bene; le esenzioni vengono prima.

```json
"touristTax": { "place": "borgo-prova", "name": "Borgo di Prova", "rate": 3,
                "ageBands": [{ "fromAge": 15, "toAge": 25, "rate": 2.4 }, { "fromAge": 70, "rate": 2.4 }, { "fromAge": 10, "toAge": 14, "percent": 50 }] }
```

Senza `toAge` la fascia non ha un'età massima. Il riepilogo conta i ridotti in una colonna a parte («Ridotti»).

### Chi paga

- L'**età** si guarda il giorno dell'arrivo, dalla data di nascita del modulo.
- Se i **residenti** non pagano, il modulo chiede a ogni ospite «Questa persona è residente a …».
- In chiaro resta solo la **classe** dell'ospite (paga, esente per età, residente, altro): mai l'età, mai l'indirizzo. Quando i dati degli ospiti si cancellano, il soggiorno tiene solo i conteggi, per la dichiarazione.
- Gli ospiti arrivati con il **link da ovunque** sono cifrati: la classe si decide con la frase, con `fairnight tassa classifica` (o da sola con `fairnight pagamenti prepara`).
- Per cambiare la classe di un ospite: `fairnight tassa esenta <soggiorno> --persona 2 --motivo altro` (motivi: `eta`, `residente`, `altro`, `paga`).

### Riepilogo per il comune

```
fairnight tassa riepilogo --mese 2099-06
fairnight tassa riepilogo --trimestre 2099-Q2
```

Scrive `data/tassa/<comune>-<periodo>.csv` e `.pdf`: una riga per soggiorno, con notti nel periodo, ospiti, paganti, esenti per motivo, pernottamenti tassati, imposta dovuta e quanto l'ospite ha pagato online. Il tetto di notti si conta dalla prima notte del soggiorno anche quando il soggiorno è a cavallo di due mesi. Gli stessi file si scaricano dalla pagina `/pagamenti`.

## 2. I pagamenti con il tuo Stripe

1. Prendi la **chiave segreta** dal tuo Stripe (Sviluppatori → Chiavi API). Comincia con una chiave di prova `sk_test_…`: nessun soldo vero.
2. `fairnight pagamenti collega` la chiede senza mostrarla e la salva in `stripe-credentials.json`, nella tua cartella, leggibile solo dal tuo utente. In alternativa: la variabile `STRIPE_SECRET_KEY`.
3. Accendi i pagamenti nell'alloggio:

```json
"payments": { "enabled": true, "collectTax": true, "deposit": 200, "depositDaysBefore": 2 }
```

Senza chiave, Fairnight **non fa nessuna chiamata a Stripe** e l'ospite non vede nessun pagamento.

### Cosa vede l'ospite

Dopo aver salvato i dati, il check-in «Carta» mostra la scheda **Pagamenti**:

- **Imposta di soggiorno**: persone × notti e l'importo, con il bottone verso la pagina di Stripe. Se un ospite si aggiunge dopo, il link vecchio si spegne e ne nasce uno per la differenza.
- **Cauzione**: una **preautorizzazione**. La banca blocca l'importo sulla carta senza addebitarlo. Una preautorizzazione dura circa 7 giorni, per questo si offre da `depositDaysBefore` giorni prima dell'arrivo.

Con il **link da ovunque** il tuo computer lascia nella casella del relay solo gli indirizzi di Stripe e gli importi, niente sulla persona: la pagina li mostra appena ci sono. Li prepara `fairnight serve` ogni 5 minuti, oppure `fairnight pagamenti prepara`.

### Rilasciare o trattenere la cauzione

- Dalla pagina **`/pagamenti`** di `fairnight serve`, solo da questo computer: «Rilascia», oppure «Trattieni» con l'importo (vuoto = tutta). Il resto torna sulla carta.
- Dal terminale:

```
fairnight pagamenti                              # dove sta ogni pagamento, chiesto a Stripe
fairnight pagamenti rilascia <soggiorno> --applica
fairnight pagamenti trattieni <soggiorno> --importo 50 --applica
```

Senza `--applica` il comando dice cosa farebbe e non tocca niente.

### Cosa vede Stripe

L'importo, una descrizione («Imposta di soggiorno · Roma · Casa · 2099-06-10 → 2099-06-13») e l'id casuale del soggiorno. Nomi e documenti degli ospiti non vanno a Stripe; i dati della carta li scrive l'ospite solo sulla pagina di Stripe.

## Prove

I test usano uno Stripe finto che accetta solo chiavi di prova. Con una chiave di prova parte anche una prova nella vera modalità di prova di Stripe. La chiave va in `STRIPE_TEST_SECRET_KEY`, nell'ambiente oppure in `.env.local` nella radice del repo (git lo ignora); i test accettano solo chiavi `sk_test_`. La prova:

- crea il link della cauzione come fa il check-in e controlla su Stripe che sia una preautorizzazione usabile una volta, poi lo spegne;
- blocca una carta di prova (`pm_card_visa`), poi la trattiene in parte;
- blocca un'altra carta di prova e la rilascia.

Restano nel tuo Stripe di prova un prezzo e un link spento chiamati «Fairguest test».
