/**
 * Words of the /risposte page and of the guided house file, in Italian,
 * Spanish and English (the languages of the calendar page).
 */
import type { Flag, StaleReason } from "fairhello";
import type { Language } from "../lingua.js";

export interface HelloWords {
  langName: string;
  title: string;
  intro: string;
  read: string;
  reading: string;
  readDone: (drafts: number, messages: number) => string;
  readFailed: string;
  noDrafts: string;
  waiting: (n: number) => string;
  stale: (n: number) => string;
  stay: string;
  guests: (n: number) => string;
  language: string;
  conversation: string;
  guest: string;
  host: string;
  channelNote: string;
  draft: string;
  send: string;
  discard: string;
  needsHost: string;
  note: string;
  free: string;
  freeBefore: string;
  freeAfter: string;
  noneFree: string;
  priceHint: string;
  flags: Record<Flag, string>;
  reasons: Record<StaleReason | "price" | "not_found" | "error", string>;
  sent: string;
  discarded: string;
  failedBefore: string;
  backToCalendar: string;
  forbidden: string;
  privacy: string;
  house: {
    intro: string;
    exists: (file: string) => string;
    written: (file: string) => string;
    questions: { heading: string; ask: string }[];
    titleAsk: string;
    codesHeading: string;
    codesAsk: string;
    skip: string;
  };
}

const IT: HelloWords = {
  langName: "Italiano",
  title: "Risposte agli ospiti",
  intro: "Bozze scritte dall'assistente. Nulla parte senza di te: leggi, correggi se serve, poi invia.",
  read: "Leggi i nuovi messaggi",
  reading: "Lettura in corso…",
  readDone: (d, m) => `Letti ${m} messaggi nuovi, scritte ${d} bozze.`,
  readFailed: "Lettura non riuscita:",
  noDrafts: "Nessuna risposta da approvare.",
  waiting: (n) => (n === 1 ? "1 risposta da approvare" : `${n} risposte da approvare`),
  stale: (n) => (n === 1 ? "1 bozza superata" : `${n} bozze superate`),
  stay: "Soggiorno",
  guests: (n) => (n === 1 ? "1 ospite" : `${n} ospiti`),
  language: "Lingua",
  conversation: "Conversazione",
  guest: "Ospite",
  host: "Tu",
  channelNote: "Canale",
  draft: "Bozza (puoi modificarla)",
  send: "Approva e invia",
  discard: "Scarta",
  needsHost: "Da guardare con attenzione",
  note: "Nota dell'assistente",
  free: "Notti libere vicine (con il prezzo di Fairnight, solo per te)",
  freeBefore: "Prima dell'arrivo",
  freeAfter: "Dopo la partenza",
  noneFree: "nessuna",
  priceHint: "La bozza non contiene mai prezzi: se vuoi proporne uno, scrivilo tu.",
  flags: { price: "contiene un prezzo: modificala prima di inviarla", money: "soldi", complaint: "reclamo", cancellation: "cancellazione", emergency: "emergenza" },
  reasons: {
    cancelled: "Prenotazione cancellata",
    already_sent: "Già inviata",
    discarded: "Scartata",
    superseded: "C'è una bozza più recente",
    host_turn: "Hai già risposto",
    newer_message: "L'ospite ha scritto di nuovo: arriva una nuova bozza alla prossima lettura",
    no_message: "Nessun messaggio dell'ospite",
    stay_ended: "Soggiorno concluso",
    price: "La bozza contiene un prezzo: modificala prima di inviarla",
    not_found: "Bozza non trovata",
    error: "Invio non riuscito",
  },
  sent: "Risposta inviata.",
  discarded: "Bozza scartata.",
  failedBefore: "Invio precedente non riuscito:",
  backToCalendar: "Calendario",
  forbidden: "Questa pagina si apre solo da questo computer.",
  privacy: "I messaggi restano su questo computer. Per scrivere una bozza, l'ultima parte della conversazione e la scheda della casa vanno al modello che hai scelto.",
  house: {
    intro: "Scheda della casa per l'assistente. Rispondi in poche righe; Invio vuoto salta la domanda. Niente prezzi: l'assistente non li scrive mai.",
    exists: (f) => `${f} esiste già: modificala con un editor di testo.`,
    written: (f) => `Scritta ${f}. Puoi modificarla quando vuoi con un editor di testo.`,
    titleAsk: "Nome della casa per gli ospiti: ",
    questions: [
      { heading: "Check-in", ask: "Check-in: da che ora, come si entra (senza codici): " },
      { heading: "Check-out", ask: "Check-out: entro che ora, cosa fare con le chiavi: " },
      { heading: "Wifi", ask: "Wifi: nome della rete e dove trovare la password: " },
      { heading: "Parcheggio", ask: "Parcheggio: " },
      { heading: "Regole della casa", ask: "Regole della casa (fumo, animali, feste, silenzio): " },
      { heading: "Dotazioni", ask: "Dotazioni (culla, lavatrice, aria condizionata…): " },
      { heading: "Come arrivare", ask: "Come arrivare (aeroporto, mezzi): " },
      { heading: "Consigli in zona", ask: "Consigli in zona (spesa, ristoranti, spiagge): " },
      { heading: "Emergenze", ask: "Emergenze e reperibilità: " },
    ],
    codesHeading: "Codici d'accesso",
    codesAsk: "Codici d'accesso (cassetta delle chiavi, porta, password wifi se la vuoi dare solo durante il soggiorno): ",
    skip: "(saltata)",
  },
};

const ES: HelloWords = {
  langName: "Español",
  title: "Respuestas a los huéspedes",
  intro: "Borradores escritos por el asistente. Nada sale sin ti: lee, corrige si hace falta y envía.",
  read: "Leer mensajes nuevos",
  reading: "Leyendo…",
  readDone: (d, m) => `Leídos ${m} mensajes nuevos, escritos ${d} borradores.`,
  readFailed: "No se pudo leer:",
  noDrafts: "No hay respuestas por aprobar.",
  waiting: (n) => (n === 1 ? "1 respuesta por aprobar" : `${n} respuestas por aprobar`),
  stale: (n) => (n === 1 ? "1 borrador superado" : `${n} borradores superados`),
  stay: "Estancia",
  guests: (n) => (n === 1 ? "1 huésped" : `${n} huéspedes`),
  language: "Idioma",
  conversation: "Conversación",
  guest: "Huésped",
  host: "Tú",
  channelNote: "Canal",
  draft: "Borrador (puedes cambiarlo)",
  send: "Aprobar y enviar",
  discard: "Descartar",
  needsHost: "Revisar con atención",
  note: "Nota del asistente",
  free: "Noches libres cercanas (con el precio de Fairnight, solo para ti)",
  freeBefore: "Antes de la llegada",
  freeAfter: "Después de la salida",
  noneFree: "ninguna",
  priceHint: "El borrador nunca contiene precios: si quieres proponer uno, escríbelo tú.",
  flags: { price: "contiene un precio: cámbialo antes de enviarlo", money: "dinero", complaint: "queja", cancellation: "cancelación", emergency: "emergencia" },
  reasons: {
    cancelled: "Reserva cancelada",
    already_sent: "Ya enviada",
    discarded: "Descartado",
    superseded: "Hay un borrador más reciente",
    host_turn: "Ya has respondido",
    newer_message: "El huésped ha vuelto a escribir: llegará un borrador nuevo en la próxima lectura",
    no_message: "Ningún mensaje del huésped",
    stay_ended: "Estancia terminada",
    price: "El borrador contiene un precio: cámbialo antes de enviarlo",
    not_found: "Borrador no encontrado",
    error: "No se pudo enviar",
  },
  sent: "Respuesta enviada.",
  discarded: "Borrador descartado.",
  failedBefore: "El envío anterior falló:",
  backToCalendar: "Calendario",
  forbidden: "Esta página solo se abre desde este ordenador.",
  privacy: "Los mensajes se quedan en este ordenador. Para escribir un borrador, la última parte de la conversación y la ficha de la casa van al modelo que has elegido.",
  house: {
    intro: "Ficha de la casa para el asistente. Responde en pocas líneas; Intro vacío salta la pregunta. Sin precios: el asistente nunca los escribe.",
    exists: (f) => `${f} ya existe: cámbiala con un editor de texto.`,
    written: (f) => `Escrita ${f}. Puedes cambiarla cuando quieras con un editor de texto.`,
    titleAsk: "Nombre de la casa para los huéspedes: ",
    questions: [
      { heading: "Check-in", ask: "Check-in: desde qué hora, cómo se entra (sin códigos): " },
      { heading: "Check-out", ask: "Check-out: antes de qué hora, qué hacer con las llaves: " },
      { heading: "Wifi", ask: "Wifi: nombre de la red y dónde está la contraseña: " },
      { heading: "Aparcamiento", ask: "Aparcamiento: " },
      { heading: "Normas de la casa", ask: "Normas de la casa (fumar, mascotas, fiestas, silencio): " },
      { heading: "Equipamiento", ask: "Equipamiento (cuna, lavadora, aire acondicionado…): " },
      { heading: "Cómo llegar", ask: "Cómo llegar (aeropuerto, transporte): " },
      { heading: "Consejos de la zona", ask: "Consejos de la zona (compras, restaurantes, playas): " },
      { heading: "Emergencias", ask: "Emergencias y contacto: " },
    ],
    codesHeading: "Códigos de acceso",
    codesAsk: "Códigos de acceso (caja de llaves, puerta, contraseña wifi si solo la das durante la estancia): ",
    skip: "(saltada)",
  },
};

const EN: HelloWords = {
  langName: "English",
  title: "Replies to guests",
  intro: "Drafts written by the assistant. Nothing goes out without you: read, change if needed, then send.",
  read: "Read new messages",
  reading: "Reading…",
  readDone: (d, m) => `Read ${m} new messages, wrote ${d} drafts.`,
  readFailed: "Reading failed:",
  noDrafts: "No replies to approve.",
  waiting: (n) => (n === 1 ? "1 reply to approve" : `${n} replies to approve`),
  stale: (n) => (n === 1 ? "1 outdated draft" : `${n} outdated drafts`),
  stay: "Stay",
  guests: (n) => (n === 1 ? "1 guest" : `${n} guests`),
  language: "Language",
  conversation: "Conversation",
  guest: "Guest",
  host: "You",
  channelNote: "Channel",
  draft: "Draft (you can change it)",
  send: "Approve and send",
  discard: "Discard",
  needsHost: "Look at this carefully",
  note: "Assistant's note",
  free: "Free nights nearby (with Fairnight's price, for you only)",
  freeBefore: "Before arrival",
  freeAfter: "After departure",
  noneFree: "none",
  priceHint: "Drafts never contain prices: if you want to offer one, write it yourself.",
  flags: { price: "contains a price: change it before sending", money: "money", complaint: "complaint", cancellation: "cancellation", emergency: "emergency" },
  reasons: {
    cancelled: "Booking cancelled",
    already_sent: "Already sent",
    discarded: "Discarded",
    superseded: "There is a newer draft",
    host_turn: "You already answered",
    newer_message: "The guest wrote again: a new draft comes with the next reading",
    no_message: "No message from the guest",
    stay_ended: "Stay over",
    price: "The draft contains a price: change it before sending",
    not_found: "Draft not found",
    error: "Sending failed",
  },
  sent: "Reply sent.",
  discarded: "Draft discarded.",
  failedBefore: "The last attempt failed:",
  backToCalendar: "Calendar",
  forbidden: "This page opens only on this computer.",
  privacy: "Messages stay on this computer. To write a draft, the last part of the conversation and the house file go to the model you chose.",
  house: {
    intro: "House file for the assistant. Answer in a few lines; an empty Enter skips the question. No prices: the assistant never writes them.",
    exists: (f) => `${f} already exists: change it with a text editor.`,
    written: (f) => `Wrote ${f}. Change it whenever you like with a text editor.`,
    titleAsk: "Name of the house for guests: ",
    questions: [
      { heading: "Check-in", ask: "Check-in: from what time, how to get in (no codes): " },
      { heading: "Check-out", ask: "Check-out: by what time, what to do with the keys: " },
      { heading: "Wifi", ask: "Wifi: network name and where to find the password: " },
      { heading: "Parking", ask: "Parking: " },
      { heading: "House rules", ask: "House rules (smoking, pets, parties, quiet hours): " },
      { heading: "Amenities", ask: "Amenities (cot, washing machine, air conditioning…): " },
      { heading: "Getting here", ask: "Getting here (airport, transport): " },
      { heading: "Local tips", ask: "Local tips (shops, restaurants, beaches): " },
      { heading: "Emergencies", ask: "Emergencies and how to reach you: " },
    ],
    codesHeading: "Access codes",
    codesAsk: "Access codes (key box, door, wifi password if you give it only during the stay): ",
    skip: "(skipped)",
  },
};

export const HELLO_WORDS: Record<Language, HelloWords> = { it: IT, es: ES, en: EN };
