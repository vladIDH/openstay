# Fairguest in Italia: guida per l'host

Fairguest comunica gli ospiti alla **Polizia di Stato** con il servizio **Alloggiati Web**, dal tuo computer. I dati degli ospiti restano cifrati sul tuo computer e si cancellano da soli appena l'invio è registrato. Nessun nostro server sta nel mezzo.

> Versione di Fairguest in sviluppo (ottobre 2026). Questa guida copre **Alloggiati Web**, il **link da mandare all'ospite** e la **foto del documento**. La comunicazione **Istat** (movimento turistico regionale) arriva nella prossima versione e sarà aggiunta qui.
>
> Non è un parere legale. I punti segnati **[NV]** non sono ancora verificati con un invio vero.

[Versión en español](fairguest-italia.es.md)

## Cosa serve

1. **Le credenziali di Alloggiati Web** della tua struttura. Si chiedono alla **Questura** della provincia. Valgono anche per gli affitti brevi sotto i 30 giorni (art. 19-bis DL 113/2018). Ricevi:
   - un **utente** e una **password**;
   - una **scheda codici** con PUK, che serve solo per entrare nel sito.
2. **La «Chiave Web Service» (WSKEY).** Entra nel [portale](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/), apri il menu del tuo utente e scegli «Chiave Web Service».
   - Se ne genera **una al giorno**.
   - Va **rigenerata ogni volta che cambi la password**: dopo un cambio, salvala di nuovo in Fairguest (vedi sotto).
3. **Più appartamenti con una sola utenza.** Se la Questura ti ha dato un'utenza «Gestione Appartamenti», ogni appartamento ha un numero (IdAppartamento):
   - lo vedi nel portale, alla voce «Appartamenti»;
   - va scritto nelle impostazioni di ogni alloggio.
4. **Fairnight installato**, con la cartella dei tuoi alloggi (vedi il README).

## Come si attiva

### 1. L'alloggio

In `fairnight.config.json`, a ogni alloggio in Italia aggiungi un blocco `fairguest`:

```json
"fairguest": {
  "country": "IT",
  "establishment": "IT000XX000000",
  "checkInTime": "15:00",
  "checkOutTime": "10:00",
  "alloggiati": { "account": "principale" }
}
```

- `establishment`: un codice tuo per l'alloggio. Il CIN va bene.
- `checkInTime` e `checkOutTime` servono per le scadenze: un soggiorno di 24 ore o meno ha **6 ore** invece di 24.
- `alloggiati.account`: il nome che dai alle credenziali. Se tutti gli alloggi usano la stessa utenza, lascia `principale`. Se hai utenze diverse, usa un nome per ciascuna (es. `casa-mare`).
- `alloggiati.apartmentId`: solo per le utenze «Gestione Appartamenti», il numero dell'appartamento nel portale.

### 2. Fairguest

```
fairnight ospiti attiva
```

- Scegli una **frase segreta** di almeno 12 caratteri. Senza la frase nessuno può leggere i dati degli ospiti: né tu, né noi, né altri. **Se la perdi, i dati non si recuperano.**
- Fairguest scarica dal portale le **tabelle ufficiali** dei comuni, degli Stati e dei documenti. Le tiene in `data/fairguest/alloggiati/` e le riscarica quando hanno più di un mese.
- Puoi riscaricarle in ogni momento con `fairnight ospiti tabelle`.

### 3. Le credenziali di Alloggiati Web

```
fairnight ospiti credenziali
```

- Ti chiede utente, password e chiave. **Password e chiave non si vedono mentre le scrivi** e non passano mai dalla riga di comando.
- Vengono salvate **sigillate con la tua chiave**: si aprono solo con la frase segreta.
- Con più utenze aggiungi `--account casa-mare`.

Per controllarle con la Polizia di Stato **senza inviare nessuna schedina**:

```
fairnight ospiti credenziali --verifica
```

## Cosa vede l'ospite

Il modulo si apre in due modi:

- **dalla rete di casa:** `fairnight serve --lan`, poi il link di `fairnight ospiti elenco` su un telefono o un tablet collegato alla tua rete;
- **da qualsiasi posto:** il link di `fairnight ospiti link <soggiorno>`, da mandare all'ospite come gli scrivi di solito. Vedi «Il link da mandare all'ospite» qui sotto.

Il modulo è in italiano, inglese e spagnolo, in tre passi: i suoi dati, documento, conferma. Per un alloggio in Italia chiede solo quello che chiede Alloggiati Web:

| Ospite | Cosa compila |
|---|---|
| Tutti | nome, cognome, sesso, data di nascita, cittadinanza, Stato di nascita; il comune (e se serve la provincia) solo per chi è nato in Italia |
| Solo chi ha prenotato | il documento: tipo (passaporto, carta d'identità elettronica o cartacea, patente), numero, Stato di rilascio; il comune solo per i documenti rilasciati in Italia |
| Gli altri | la parentela con chi ha prenotato, se sono familiari. Così Fairguest sa se è una famiglia (capofamiglia e familiari) o un gruppo (capogruppo e membri) |

**Non chiede** indirizzo, telefono, email né pagamento: in Italia la legge non li vuole, quindi il modulo non li raccoglie.

In alto l'ospite legge una riga su cosa succede ai suoi dati: restano cifrati sul tuo computer, vanno solo alla Polizia di Stato e si cancellano da soli dopo l'invio. Gli viene anche detto che **all'arrivo lo riconoscerai di persona o in videochiamata**, con il documento.

## Il link da mandare all'ospite

```
fairnight ospiti link <soggiorno>
```

Stampa un indirizzo come `https://fairguest.khlumen.com/c/…#v1.…`. Mandalo all'ospite: funziona da qualsiasi telefono fino a due giorni dopo il check-out. Il tuo computer **non apre nessuna porta**: fa solo richieste in uscita.

**Come viaggiano i dati**
1. L'ospite compila il modulo sul suo telefono: stessa grafica e stesse domande del modulo di casa.
2. **Il telefono cifra i dati** con la chiave pubblica della tua cartella Fairguest, prima di spedirli.
3. Il servizio di inoltro (`fairguest.khlumen.com`) riceve solo testo cifrato e lo tiene in una casella del soggiorno.
4. Il tuo computer scarica e poi cancella dal servizio:
   - con `fairnight ospiti scarica`;
   - da solo ogni 5 minuti mentre `fairnight serve` è acceso;
   - prima di `ospiti elenco` e di `ospiti invia`.
5. I dati restano cifrati anche sul tuo computer: si aprono solo con la frase segreta.

**Cosa vede chi gestisce il servizio di inoltro**
- **Vede:** l'indirizzo IP del telefono e l'ora dell'invio, come per qualsiasi sito, e un testo cifrato sempre della stessa lunghezza.
- **Non vede:**
  - nomi e documenti;
  - quanti caratteri ha scritto l'ospite;
  - la tua chiave, l'alloggio e le date: stanno dopo il `#` del link, e i browser non li mandano mai al server.
- **Non tiene registri** delle richieste. Ogni casella si cancella da sola due giorni dopo il check-out.

**Cosa può fare chi ha il link:** aggiungere ospiti a quel soggiorno, non leggerli. Se un link finisce nelle mani sbagliate, controlla gli ospiti con `fairnight ospiti mostra` e cancella quelli in più con `fairnight ospiti cancella <soggiorno> --persona N --applica`.

**Controllare la pagina**

```
fairnight ospiti verifica-pagina
```

- Confronta ogni file che il servizio manda al telefono con l'impronta (SHA-256) della pagina di questa versione di Fairguest. Ogni riga deve dire `same`.
- Serve perché chi gestisce il servizio potrebbe cambiare la pagina per leggere i dati prima che vengano cifrati: questo è il limite di ogni modulo sul web.
- Chi vuole il controllo completo può ospitare il servizio da sé: istruzioni in [packages/fairguest-relay/README.md](../packages/fairguest-relay/README.md). Poi si mette il proprio indirizzo in `fairnight.config.json` con `"fairguestRelay": "https://…"`.

## La foto del documento

Nella pagina del link l'ospite può toccare «Scatta o scegli una foto» e inquadrare la parte del documento con le righe di lettere e `<<<`:
- sul passaporto, in fondo alla pagina con la foto;
- sulla carta d'identità elettronica o sul DNI spagnolo, sul retro.

**Cosa viene compilato:** nome, cognome, data di nascita, sesso, cittadinanza, tipo e numero del documento, Stato di rilascio. L'ospite li controlla e completa il resto. Comune di nascita e di rilascio non sono scritti in quelle righe.

**Dove succede tutto:**
- **La lettura avviene sul telefono.** Il programma di lettura (Tesseract) e il suo modello per queste righe sono file del servizio stesso: nessun altro sito viene contattato.
- **La foto non viene mai inviata né salvata.** Resta in memoria il tempo della lettura e poi viene cancellata. Fairguest non conserva copie del documento, in nessun posto: è quello che chiede il Garante privacy (nota del 29/04/2026).
- **Le cifre di controllo** di quelle righe dicono se la lettura è giusta. Se non tornano, l'ospite vede un avviso e controlla i dati.
- **Senza righe da leggere** (per esempio la vecchia carta d'identità cartacea) si compila a mano.

Schermate da telefono, con dati inventati: [pagina vuota](images/link/link-it-1-vuoto.png), [dati letti dalla foto](images/link/link-it-2-letto.png), [ospite salvato](images/link/link-it-3-salvato.png).

## Il riconoscimento dell'ospite

La sentenza del **Consiglio di Stato n. 9101/2025** ha rimesso in vigore la circolare del 18/11/2024: chi ospita deve verificare che la persona corrisponda al documento.

- La verifica si fa **di persona** oppure con un collegamento video **dal vivo**.
- **Non bastano** il solo invio del documento, una keybox o un codice.

Per questo Fairguest **non invia nulla ad Alloggiati Web finché non segni il riconoscimento**:

```
fairnight ospiti riconosciuto <soggiorno>
```

Il modulo compila i dati e ti fa risparmiare tempo, ma **non sostituisce il riconoscimento**.

## L'invio, una volta al giorno

```
fairnight ospiti                      # cosa scade e cosa è in ritardo
fairnight ospiti invia                # le schedine da inviare oggi: le prepara e le controlla, non invia nulla
fairnight ospiti invia --prova        # le fa controllare ad Alloggiati Web, senza registrarle
fairnight ospiti invia --applica      # le controlla e le invia
```

**Scadenze** (art. 109 TULPS):
- entro **24 ore dall'arrivo**;
- entro **6 ore** se il soggiorno dura 24 ore o meno.

Se un orario non è impostato, il conto parte dalla mezzanotte: la scadenza mostrata non è mai più tarda di quella vera. Anche la pagina del calendario (`fairnight serve`) mostra un promemoria quando c'è qualcosa in scadenza o in ritardo.

**Cosa fa `invia --applica`**
1. Chiede la frase segreta.
2. Chiede un token ad Alloggiati Web.
3. Fa sempre prima il **controllo** (`Test`) e invia (`Send`) solo i soggiorni con **tutte** le schedine corrette.
4. Per ogni soggiorno scrive l'esito. Se una schedina è sbagliata, mostra il codice di errore del servizio e non invia quel soggiorno.
5. Appena l'invio è accettato, **cancella i dati degli ospiti**: resta solo la riga «inviato il …».

**Limiti del servizio**
- Alloggiati Web accetta solo arrivi **di oggi o di ieri**. Per un arrivo più vecchio Fairguest te lo dice: in quel caso chiedi alla Questura come comunicarlo.
- Una schedina dichiara al massimo **30 giorni** di permanenza.
- Fairguest non invia mai due volte lo stesso soggiorno.

**Invio a mano dal portale**

```
fairnight ospiti prepara <soggiorno>
```

- Scrive il file di testo (righe da 168 caratteri) in `data/fairguest/`. Caricalo sul portale con «Invio File».
- Poi registra l'invio con `fairnight ospiti inviato <soggiorno>`.
- Il file contiene i dati in chiaro: viene cancellato quando registri l'invio.

### Invio automatico (da attivare apposta)

Si può far partire `fairnight ospiti invia --applica` da un'attività pianificata, per esempio ogni sera alle 21. Per farlo la frase segreta deve stare nella variabile `FAIRGUEST_FRASE` dell'attività, e ogni alloggio deve avere:

```json
"alloggiati": { "account": "principale", "autoSend": true }
```

Senza `autoSend: true` Fairguest si rifiuta di inviare senza un terminale davanti.

**I rischi, da conoscere prima di attivarlo:**
- **La frase sta sul computer** in chiaro, nella configurazione dell'attività. Chi accede al computer, o a un suo backup, può leggere i dati degli ospiti e le credenziali di Alloggiati Web. Proteggi il computer con una password e cifra il disco.
- **Il riconoscimento resta a te.** L'attività invia solo i soggiorni che hai segnato con `ospiti riconosciuto`. Gli altri restano lì e li vedi in `fairnight ospiti`.
- **Nessuno guarda gli errori nel momento in cui succedono.** Un errore del servizio o una schedina rifiutata finiscono nel registro dell'attività. Controlla ogni giorno `fairnight ospiti`: esce con codice 1 quando qualcosa è in ritardo.
- **Le credenziali cambiano.** Dopo un cambio password la vecchia chiave non funziona più: l'attività fallisce finché non salvi la nuova chiave.

## Le ricevute

Per ogni giorno di invio Alloggiati Web prepara una **ricevuta in PDF**:
- si scarica solo per gli **ultimi 30 giorni**, oggi escluso;
- va **conservata 5 anni** (DM 7/1/2013, art. 4-bis).

```
fairnight ospiti ricevute
```

- Scarica le ricevute che mancano e le salva in `data/fairguest/ricevute/`.
- Dopo 5 anni le cancella da solo.
- Lancialo almeno una volta a settimana: dopo 30 giorni la ricevuta non si scarica più.

## Conservazione dei dati

| Cosa | Quanto resta |
|---|---|
| Dati degli ospiti (cifrati) | fino all'invio accettato da Alloggiati Web, poi cancellati subito (DM 7/1/2013, art. 4-bis). Una prenotazione annullata si cancella subito |
| Foto o copie del documento | mai: la foto si legge sul telefono dell'ospite e non viene salvata né inviata |
| Servizio di inoltro del link | solo testo cifrato, cancellato appena scaricato; ogni casella si cancella da sola due giorni dopo il check-out |
| Ricevute di Alloggiati Web | 5 anni, poi cancellate |
| Credenziali di Alloggiati Web | sigillate, finché non le cambi |
| Tabelle dei codici | sul tuo computer, riscaricate ogni mese |

La cancellazione lavora sul file `data/fairnight.db`: **non tocca i backup**. Se fai copie della cartella, cancellale con la stessa regola.

## La prima prova vera

Il servizio **non ha un ambiente di prova separato**: anche il controllo (`Test`) gira sul servizio vero, con credenziali vere. Per questo il primo uso si fa con un host che lo accetta, in quest'ordine:

1. `fairnight ospiti credenziali --verifica`: chiede solo il token e lo controlla, non invia schedine.
2. Un soggiorno vero, con l'ospite riconosciuto, il giorno dell'arrivo:
   - `fairnight ospiti invia`, solo controllo locale;
   - poi `fairnight ospiti invia --prova`: Alloggiati Web controlla le schedine ma non le registra.
3. Solo se il controllo è tutto corretto, `fairnight ospiti invia --applica`.
4. Il giorno dopo, `fairnight ospiti ricevute`. Confronta la ricevuta con il portale.

**Da confermare con la prima prova [NV]:**
- il numero dei giorni di permanenza scritto con lo zero davanti (`03`);
- i nomi con le lettere accentate;
- il numero massimo di schedine per chiamata;
- la durata del token;
- la codifica del file caricato a mano (il manuale dice UTF-8, il DM 2013 parla di ASCII).

## Fonti

- [Portale Alloggiati Web](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/)
- [Manuale del web service, Rev. 01 del 24/01/2022](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Download/Manuali/MANUALEWS.pdf)
- [Manuale utente (cap. 12, tracciato del file)](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Download/Manuali/MANUALEALBERGHI.pdf)
- [Tabelle dei codici](https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Tabelle.aspx)
- [DM 16 settembre 2021, GU n. 246 del 14/10/2021](https://www.gazzettaufficiale.it/eli/id/2021/10/14/21A06000/sg)
- [Garante privacy, nota del 29/04/2026 sulle copie dei documenti](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/10244289)
- [Consiglio di Stato, sez. III, sentenza n. 9101/2025](https://mdp.giustizia-amministrativa.it/visualizza/?nodeRef=&schema=cds&nrg=202505732&nomeFile=202509101_11.html&subDir=Provvedimenti)
