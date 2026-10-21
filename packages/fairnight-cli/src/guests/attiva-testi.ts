/**
 * The words of `fairnight ospiti attiva` and `fairnight ospiti frase`: the
 * first Fairguest commands a host runs, often right after `configura`.
 *
 * Italian or Spanish as `configura` chooses them (the calendar language in
 * the config, else the computer's), English when the calendar page is in English.
 */
import type { HostConfig } from "../config.js";
import type { Io } from "../io.js";
import { setupLanguage, systemLocale } from "../lingua.js";

const en = {
  alreadyOn: 'Guest registration is already on in this folder. To change the passphrase: "fairnight ospiti frase".',
  needsTerminal: "Choosing a passphrase needs a terminal: it is asked twice, without echo.",
  newPassphrase: "New passphrase (at least 12 characters, a few words are easier to remember): ",
  again: "Type it again: ",
  differ: "The two passphrases differ: nothing was changed.",
  tooShort: "The passphrase must be at least 12 characters (a few words are easier to remember).",
  current: "Current passphrase: ",
  on: "Guest registration is on. The guests' data will be stored encrypted in data/fairnight.db.",
  changed: "Passphrase changed. Only the key was re-encrypted: the guests' data is the same. The old passphrase no longer works.",
  lost: [
    "Write the passphrase down and keep it somewhere safe, away from this computer.",
    "If it is lost, the guests' data cannot be opened again: not by you, not by us, not by anyone.",
  ],
  tablesDone: "Downloaded the Alloggiati Web code tables (municipalities, states, documents) from the portal.",
  tablesFailed: (error: string) => `The Alloggiati Web code tables could not be downloaded now (${error}): run "fairnight ospiti tabelle" later.`,
  italyCredentials: 'Italy: save the Alloggiati Web credentials with "fairnight ospiti credenziali".',
  noBlock: 'Next: add a "fairguest" block to the listings whose guests you register, then "fairnight sync".',
  toRegister: (n: number) => `${n} stay${n === 1 ? "" : "s"} to register, from the calendars already read. Next: "fairnight ospiti".`,
};

export type ActivateTexts = typeof en;

const it: ActivateTexts = {
  alreadyOn: 'La registrazione degli ospiti è già attiva in questa cartella. Per cambiare la frase segreta: "fairnight ospiti frase".',
  needsTerminal: "Per scegliere la frase segreta serve una finestra del terminale: si chiede due volte e non si vede mentre la scrivi.",
  newPassphrase: "Nuova frase segreta (almeno 12 caratteri, qualche parola si ricorda meglio): ",
  again: "Scrivila di nuovo: ",
  differ: "Le due frasi sono diverse: non ho cambiato niente.",
  tooShort: "La frase segreta deve avere almeno 12 caratteri (qualche parola si ricorda meglio).",
  current: "Frase segreta di adesso: ",
  on: "La registrazione degli ospiti è attiva. I dati degli ospiti saranno salvati cifrati in data/fairnight.db.",
  changed: "Frase segreta cambiata. È stata cifrata di nuovo solo la chiave: i dati degli ospiti sono gli stessi. La frase vecchia non funziona più.",
  lost: [
    "Scrivi la frase segreta su un foglio e tienila in un posto sicuro, lontano da questo computer.",
    "Se la perdi, i dati degli ospiti non si possono più aprire: né tu, né noi, né nessun altro.",
  ],
  tablesDone: "Ho scaricato dal portale le tabelle dei codici di Alloggiati Web (comuni, Stati, documenti).",
  tablesFailed: (error) => `Le tabelle dei codici di Alloggiati Web adesso non si scaricano (${error}): più tardi lancia "fairnight ospiti tabelle".`,
  italyCredentials: 'Italia: salva le credenziali di Alloggiati Web con "fairnight ospiti credenziali".',
  noBlock: 'Adesso aggiungi un blocco "fairguest" alle case di cui registri gli ospiti, poi lancia "fairnight sync".',
  toRegister: (n) => `${n === 1 ? "1 soggiorno" : `${n} soggiorni`} da registrare, dai calendari già letti. Poi: "fairnight ospiti".`,
};

const es: ActivateTexts = {
  alreadyOn: 'El registro de viajeros ya está activado en esta carpeta. Para cambiar la frase secreta: "fairnight ospiti frase".',
  needsTerminal: "Para elegir la frase secreta hace falta una ventana del terminal: se pide dos veces y no se ve mientras la escribes.",
  newPassphrase: "Nueva frase secreta (al menos 12 caracteres, unas cuantas palabras se recuerdan mejor): ",
  again: "Escríbela otra vez: ",
  differ: "Las dos frases no coinciden: no he cambiado nada.",
  tooShort: "La frase secreta tiene que tener al menos 12 caracteres (unas cuantas palabras se recuerdan mejor).",
  current: "Frase secreta actual: ",
  on: "El registro de viajeros está activado. Los datos de los huéspedes se guardarán cifrados en data/fairnight.db.",
  changed: "Frase secreta cambiada. Solo se ha vuelto a cifrar la clave: los datos de los huéspedes son los mismos. La frase antigua ya no funciona.",
  lost: [
    "Apunta la frase secreta en un papel y guárdala en un sitio seguro, lejos de este ordenador.",
    "Si la pierdes, los datos de los huéspedes ya no se pueden abrir: ni tú, ni nosotros, ni nadie.",
  ],
  tablesDone: "He descargado del portal las tablas de códigos de Alloggiati Web (municipios, estados, documentos).",
  tablesFailed: (error) => `Ahora no se pueden descargar las tablas de códigos de Alloggiati Web (${error}): más tarde ejecuta "fairnight ospiti tabelle".`,
  italyCredentials: 'Italia: guarda las credenciales de Alloggiati Web con "fairnight ospiti credenziali".',
  noBlock: 'Ahora añade un bloque "fairguest" a los alojamientos cuyos huéspedes registras y luego ejecuta "fairnight sync".',
  toRegister: (n) => `${n === 1 ? "1 estancia" : `${n} estancias`} por registrar, de los calendarios ya leídos. Después: "fairnight ospiti".`,
};

export function activateTexts(config: HostConfig, io: Io): ActivateTexts {
  if (config.language === "en") return en;
  return setupLanguage(config.language, io.locale ?? systemLocale(io.env ?? {})) === "es" ? es : it;
}
