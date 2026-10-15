# Il motore attuale

Il motore di Fairnight è una libreria pura (`packages/fairnight`): niente rete, niente file, niente database, niente orologio. Lo stesso input dà sempre lo stesso prezzo. I fattori, il loro ordine e le regole del soggiorno minimo sono descritti nel [README del motore](../packages/fairnight/README.md#factors). Cosa c'è e cosa manca rispetto alle funzioni di un motore di prezzi è in [mappa-funzioni.md](mappa-funzioni.md).

## La data delle prenotazioni per il calendario fermo (0.2.0)

Lo sconto per calendario fermo ha bisogno del giorno in cui è arrivata l'ultima prenotazione nuova. Il motore lo riceve come `lastBookingReceived`; la CLI lo calcola così:

- **Sorgente Smoobu:** usa il `created-at` di Smoobu, cioè il giorno vero in cui la prenotazione è stata fatta (colonna `booked_at`).
- **Sorgente Beds24:** usa il `bookingTime` di Beds24, che ha lo stesso significato (colonna `booked_at`).
- **Sorgente iCal:** i calendari non dicono quando una prenotazione è stata fatta. Resta una stima: il giorno in cui `fairnight sync` l'ha vista per la prima volta. Subito dopo il primo sync tutte le prenotazioni sembrano nuove, e lo sconto aspetta.
- **Annuncio con tutte e due le sorgenti:** vale la data più recente fra le due.

Le date bloccate (anche quelle di Smoobu) non contano mai come prenotazioni: non spostano questa data, non entrano nell'occupazione e non entrano nello storico prezzi.
