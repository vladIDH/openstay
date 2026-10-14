# Piccoli hotel: tipologie di camere con più unità

Fairnight prezza le case e anche i piccoli hotel. In un hotel una **tipologia** («Doppia») ha più camere uguali, vendute allo stesso prezzo: per Fairnight è un annuncio con `units` maggiore di 1. Il prezzo per notte resta uno solo per tutta la tipologia; cambia il modo di contare le notti, che non sono più «libera o occupata» ma «quante camere restano».

Con `units` assente o uguale a 1 non cambia niente: una casa si prezza esattamente come prima.

## L'esempio: Hotel Prova, 14 camere

Un hotel inventato con 14 camere in tre tipologie:

| Tipologia | Camere | Prezzo base |
|---|---|---|
| Doppia | 6 | 95 EUR |
| Tripla | 4 | 120 EUR |
| Singola | 4 | 70 EUR |

In `fairnight.config.json` sono tre annunci. La doppia arriva da Beds24 (`fairnight beds24 importa` la crea da sola con `units: 6`); le singole hanno ognuna il suo annuncio Airbnb, quindi un calendario iCal per camera; la tripla è fatta di quattro appartamenti Smoobu.

```json
{
  "listings": [
    {
      "name": "doppia",
      "calendars": [{ "source": "beds24", "roomId": 301 }],
      "pricing": {
        "name": "Hotel Prova · Doppia",
        "currency": "EUR",
        "basePrice": 95,
        "defaultMinStay": 2,
        "units": 6,
        "factors": {
          "limits": { "enabled": true, "floorPrice": 60, "ceilingPrice": 220 },
          "lastMinute": { "enabled": true, "steps": [{ "withinDays": 3, "discountPercent": 10 }] },
          "gaps": { "enabled": true, "maxNights": 3, "discountPercent": 10, "lowerMinStay": true },
          "scarcity": {
            "enabled": true,
            "steps": [
              { "takenPercent": 50, "raisePercent": 5 },
              { "takenPercent": 65, "raisePercent": 10 },
              { "takenPercent": 80, "raisePercent": 15 }
            ],
            "maxRaisePercent": 20
          },
          "rounding": { "enabled": true, "step": 1 }
        }
      }
    },
    {
      "name": "tripla",
      "calendars": [
        { "source": "smoobu", "apartmentId": 501 },
        { "source": "smoobu", "apartmentId": 502 },
        { "source": "smoobu", "apartmentId": 503 },
        { "source": "smoobu", "apartmentId": 504 }
      ],
      "pricing": { "currency": "EUR", "basePrice": 120, "defaultMinStay": 2, "units": 4, "factors": {} }
    },
    {
      "name": "singola",
      "calendars": [
        { "source": "airbnb", "url": "https://www.airbnb.com/calendar/ical/…-201.ics", "unit": "201" },
        { "source": "booking", "url": "https://admin.booking.com/…-201.ics", "unit": "201" },
        { "source": "airbnb", "url": "https://www.airbnb.com/calendar/ical/…-202.ics", "unit": "202" },
        { "source": "airbnb", "url": "https://www.airbnb.com/calendar/ical/…-203.ics", "unit": "203" },
        { "source": "airbnb", "url": "https://www.airbnb.com/calendar/ical/…-204.ics", "unit": "204" }
      ],
      "pricing": { "currency": "EUR", "basePrice": 70, "defaultMinStay": 1, "units": 4, "factors": {} }
    }
  ]
}
```

La camera 201 è anche su Booking: i suoi due calendari hanno lo stesso `"unit": "201"`, così la camera conta una volta sola anche quando Airbnb mostra come «Not available» le notti vendute su Booking.

## Come conta le camere

Per ogni notte Fairnight conta quante camere sono **prenotate**, **chiuse** (bloccate dal proprietario o per lavori) e **libere**:

- le prenotazioni della **stessa camera** si uniscono, come per una casa: se una prenotazione e una chiusura si sovrappongono, vince la prenotazione;
- una prenotazione **senza camera** (Beds24 non l'ha ancora assegnata) prende una camera sua, o più camere se è una prenotazione di più camere;
- se le prenotazioni sono più delle camere, la notte ha 0 camere libere e la spiegazione dice «Overbooked by 1 on the channel».

La notte resta **in vendita finché c'è almeno una camera libera**. È «reserved» o «blocked» solo quando non ne resta nessuna.

## Le regole del prezzo con più camere

- **Occupazione del mese**: camere-notte prenotate diviso camere-notte vendibili. 4 doppie su 6 per tutto il mese fanno il 67%; le camere chiuse non contano né sopra né sotto.
- **Buchi**: un buco è un tratto breve di notti con camere libere fra due notti **tutto esaurito**. È il caso in cui un ospite non può restare più a lungo, qualunque camera gli tocchi, perché la notte prima e quella dopo non c'è posto: lo sconto per il buco e il soggiorno minimo abbassato alla lunghezza del buco hanno senso. Una camera libera fra due prenotazioni della stessa camera, mentre altre camere sono libere, **non è un buco**: lì basta spostare gli ospiti fra le camere, ed è il lavoro del gestionale (Beds24 assegna le camere da solo). Scontare tutta la tipologia sarebbe un regalo senza motivo.
- **Ultimo minuto** e **calendario fermo**: valgono su ogni notte con almeno una camera libera, come per una casa.
- **Poche camere rimaste** (`scarcity`, spento di default): vedi sotto.

## Poche camere rimaste (consigliato)

È la regola che ogni hotel si aspetta: quando le camere di una notte finiscono, il prezzo sale. Vale **solo con `units` maggiore di 1** (una casa è libera o occupata, quindi non ha senso) ed è **spenta di default**.

Si accende con dei gradini: conta la quota di camere già prese (prenotate o chiuse) e vale il gradino più alto raggiunto. `maxRaisePercent` è il tetto: anche un gradino scritto più alto non lo supera mai (default 20%).

Valori consigliati:

| Camere prese | Aumento | Con 6 camere | Con 4 camere |
|---|---|---|---|
| almeno 50% | +5% | 3 prese | 2 prese |
| almeno 65% | +10% | 4 prese | — |
| almeno 80% | +15% | 5 prese (l'ultima camera) | 3 prese (l'ultima camera) |

Tetto: **+20%**. I gradini sono in percentuale, così valgono per tipologie di misure diverse; controllate che l'ultimo gradino scatti davvero con l'ultima camera (con 6 camere l'ultima libera è l'83%, quindi un gradino all'85% non scatterebbe mai).

L'aumento si somma alle altre regole: un'ultima camera a due giorni dalla data prende sia lo sconto dell'ultimo minuto sia l'aumento; la spiegazione mostra tutti e due.

## La spiegazione di una notte

Con più camere `fairnight price --explain`, la pagina e lo strumento MCP `explain_night` dicono quante camere sono libere e quale regola ha pesato di più. Con la doppia dell'esempio, dove il 13 e il 15 novembre sono tutto esaurito e il 14 restano 3 camere:

```
Sat 2026-11-14 · 90 EUR (3 of 6 rooms free): base 95 → gap of 1 night -10% = 85.50 → few rooms left (≥50% taken) +5% = 89.78 (3 of 6 rooms free · 50% taken) → within floor 60 and ceiling 220 → rounded to 1 = 90. Min stay 1 (lowered to fill the gap). Weighed most: gap of 1 night -10%.
Sat 2026-11-21 · 109 EUR (1 of 6 rooms free): base 95 → few rooms left (≥80% taken) +15% = 109.25 (1 of 6 rooms free · 83% taken) → within floor 60 and ceiling 220 → rounded to 1 = 109. Min stay 2 (default). Weighed most: few rooms left (≥80% taken) +15%.
Fri 2026-11-13: not for sale (reserved, 0 of 6 rooms free).
```

Le spiegazioni del motore restano in inglese, come tutto il motore (gli assistenti che leggono l'MCP traducono da soli). La pagina locale mostra nel calendario le camere libere di ogni notte («3/6») e nel pannello della notte «3 camere libere su 6».

## Da dove arrivano le camere

### Beds24

Beds24 ha le tipologie con più unità: la stanza ha `qty` (da 1 a 99) e l'elenco `units`, con id da 1; la prenotazione ha `roomId`, `unitId` e `roomQty` (specifica OpenAPI `beds24.com/api/v2/apiV2.yaml`, letta il 14 ottobre 2026). Prezzi (`price1`…`price16`), `minStay` e `numAvail` stanno nel calendario della **stanza**, senza un campo per unità: il prezzo è uno per tipologia.

- `fairnight beds24 importa` crea un annuncio per ogni stanza, con `"units": qty` quando le unità sono più di una. Se più tardi `qty` cambia su Beds24, `importa` lo dice («now has 6 units, listing says 5»).
- Le prenotazioni si leggono **per unità**: con `unitId` da 1 in su la prenotazione occupa quella camera; senza `unitId` (0 o assente) occupa `roomQty` camere, 1 se manca. **Da verificare su un account vero**: la specifica non dice che valore ha `unitId` finché la prenotazione non è assegnata, né se una prenotazione di più camere arriva come una prenotazione con `roomQty` maggiore di 1 o come una per camera.
- `fairnight beds24 spingi` scrive **un solo prezzo per stanza**, solo con `--applica`, come per le case. In più confronta notte per notte le camere libere per Fairnight con `numAvail` di Beds24: dove non coincidono **non scrive** e lo elenca («2026-11-05: 6 free here, 5 free on Beds24»). Si rilancia `importa` e si riprova.

### Smoobu

Smoobu **non ha tipologie con più camere**: un appartamento è una sola unità prenotabile. Lo dice il centro assistenza di Smoobu, nell'articolo [«Split a Booking.com listing with several rooms into individual listings»](https://support.smoobu.com/hc/en-us/articles/360003486339) (letto il 14 ottobre 2026):

> Smoobu maps one listing to one property, so a listing that sells several identical rooms cannot map cleanly: Smoobu's calendar and pricing don't model room counts, so bookings show up looking like overbookings and you can't control prices or availability per room.

> After the split, each room is its own listing with an inventory of 1, mapped to its own Smoobu property.

Anche l'API va in questa direzione: `GET /api/apartments` dà solo id e nome, e `GET`/`POST /api/rates` lavorano per appartamento, senza un campo per il numero di camere (docs.smoobu.com). I gruppi di Smoobu (proprietà principale e sotto-unità) sono un'altra cosa: «When the main property is booked, none of its sub-units can be booked», e ogni sotto-unità ha «its own rate plan» ([articolo 360010147320](https://support.smoobu.com/hc/en-us/articles/360010147320)).

Per questo **l'unione è nostra, non una funzione di Smoobu**: in Fairnight una tipologia può elencare fino a `units` appartamenti Smoobu (un appartamento per camera, ognuno al massimo in un annuncio).

- `importa` legge le prenotazioni di tutti gli appartamenti; ogni appartamento conta come una camera.
- `spingi` scrive **lo stesso prezzo** agli appartamenti ancora liberi su Smoobu, solo con `--applica`: una `POST /api/rates` con l'elenco degli appartamenti per ogni gruppo di notti con gli stessi appartamenti liberi (di solito una sola). Le notti in cui Smoobu ha un numero diverso di appartamenti liberi rispetto alle camere libere per Fairnight non vengono toccate.
- `importa` crea un annuncio per ogni appartamento nuovo: per unirli in una tipologia si spostano i loro `{ "source": "smoobu", "apartmentId": … }` in un annuncio solo, con `"units"`, e si tolgono gli altri.

### Calendari iCal (Airbnb, Booking.com)

**Un calendario per camera, mai uno per tipologia.** Ogni calendario di una tipologia dice di che camera è (`"unit": "101"`); senza `unit` Fairnight non lo accetta.

- **Booking.com** non dà iCal per le tipologie con più camere. Dal centro assistenza partner, [«Syncing your Booking.com calendar with third-party calendars»](https://partner.booking.com/en-us/help/rates-availability/extranet-calendar/syncing-your-bookingcom-calendar-third-party-calendars), letto il 14 ottobre 2026: «To be eligible, a property must be a relatively small, single-unit-per-room-type setup. This means no more than 20 different room types, and each of those room types can only have one bookable space in them.» E l'esempio: «Not eligible: "Standard double room" with five units (you have five identical standard double rooms under the same room type).» Tra i requisiti c'è anche «You don't use a Connectivity provider». Un hotel con più camere per tipologia su Booking passa quindi da un channel manager (Beds24) e non dall'iCal. L'iCal di Booking serve solo quando ogni camera è una tipologia a sé.
- **Airbnb** esporta un calendario per annuncio ([articolo 99](https://www.airbnb.com/help/article/99): «Nights that you block—or that are booked on Airbnb—will be blocked on the other website's calendar.»). Le camere come annunci separati funzionano: un iCal per camera. Airbnb ha anche la «Room type inventory» ([articolo 2350](https://www.airbnb.com/help/article/2350): «Room type inventory allows you to have multiple availabilities for the same listing on the same day.»), con conteggi di disponibilità giornalieri, descritta nella pagina sui requisiti degli annunci creati con un software (gestionale o channel manager), e le «multiple units property» ([articolo 4050](https://www.airbnb.com/help/article/4050): «Pricing, calendar, and reservations will stay as they are, managed by unit.»). Come esporti l'iCal un annuncio con disponibilità maggiore di 1 **non è documentato**: Fairnight non lo usa.

## MCP

Gli strumenti restano in sola lettura. Con `units` maggiore di 1:

- `list_listings` dice che l'annuncio è una tipologia e quante camere ha;
- `get_prices` dà per ogni notte anche `units` e `unitsFree`;
- `explain_night` ha camere libere e regola che ha pesato di più;
- `occupancy` conta le camere-notte (`roomNights`), e le notti «reserved» o «blocked» sono quelle senza camere libere;
- `next_gaps` usa la stessa regola del motore (buchi fra notti tutto esaurito) e dà le camere libere di ogni notte del buco (`unitsFree`).
