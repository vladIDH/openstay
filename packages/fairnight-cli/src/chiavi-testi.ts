/**
 * The words of `fairnight chiavi` and of a stop because the keys cannot be
 * opened. The language is the one `configura` chooses, as in `ospiti attiva`.
 */
import { existsSync, readFileSync } from "node:fs";
import { configPath, stripBom, type Io } from "./io.js";
import { setupLanguage, systemLocale } from "./lingua.js";

const FORGOT_EN = 'If you no longer remember it: "fairnight chiavi azzera", then "fairnight smoobu collega" or "fairnight beds24 collega" again.';
const FORGOT_IT = 'Se non la ricordi: "fairnight chiavi azzera", poi di nuovo "fairnight smoobu collega" o "fairnight beds24 collega".';
const FORGOT_ES = 'Si ya no la recuerdas: "fairnight chiavi azzera" y después otra vez "fairnight smoobu collega" o "fairnight beds24 collega".';

const en = {
  notHere: (server: boolean) =>
    `Smoobu and Beds24 keys are encrypted and the passphrase is not available here: nothing was read from or sent to them, no price was sent. ${
      server ? "Set FAIRNIGHT_FRASE_CHIAVI for this run" : 'To write it again on this computer: "fairnight chiavi ricorda"'
    }. ${FORGOT_EN}`,
  keychainDown: `The keychain of this computer did not answer, so the Smoobu and Beds24 keys stay closed: no price was sent. Try again after signing in; if it keeps failing, "fairnight chiavi ricorda" writes the passphrase again. ${FORGOT_EN}`,
  wrong: `Wrong passphrase for the Smoobu and Beds24 keys: nothing was opened or sent. ${FORGOT_EN}`,
  damaged: (file: string) => `${file} is damaged or was changed: nothing was opened or sent. Restore it from a backup, or use "fairnight chiavi azzera" and connect again.`,
  noKeysFile: (file: string) => `${file} is encrypted but the file with its key (chiavi-cifrate.json) is missing: restore it from a backup, or use "fairnight chiavi azzera" and connect again.`,
  needsTerminal: "This command needs a terminal: the passphrase is asked without echo.",
  passphrase: "Passphrase of the Smoobu and Beds24 keys: ",
  newPassphrase: "New passphrase (at least 12 characters, not the Fairguest one): ",
  again: "Type it again: ",
  differ: "The two passphrases differ: nothing was changed.",
  tooShort: "The passphrase must be at least 12 characters (a few words are easier to remember).",
  empty: "No passphrase given: nothing was done.",
  confirmEncrypt: "Encrypt the saved Smoobu and Beds24 keys? [y/N]: ",
  confirmClear: "Put the Smoobu and Beds24 keys back in clear, readable by anyone who reads this disk or a backup? [y/N]: ",
  confirmReset: (files: string) => `This deletes ${files} for good; you will have to connect again. Type AZZERA to go on: `,
  leftAsIs: "Nothing was changed.",
  nothingToEncrypt: "Everything saved is already encrypted.",
  encrypted: (n: number) => `Encrypted: ${n} file${n === 1 ? "" : "s"} of keys. New keys saved with "collega" are encrypted too.`,
  lost: "Write the passphrase down away from this computer: if you lose it, the keys cannot be opened and you have to connect again.",
  old: "Old backups still hold the keys in clear: if you worry about them, create new keys in Smoobu or Beds24 and connect again.",
  askRemember: "Keep the passphrase in this computer's keychain, so the autopilot can run alone? Without it, the daily run stops. [Y/n]: ",
  remembered: "Passphrase kept in this computer's keychain: the daily run can open the keys.",
  rememberFailed: 'The keychain of this computer did not accept it: the daily run stops until "fairnight chiavi ricorda" works.',
  noKeychain: "This computer has no keychain Fairnight can use: for a daily run, give FAIRNIGHT_FRASE_CHIAVI from your server's secret store.",
  notEncrypted: 'The keys are not encrypted: "fairnight chiavi cifra" does it.',
  cleared: "Keys back in clear, protected only by the file permissions. The passphrase no longer exists.",
  forgotten: "Passphrase removed from this computer's keychain: the daily run stops until it is written again.",
  reset: 'Encrypted keys deleted. Next: "fairnight smoobu collega" or "fairnight beds24 collega", then "fairnight chiavi cifra".',
  stateFile: (name: string, state: "none" | "clear" | "sealed") => `${name}: ${state === "none" ? "not connected" : state === "clear" ? "in clear" : "encrypted"}`,
  stateKeychain: (state: "yes" | "no" | "down" | "none") =>
    `Keychain: ${state === "yes" ? "holds the passphrase, the daily run can open the keys" : state === "no" ? 'no passphrase ("fairnight chiavi ricorda")' : state === "down" ? "did not answer" : "none on this computer (FAIRNIGHT_FRASE_CHIAVI on a server)"}`,
  aloneOk: "Encrypted keys: the daily run can open them.",
  aloneNo: 'Encrypted keys: the daily run CANNOT open them and sends no price. "fairnight chiavi stato" says why.',
};

export type KeyTexts = typeof en;

const it: KeyTexts = {
  notHere: (server) =>
    `Le chiavi di Smoobu e Beds24 sono cifrate e qui la passphrase non è disponibile: non ho letto né inviato nulla, nessun prezzo è partito. ${
      server ? "Imposta FAIRNIGHT_FRASE_CHIAVI per questo giro" : 'Per riscriverla su questo computer: "fairnight chiavi ricorda"'
    }. ${FORGOT_IT}`,
  keychainDown: `Il portachiavi di questo computer non ha risposto, quindi le chiavi di Smoobu e Beds24 restano chiuse: nessun prezzo è partito. Riprova dopo aver fatto l'accesso; se continua, "fairnight chiavi ricorda" riscrive la passphrase. ${FORGOT_IT}`,
  wrong: `Passphrase sbagliata per le chiavi di Smoobu e Beds24: non ho aperto né inviato nulla. ${FORGOT_IT}`,
  damaged: (file) => `${file} è danneggiato o è stato modificato: non ho aperto né inviato nulla. Ripristinalo da un backup, oppure usa "fairnight chiavi azzera" e ricollega.`,
  noKeysFile: (file) => `${file} è cifrato ma manca il file con la sua chiave (chiavi-cifrate.json): ripristinalo da un backup, oppure usa "fairnight chiavi azzera" e ricollega.`,
  needsTerminal: "Questo comando ha bisogno di un terminale: la passphrase si chiede senza mostrarla.",
  passphrase: "Passphrase delle chiavi di Smoobu e Beds24: ",
  newPassphrase: "Nuova passphrase (almeno 12 caratteri, non quella di Fairguest): ",
  again: "Scrivila di nuovo: ",
  differ: "Le due passphrase sono diverse: non ho cambiato nulla.",
  tooShort: "La passphrase deve avere almeno 12 caratteri (qualche parola si ricorda meglio).",
  empty: "Nessuna passphrase: non ho fatto nulla.",
  confirmEncrypt: "Cifro le chiavi salvate di Smoobu e Beds24? [s/N]: ",
  confirmClear: "Rimetto in chiaro le chiavi di Smoobu e Beds24, leggibili da chi legge questo disco o un backup? [s/N]: ",
  confirmReset: (files) => `Cancello per sempre ${files}; dovrai ricollegare. Scrivi AZZERA per continuare: `,
  leftAsIs: "Non ho cambiato nulla.",
  nothingToEncrypt: "Tutto quello che è salvato è già cifrato.",
  encrypted: (n) => `Cifrati: ${n} file di chiavi. Anche le chiavi salvate da ora con "collega" saranno cifrate.`,
  lost: "Scrivi la passphrase lontano da questo computer: se la perdi, le chiavi non si aprono più e devi ricollegare.",
  old: "I vecchi backup contengono ancora le chiavi in chiaro: se ti preoccupano, crea chiavi nuove su Smoobu o Beds24 e ricollega.",
  askRemember: "Tengo la passphrase nel portachiavi di questo computer, così il pilota gira da solo? Senza, il giro quotidiano si ferma. [S/n]: ",
  remembered: "Passphrase tenuta nel portachiavi di questo computer: il giro quotidiano può aprire le chiavi.",
  rememberFailed: 'Il portachiavi di questo computer non l\'ha accettata: il giro quotidiano si ferma finché "fairnight chiavi ricorda" non funziona.',
  noKeychain: "Questo computer non ha un portachiavi che Fairnight possa usare: per un giro quotidiano passa FAIRNIGHT_FRASE_CHIAVI dal gestore di segreti del server.",
  notEncrypted: 'Le chiavi non sono cifrate: lo fa "fairnight chiavi cifra".',
  cleared: "Chiavi di nuovo in chiaro, protette solo dai permessi del file. La passphrase non esiste più.",
  forgotten: "Passphrase tolta dal portachiavi di questo computer: il giro quotidiano si ferma finché non la riscrivi.",
  reset: 'Chiavi cifrate cancellate. Ora: "fairnight smoobu collega" o "fairnight beds24 collega", poi "fairnight chiavi cifra".',
  stateFile: (name, state) => `${name}: ${state === "none" ? "non collegato" : state === "clear" ? "in chiaro" : "cifrato"}`,
  stateKeychain: (state) =>
    `Portachiavi: ${state === "yes" ? "ha la passphrase, il giro quotidiano può aprire le chiavi" : state === "no" ? 'senza passphrase ("fairnight chiavi ricorda")' : state === "down" ? "non ha risposto" : "assente su questo computer (FAIRNIGHT_FRASE_CHIAVI su un server)"}`,
  aloneOk: "Chiavi cifrate: il giro quotidiano può aprirle.",
  aloneNo: 'Chiavi cifrate: il giro quotidiano NON può aprirle e non manda prezzi. "fairnight chiavi stato" dice perché.',
};

const es: KeyTexts = {
  notHere: (server) =>
    `Las claves de Smoobu y Beds24 están cifradas y aquí la frase de paso no está disponible: no he leído ni enviado nada, no ha salido ningún precio. ${
      server ? "Define FAIRNIGHT_FRASE_CHIAVI para esta ejecución" : 'Para volver a escribirla en este ordenador: "fairnight chiavi ricorda"'
    }. ${FORGOT_ES}`,
  keychainDown: `El llavero de este ordenador no ha respondido, así que las claves de Smoobu y Beds24 siguen cerradas: no ha salido ningún precio. Vuelve a intentarlo después de iniciar sesión; si sigue fallando, "fairnight chiavi ricorda" vuelve a escribir la frase de paso. ${FORGOT_ES}`,
  wrong: `Frase de paso incorrecta para las claves de Smoobu y Beds24: no he abierto ni enviado nada. ${FORGOT_ES}`,
  damaged: (file) => `${file} está dañado o ha sido modificado: no he abierto ni enviado nada. Restáuralo desde una copia, o usa "fairnight chiavi azzera" y vuelve a conectar.`,
  noKeysFile: (file) => `${file} está cifrado pero falta el archivo con su clave (chiavi-cifrate.json): restáuralo desde una copia, o usa "fairnight chiavi azzera" y vuelve a conectar.`,
  needsTerminal: "Este comando necesita un terminal: la frase de paso se pide sin mostrarla.",
  passphrase: "Frase de paso de las claves de Smoobu y Beds24: ",
  newPassphrase: "Nueva frase de paso (al menos 12 caracteres, no la de Fairguest): ",
  again: "Escríbela otra vez: ",
  differ: "Las dos frases de paso son distintas: no he cambiado nada.",
  tooShort: "La frase de paso debe tener al menos 12 caracteres (unas palabras se recuerdan mejor).",
  empty: "Ninguna frase de paso: no he hecho nada.",
  confirmEncrypt: "¿Cifro las claves guardadas de Smoobu y Beds24? [s/N]: ",
  confirmClear: "¿Vuelvo a dejar en claro las claves de Smoobu y Beds24, legibles por quien lea este disco o una copia? [s/N]: ",
  confirmReset: (files) => `Borro para siempre ${files}; tendrás que volver a conectar. Escribe AZZERA para continuar: `,
  leftAsIs: "No he cambiado nada.",
  nothingToEncrypt: "Todo lo guardado ya está cifrado.",
  encrypted: (n) => `Cifrados: ${n} archivo${n === 1 ? "" : "s"} de claves. Las claves que guardes desde ahora con "collega" también irán cifradas.`,
  lost: "Apunta la frase de paso lejos de este ordenador: si la pierdes, las claves no se abren y tienes que volver a conectar.",
  old: "Las copias antiguas siguen teniendo las claves en claro: si te preocupan, crea claves nuevas en Smoobu o Beds24 y vuelve a conectar.",
  askRemember: "¿Guardo la frase de paso en el llavero de este ordenador, para que el piloto funcione solo? Sin ella, la ejecución diaria se detiene. [S/n]: ",
  remembered: "Frase de paso guardada en el llavero de este ordenador: la ejecución diaria puede abrir las claves.",
  rememberFailed: 'El llavero de este ordenador no la ha aceptado: la ejecución diaria se detiene hasta que "fairnight chiavi ricorda" funcione.',
  noKeychain: "Este ordenador no tiene un llavero que Fairnight pueda usar: para una ejecución diaria, pasa FAIRNIGHT_FRASE_CHIAVI desde el gestor de secretos del servidor.",
  notEncrypted: 'Las claves no están cifradas: lo hace "fairnight chiavi cifra".',
  cleared: "Claves otra vez en claro, protegidas solo por los permisos del archivo. La frase de paso ya no existe.",
  forgotten: "Frase de paso quitada del llavero de este ordenador: la ejecución diaria se detiene hasta que la vuelvas a escribir.",
  reset: 'Claves cifradas borradas. Ahora: "fairnight smoobu collega" o "fairnight beds24 collega", y después "fairnight chiavi cifra".',
  stateFile: (name, state) => `${name}: ${state === "none" ? "sin conectar" : state === "clear" ? "en claro" : "cifrado"}`,
  stateKeychain: (state) =>
    `Llavero: ${state === "yes" ? "tiene la frase de paso, la ejecución diaria puede abrir las claves" : state === "no" ? 'sin frase de paso ("fairnight chiavi ricorda")' : state === "down" ? "no ha respondido" : "no hay en este ordenador (FAIRNIGHT_FRASE_CHIAVI en un servidor)"}`,
  aloneOk: "Claves cifradas: la ejecución diaria puede abrirlas.",
  aloneNo: 'Claves cifradas: la ejecución diaria NO puede abrirlas y no envía precios. "fairnight chiavi stato" explica por qué.',
};

/** Read straight from the file: these words are needed even when the rest of the config is not valid. */
function configLanguage(dir: string): unknown {
  if (!existsSync(configPath(dir))) return undefined;
  try {
    return (JSON.parse(stripBom(readFileSync(configPath(dir), "utf8"))) as { language?: unknown }).language;
  } catch {
    return undefined;
  }
}

export function keyTexts(dir: string, io: Pick<Io, "env" | "locale">): KeyTexts {
  const language = configLanguage(dir);
  if (language === "en") return en;
  return setupLanguage(language, io.locale ?? systemLocale(io.env ?? {})) === "es" ? es : it;
}
