# Fairguest e SES.HOSPEDAJES: l'invio dal tuo computer

Per gli alloggi in Spagna fuori dalla Catalogna (`"country": "ES"`) Fairguest prepara il **parte de viajeros** (PV) e la **reserva de hospedaje** (RH) del Real Decreto 933/2021 e li manda al servizio web del Ministerio del Interior.

> Versione in sviluppo (ottobre 2026). Non è un parere legale. I punti **[NV]** non sono ancora verificati con un uso vero.

[Versión en español](fairguest-ses.es.md)

## Lo stato oggi

| Pezzo | Stato |
|---|---|
| Configurazione: codice arrendador, codice establecimiento, ambiente | pronta |
| Utente e password del servizio web, sigillati nel database | pronti |
| Controllo dei dati e anteprima di cosa riceve SES | pronti |
| Invio con conferma, numero di lotto, esito (`consultaLote`), rifiuti e reinvio | pronti, provati solo con un servizio finto |
| **XML** del PV e della RH | **in attesa degli XSD del Ministero** |

Finché mancano gli XSD, `prepara` e `invia` si fermano **prima di qualsiasi collegamento** con questo messaggio: «the XML is not switched on yet». Nel frattempo i dati si inseriscono sul sito SES e si registrano con `fairnight ospiti inviato`.

## 1. Cosa ti serve

1. L'**alta del arrendador** sulla sede elettronica di SES.HOSPEDAJES, con certificato digitale o Cl@ve. Ti danno il **codigo de arrendador** (10 caratteri).
2. Ogni alloggio registrato ha un **codigo de establecimiento** (10 caratteri).
3. **Utente e password del servizio web**: sono diversi da quelli del sito (Guía visual, cap. 9). Il canale servizio web deve essere abilitato, altrimenti il Ministero risponde con l'errore 10120.
4. Per l'ambiente di prova servono credenziali di prova: si chiedono con la mail di [registro-ospiti.md](registro-ospiti.md#a-mail-per-le-credenziali-dellambiente-di-prova) **[NV]**.

## 2. La configurazione

Nel blocco `fairguest` dell'alloggio, in `fairnight.config.json`:

```json
"fairguest": {
  "country": "ES",
  "establishment": "0000000099",
  "professional": false,
  "checkInTime": "16:00",
  "checkOutTime": "11:00",
  "ses": {
    "landlord": "0000000001",
    "account": "principale",
    "environment": "test"
  }
}
```

- `establishment`: il codigo de establecimiento.
- `ses.landlord`: il codigo de arrendador.
- `ses.account`: il nome delle credenziali salvate. Serve solo con più arrendador; se manca vale `principale`.
- `ses.environment`: `"test"` (il servizio di prova del Ministero, **pre-ses**: non registra nulla) oppure `"production"`. Se manca vale `"test"`.

**Mai qui utente e password.** Si salvano così, una volta per ambiente:

```
fairnight ospiti credenziali --ses                        # ambiente di prova
fairnight ospiti credenziali --ses --ambiente produzione  # produzione
```

Fairnight le chiede in un terminale (la password senza eco) e le sigilla nel database con la tua chiave Fairguest. Si aprono solo con la frase segreta.

## 3. L'uso di tutti i giorni

```
fairnight ospiti                                  # cosa scade, cosa è in ritardo
fairnight ospiti prepara --ses <soggiorno>         # anteprima: i campi esatti che riceverà SES
fairnight ospiti invia --ses                       # quali soggiorni partirebbero, verso quale ambiente
fairnight ospiti invia --ses --applica             # invia, dopo che scrivi SEND
fairnight ospiti esito --ses                       # legge l'esito dei lotti inviati
```

- `--tipo prenotazione` manda la **RH**; senza `--tipo` parte il **PV** (check-in).
- Senza argomenti `invia` prende i PV degli arrivi fino a oggi e le RH dei soggiorni non finiti che non sono ancora stati comunicati.
- `--ambiente prova` manda sempre all'ambiente di prova, anche se l'alloggio è in produzione.
- `--ambiente produzione` funziona **solo** se la configurazione dice `"environment": "production"`. Sono due chiavi per la stessa porta.

**La conferma.** Con `--applica` Fairnight scrive quante comunicazioni partono, di che tipo e verso quale ambiente, e invia solo se scrivi `SEND`. Senza un terminale (un'attività pianificata) non invia mai.

## 4. Il registro, gli errori, il reinvio

Ogni invio resta in `data/fairnight.db`, con il numero di lotto e le risposte del Ministero. `fairnight ospiti mostra <soggiorno>` lo elenca.

| Cosa succede | Cosa registra Fairguest | Cosa fai tu |
|---|---|---|
| SES prende la richiesta e dà un lotto | `sent`, con il lotto | `fairnight ospiti esito --ses` dopo qualche minuto |
| Il lotto è ancora in lavorazione | niente | riprovi `esito` più tardi |
| Il lotto registra la comunicazione | `accepted`, con il codigoComunicacion | niente |
| Il lotto rifiuta la comunicazione | `rejected`, con l'errore del Ministero | correggi (`ospiti correggi`) e mandi di nuovo |
| SES rifiuta la richiesta (codice, password, servizio giù) | `rejected`, con il motivo | sistemi la causa e mandi di nuovo |
| La risposta non arriva (rete, timeout) | **niente** | controlli su «Consulta de comunicaciones» del sito SES **prima** di rimandare: la comunicazione potrebbe essere arrivata |

- Un soggiorno con un lotto in attesa o già accettato non parte una seconda volta.
- Una modifica dopo l'accettazione è una comunicazione nuova: oggi si fa sul sito SES.

**L'ambiente di prova non conta mai.** Gli invii di prova si registrano a parte (canale `ses-prova`):
- la scadenza resta aperta;
- non fanno cancellare i dati.

**Cancellazione.** Per un host non professionale i dati si cancellano appena il PV vero (produzione) è **accettato** (RD 933/2021, art. 5.4). Per un host professionale restano 3 anni.

## 5. Da dove vengono i campi

La mappatura è in `packages/fairguest/src/countries/es-ses-parte.ts`. Le fonti sono pubbliche:
- «Instrucciones para el alta masiva de comunicaciones» v1.1.0 (SGTIC, 08-01-2024), [Instrucciones.pdf](https://hospedajes.ses.mir.es/hospedajes-sede/assets/docs/Instrucciones.pdf):
  - figura 1 e § 3 per il PV;
  - figura 2 e § 4 per la RH;
  - § 7.1 per l'indirizzo;
  - § 7.2 per il pagamento;
  - § 8 per i codici;
- la specifica «MIR-HOSPE-DSI-WS Servicio de Comunicación» v3.1.2 per la busta SOAP e i lotti (copia di terzi, **[NV]**).

| Nostro campo | Parte de viajeros (PV) | Note |
|---|---|---|
| establishment | `solicitud/codigoEstablecimiento` | nella RH: `comunicacion/establecimiento/codigo` |
| reference, contractDate | `contrato/referencia`, `contrato/fechaContrato` | referencia al massimo 50 caratteri |
| checkIn + checkInTime | `contrato/fechaEntrada` | `AAAA-MM-DDThh:mm:ss`; senza ora mezzanotte (§ 4) |
| checkOut + checkOutTime | `contrato/fechaSalida` | come sopra |
| people, rooms, internet | `numPersonas`, `numHabitaciones`, `internet` | |
| payment.type | `contrato/pago/tipoPago` | **solo il tipo**: mai numero di carta, IBAN, titolare |
| givenName, surname1, surname2 | `persona/nombre`, `apellido1`, `apellido2` | |
| document | `tipoDocumento` (NIF, NIE, PAS, OTRO), `numeroDocumento`, `soporteDocumento` | il supporto solo per NIF e NIE |
| birthDate, nationality, sex | `fechaNacimiento`, `nacionalidad` (ISO 3166-1 alfa-3), `sexo` (H, M, O) | |
| address | `persona/direccion/…` | in Spagna `codigoMunicipio` INE di **5 cifre** (teniamo il codice di 6 con la cifra di controllo e togliamo l'ultima); all'estero `nombreMunicipio` |
| phone, phone2, email | `telefono`, `telefono2`, `correo` | almeno uno |
| kinship | `parentesco` | se nel gruppo c'è un minore; solo nel PV |

Ruoli: nel PV ogni persona è `VI` (viajero). Nella RH la prima è `TI` (titular) e le altre `VI`.

## 6. Per chi sviluppa: quando arrivano gli schemi

Un arrendador registrato scarica dalla sede elettronica la documentazione del servizio web in una cartella `openstay-ses-docs` accanto al repository, **mai dentro** (sezione 7b di [registro-ospiti.md](registro-ospiti.md#b-file-da-scaricare-dentro-ses)). Poi:

1. In `es-ses-parte.ts` si confronta `SES_SCHEMA_DRAFT` con gli XSD e con il WSDL. Si controllano:
   - i namespace;
   - se i figli sono qualificati;
   - i nomi delle operazioni SOAP;
   - i codici di stato dei lotti.
2. Si controlla l'ordine degli elementi contro le sequenze degli XSD.
3. Si riempie l'aggancio unico, `SES_SCHEMA`, con la data della verifica.
4. Il test `packages/fairguest/test/ses-xsd.test.ts` si accende da solo quando trova gli `.xsd` nella cartella, oppure in `OPENSTAY_SES_DOCS`. Valida ogni documento generato con `xmllint`, che va installato.
5. Prova nell'**ambiente di prova** del Ministero con dati inventati: `fairnight ospiti invia --ses --applica --ambiente prova`, poi `esito --ses`.
6. Solo dopo, e con un host che lo accetta, il primo invio in produzione.
