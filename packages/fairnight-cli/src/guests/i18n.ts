/**
 * The words of the check-in form in Spanish, English and Italian. The guest
 * sees only these; the host's commands stay in English like the rest of the CLI.
 */
import type { DocumentType, Kinship, PaymentType, Sex } from "fairguest";

export const LANGS = ["es", "en", "it"] as const;
export type Lang = (typeof LANGS)[number];

export interface Words {
  langName: string;
  title: string;
  stay: string;
  registered: (n: number) => string;
  saved: (n: number) => string;
  addAnother: string;
  finished: string;
  intro: string;
  firstGuest: string;
  nextGuest: (n: number) => string;
  sections: { person: string; document: string; address: string; contact: string; payment: string };
  fields: Record<string, string>;
  hints: Record<string, string>;
  choose: string;
  sex: Record<Sex, string>;
  documentTypes: Record<DocumentType, string>;
  kinship: Record<Kinship, string>;
  payment: Record<PaymentType, string>;
  paymentNote: string;
  save: string;
  required: string;
  invalid: string;
  contactMissing: string;
  fix: string;
  privacy: string;
  /** The three steps shown at the top: the guest's details, the document, the confirmation. */
  steps: { data: string; document: string; confirm: string };
  stepLabel: (n: number) => string;
  /** One line on what happens to the data, shown at the top. Only what the form really does. */
  privacyShort: string;
  /** A message for each kind of field, saying the rule it did not meet. */
  invalidFor: Record<string, string>;
  /** What changes for a listing in Italy (Alloggiati Web): the law, the privacy line, the hints. */
  italy: {
    intro: string;
    privacy: string;
    privacyShort: string;
    surname: string;
    kinshipHint: string;
    birthPlaceHint: string;
    docPlaceHint: string;
    noDocument: string;
  };
  notFound: string;
  notFoundText: string;
  forbidden: string;
  forbiddenText: string;
  tooMany: string;
}

const es: Words = {
  langName: "Español",
  title: "Registro de viajeros",
  stay: "Estancia",
  registered: (n) => (n === 1 ? "1 viajero registrado" : `${n} viajeros registrados`),
  saved: (n) => `Viajero ${n} guardado.`,
  addAnother: "Añadir otro viajero",
  finished: "Si ya están todos, puede cerrar esta página.",
  intro: "La ley española (Real Decreto 933/2021) obliga al alojamiento a comunicar a la policía los datos de cada persona que se aloja. Rellene un formulario por persona, menores incluidos.",
  firstGuest: "Viajero 1 (titular de la reserva)",
  nextGuest: (n) => `Viajero ${n}`,
  sections: { person: "Persona", document: "Documento de identidad", address: "Dirección de residencia", contact: "Contacto", payment: "Pago" },
  fields: {
    givenName: "Nombre",
    surname1: "Primer apellido",
    surname2: "Segundo apellido",
    birthDate: "Fecha de nacimiento",
    sex: "Sexo",
    nationality: "Nacionalidad",
    docType: "Tipo de documento",
    docNumber: "Número de documento",
    docSupport: "Número de soporte",
    docIssued: "Fecha de expedición",
    docSpanish: "Pasaporte expedido en España",
    country: "País",
    street: "Dirección",
    postalCode: "Código postal",
    locality: "Localidad",
    phone: "Teléfono",
    email: "Correo electrónico",
    kinship: "Parentesco con el titular",
    payment: "Tipo de pago",
    birthCountry: "País de nacimiento",
    birthPlace: "Municipio de nacimiento",
    birthProvince: "Provincia de nacimiento",
    docCountry: "País de expedición",
    docPlace: "Municipio de expedición",
    docProvince: "Provincia de expedición",
  },
  hints: {
    surname2: "Obligatorio con DNI español.",
    docNumber: "Obligatorio a partir de 14 años.",
    docSupport: "Solo DNI o NIE españoles: 9 caracteres.",
    contact: "Basta con uno de los dos.",
    kinship: "Solo para menores de edad.",
  },
  choose: "Elija…",
  sex: { female: "Mujer", male: "Hombre", other: "Otro" },
  documentTypes: {
    dni: "DNI / NIF español",
    nie: "NIE (extranjero en España)",
    passport: "Pasaporte",
    id_card: "Documento de identidad",
    electronic_id: "Carta de identidad electrónica italiana (CIE)",
    driving_licence: "Permiso de conducir",
    other: "Otro documento de identidad",
  },
  kinship: {
    parent: "Padre / madre",
    child: "Hijo / hija",
    sibling: "Hermano / hermana",
    spouse: "Cónyuge",
    grandparent: "Abuelo / abuela",
    grandchild: "Nieto / nieta",
    great_grandparent: "Bisabuelo / bisabuela",
    great_grandchild: "Bisnieto / bisnieta",
    uncle_aunt: "Tío / tía",
    nephew_niece: "Sobrino / sobrina",
    parent_in_law: "Suegro / suegra",
    child_in_law: "Yerno / nuera",
    sibling_in_law: "Cuñado / cuñada",
    guardian: "Tutor / tutora",
    other: "Otro",
  },
  payment: {
    platform: "Plataforma (Airbnb, Booking…)",
    card: "Tarjeta",
    cash: "Efectivo",
    transfer: "Transferencia",
    mobile: "Pago por móvil",
    voucher: "Tarjeta regalo",
    at_destination: "Pago en destino",
    other: "Otro",
  },
  paymentNote: "Solo el tipo de pago. Nunca le pediremos números de tarjeta ni de cuenta.",
  save: "Guardar viajero",
  required: "Obligatorio",
  invalid: "Revise este dato",
  contactMissing: "Indique un teléfono o un correo electrónico",
  fix: "Revise los campos marcados.",
  privacy:
    "Sus datos se guardan cifrados solo en el ordenador del anfitrión y se envían únicamente a la policía (SES.HOSPEDAJES o Mossos d'Esquadra). Se borran cuando la ley lo permite: después del envío, o a los 3 años si el anfitrión es profesional.",
  notFound: "Enlace no válido",
  notFoundText: "Este enlace de registro no existe o ha caducado. Pida uno nuevo al anfitrión.",
  forbidden: "Solo en la red local",
  steps: { data: "Sus datos", document: "Documento", confirm: "Confirmación" },
  stepLabel: (n) => `Paso ${n} de 3`,
  privacyShort: "Sus datos se guardan cifrados en el ordenador del anfitrión, solo se envían a la policía y se borran solos cuando la ley lo permite.",
  invalidFor: {
    givenName: "Solo letras, espacios, apóstrofos, puntos y guiones; hasta 50 caracteres.",
    surname1: "Solo letras, espacios, apóstrofos, puntos y guiones; hasta 50 caracteres.",
    surname2: "Solo letras, espacios, apóstrofos, puntos y guiones; hasta 50 caracteres.",
    birthDate: "Revise la fecha: no puede ser futura ni de hace más de 120 años.",
    docIssued: "Revise la fecha de expedición: no puede ser futura.",
    docNumber: "Revise el número: de 3 a 20 letras y cifras; en DNI y NIE también cuenta la letra final.",
    docSupport: "El número de soporte tiene exactamente 9 letras y cifras.",
    postalCode: "Revise el código postal: en España son 5 cifras.",
    street: "Hasta 100 caracteres.",
    locality: "Hasta 100 caracteres.",
    phone: "Solo cifras, espacios, + y guiones, de 6 a 20 caracteres.",
    email: "Escriba una dirección completa, como nombre@ejemplo.es.",
    sex: "Elija una opción de la lista.",
    nationality: "Elija un país de la lista.",
    country: "Elija un país de la lista.",
    docType: "Elija un tipo de documento de la lista.",
    kinship: "Elija una opción de la lista.",
    payment: "Elija una opción de la lista.",
    birthCountry: "Elija un país de la lista.",
    docCountry: "Elija un país de la lista.",
    birthPlace: "Escríbalo como en el documento; si hay dos con el mismo nombre, indique la provincia.",
    docPlace: "Escríbalo como en el documento; si hay dos con el mismo nombre, indique la provincia.",
    birthProvince: "Las dos letras de la provincia, como RM o MI.",
    docProvince: "Las dos letras de la provincia, como RM o MI.",
  },
  forbiddenText: "Este formulario se abre solo desde la red del alojamiento.",
  tooMany: "Demasiados intentos. Espere unos minutos.",
  italy: {
    intro:
      "La ley italiana (art. 109 del Texto único de las leyes de seguridad pública) obliga al alojamiento a comunicar a la Polizia di Stato, por el servicio Alloggiati Web, los datos de cada persona que se aloja. Rellene un formulario por persona, menores incluidos. A la llegada el anfitrión le reconocerá en persona o por videollamada, con el documento.",
    privacy:
      "Sus datos se guardan cifrados solo en el ordenador del anfitrión y se envían únicamente a la Polizia di Stato (Alloggiati Web). Se borran en cuanto existe el recibo del envío: solo se conserva el recibo, 5 años, como pide la ley.",
    privacyShort: "Sus datos se guardan cifrados en el ordenador del anfitrión, solo se envían a la Polizia di Stato y se borran solos después del envío.",
    surname: "Apellidos",
    kinshipHint: "Solo para familiares del titular; déjelo vacío para amigos o compañeros de viaje.",
    birthPlaceHint: "Solo si nació en Italia.",
    docPlaceHint: "Solo para documentos expedidos en Italia: el municipio que lo expidió.",
    noDocument: "Para los familiares y los demás miembros del grupo no hace falta el documento: basta con el del titular.",
  },
};

const en: Words = {
  langName: "English",
  title: "Guest registration",
  stay: "Stay",
  registered: (n) => (n === 1 ? "1 guest registered" : `${n} guests registered`),
  saved: (n) => `Guest ${n} saved.`,
  addAnother: "Add another guest",
  finished: "If everyone is in, you can close this page.",
  intro: "Spanish law (Real Decreto 933/2021) requires the accommodation to send the police the details of everyone who stays. Fill in one form per person, children included.",
  firstGuest: "Guest 1 (who made the booking)",
  nextGuest: (n) => `Guest ${n}`,
  sections: { person: "Person", document: "Identity document", address: "Home address", contact: "Contact", payment: "Payment" },
  fields: {
    givenName: "First name",
    surname1: "Surname",
    surname2: "Second surname",
    birthDate: "Date of birth",
    sex: "Sex",
    nationality: "Nationality",
    docType: "Document type",
    docNumber: "Document number",
    docSupport: "Support number",
    docIssued: "Date of issue",
    docSpanish: "Passport issued in Spain",
    country: "Country",
    street: "Address",
    postalCode: "Postcode",
    locality: "Town or city",
    phone: "Phone",
    email: "Email",
    kinship: "Relationship to the guest who booked",
    payment: "Type of payment",
    birthCountry: "Country of birth",
    birthPlace: "Municipality of birth",
    birthProvince: "Province of birth",
    docCountry: "Country of issue",
    docPlace: "Municipality of issue",
    docProvince: "Province of issue",
  },
  hints: {
    surname2: "Required with a Spanish DNI.",
    docNumber: "Required from 14 years old.",
    docSupport: "Only for Spanish DNI or NIE cards: 9 characters.",
    contact: "One of the two is enough.",
    kinship: "Only for children under 18.",
  },
  choose: "Choose…",
  sex: { female: "Female", male: "Male", other: "Other" },
  documentTypes: {
    dni: "Spanish DNI / NIF",
    nie: "NIE (foreigner in Spain)",
    passport: "Passport",
    id_card: "Identity card",
    electronic_id: "Italian electronic identity card (CIE)",
    driving_licence: "Driving licence",
    other: "Other identity document",
  },
  kinship: {
    parent: "Parent",
    child: "Son / daughter",
    sibling: "Brother / sister",
    spouse: "Spouse",
    grandparent: "Grandparent",
    grandchild: "Grandchild",
    great_grandparent: "Great-grandparent",
    great_grandchild: "Great-grandchild",
    uncle_aunt: "Uncle / aunt",
    nephew_niece: "Nephew / niece",
    parent_in_law: "Parent-in-law",
    child_in_law: "Son-in-law / daughter-in-law",
    sibling_in_law: "Brother-in-law / sister-in-law",
    guardian: "Legal guardian",
    other: "Other",
  },
  payment: {
    platform: "Platform (Airbnb, Booking…)",
    card: "Card",
    cash: "Cash",
    transfer: "Bank transfer",
    mobile: "Mobile payment",
    voucher: "Gift card",
    at_destination: "Pay on arrival",
    other: "Other",
  },
  paymentNote: "Only the type of payment. We will never ask for card or account numbers.",
  save: "Save guest",
  required: "Required",
  invalid: "Please check this",
  contactMissing: "Give a phone number or an email",
  fix: "Please check the marked fields.",
  privacy:
    "Your data is stored encrypted only on the host's computer and sent only to the police (SES.HOSPEDAJES or Mossos d'Esquadra). It is erased as soon as the law allows: after it is sent, or after 3 years if the host is a professional.",
  notFound: "Link not valid",
  notFoundText: "This registration link does not exist or has expired. Ask the host for a new one.",
  forbidden: "Local network only",
  steps: { data: "Your details", document: "Document", confirm: "Confirmation" },
  stepLabel: (n) => `Step ${n} of 3`,
  privacyShort: "Your data is kept encrypted on the host's computer, sent only to the police and erased by itself as soon as the law allows.",
  invalidFor: {
    givenName: "Only letters, spaces, apostrophes, dots and dashes; up to 50 characters.",
    surname1: "Only letters, spaces, apostrophes, dots and dashes; up to 50 characters.",
    surname2: "Only letters, spaces, apostrophes, dots and dashes; up to 50 characters.",
    birthDate: "Check the date: it cannot be in the future or more than 120 years ago.",
    docIssued: "Check the date of issue: it cannot be in the future.",
    docNumber: "Check the number: 3 to 20 letters and digits; for a DNI or NIE the final letter counts too.",
    docSupport: "The support number has exactly 9 letters and digits.",
    postalCode: "Check the postal code: in Spain it has 5 digits.",
    street: "Up to 100 characters.",
    locality: "Up to 100 characters.",
    phone: "Only digits, spaces, + and dashes, 6 to 20 characters.",
    email: "Write a full address, like name@example.com.",
    sex: "Choose one from the list.",
    nationality: "Choose a country from the list.",
    country: "Choose a country from the list.",
    docType: "Choose a type of document from the list.",
    kinship: "Choose one from the list.",
    payment: "Choose one from the list.",
    birthCountry: "Choose a country from the list.",
    docCountry: "Choose a country from the list.",
    birthPlace: "Write it as on the document; if two share the name, add the province.",
    docPlace: "Write it as on the document; if two share the name, add the province.",
    birthProvince: "The two letters of the province, like RM or MI.",
    docProvince: "The two letters of the province, like RM or MI.",
  },
  forbiddenText: "This form opens only from the accommodation's network.",
  tooMany: "Too many attempts. Please wait a few minutes.",
  italy: {
    intro:
      "Italian law (art. 109 of the Consolidated Law on Public Security) requires the accommodation to send the Polizia di Stato, through the Alloggiati Web service, the details of everyone who stays. Fill in one form per person, children included. On arrival the host will recognize you in person or on a video call, with your document.",
    privacy:
      "Your data is stored encrypted only on the host's computer and sent only to the Polizia di Stato (Alloggiati Web). It is erased as soon as the receipt of the communication exists: only the receipt is kept, for 5 years, as the law asks.",
    privacyShort: "Your data is kept encrypted on the host's computer, sent only to the Polizia di Stato and erased by itself after it is sent.",
    surname: "Surname(s)",
    kinshipHint: "Only for family members of the guest who booked; leave it empty for friends or travel companions.",
    birthPlaceHint: "Only if born in Italy.",
    docPlaceHint: "Only for documents issued in Italy: the municipality that issued it.",
    noDocument: "Family members and other members of the group do not need a document: the one of the guest who booked is enough.",
  },
};

const it: Words = {
  langName: "Italiano",
  title: "Registrazione degli ospiti",
  stay: "Soggiorno",
  registered: (n) => (n === 1 ? "1 ospite registrato" : `${n} ospiti registrati`),
  saved: (n) => `Ospite ${n} salvato.`,
  addAnother: "Aggiungi un altro ospite",
  finished: "Se ci sono tutti, puoi chiudere questa pagina.",
  intro: "La legge spagnola (Real Decreto 933/2021) obbliga l'alloggio a comunicare alla polizia i dati di ogni persona che vi soggiorna. Compila un modulo per persona, bambini compresi.",
  firstGuest: "Ospite 1 (chi ha prenotato)",
  nextGuest: (n) => `Ospite ${n}`,
  sections: { person: "Persona", document: "Documento d'identità", address: "Indirizzo di residenza", contact: "Contatto", payment: "Pagamento" },
  fields: {
    givenName: "Nome",
    surname1: "Cognome",
    surname2: "Secondo cognome",
    birthDate: "Data di nascita",
    sex: "Sesso",
    nationality: "Cittadinanza",
    docType: "Tipo di documento",
    docNumber: "Numero del documento",
    docSupport: "Numero di supporto",
    docIssued: "Data di rilascio",
    docSpanish: "Passaporto rilasciato in Spagna",
    country: "Paese",
    street: "Indirizzo",
    postalCode: "CAP",
    locality: "Città",
    phone: "Telefono",
    email: "Email",
    kinship: "Parentela con chi ha prenotato",
    payment: "Tipo di pagamento",
    birthCountry: "Stato di nascita",
    birthPlace: "Comune di nascita",
    birthProvince: "Provincia di nascita",
    docCountry: "Stato di rilascio",
    docPlace: "Comune di rilascio",
    docProvince: "Provincia di rilascio",
  },
  hints: {
    surname2: "Obbligatorio con un DNI spagnolo.",
    docNumber: "Obbligatorio dai 14 anni.",
    docSupport: "Solo per DNI o NIE spagnoli: 9 caratteri.",
    contact: "Basta uno dei due.",
    kinship: "Solo per i minorenni.",
  },
  choose: "Scegli…",
  sex: { female: "Donna", male: "Uomo", other: "Altro" },
  documentTypes: {
    dni: "DNI / NIF spagnolo",
    nie: "NIE (straniero in Spagna)",
    passport: "Passaporto",
    id_card: "Carta d'identità cartacea o straniera",
    electronic_id: "Carta d'identità elettronica (CIE)",
    driving_licence: "Patente di guida",
    other: "Altro documento d'identità",
  },
  kinship: {
    parent: "Padre / madre",
    child: "Figlio / figlia",
    sibling: "Fratello / sorella",
    spouse: "Coniuge",
    grandparent: "Nonno / nonna",
    grandchild: "Nipote (di nonno)",
    great_grandparent: "Bisnonno / bisnonna",
    great_grandchild: "Pronipote",
    uncle_aunt: "Zio / zia",
    nephew_niece: "Nipote (di zio)",
    parent_in_law: "Suocero / suocera",
    child_in_law: "Genero / nuora",
    sibling_in_law: "Cognato / cognata",
    guardian: "Tutore / tutrice",
    other: "Altro",
  },
  payment: {
    platform: "Piattaforma (Airbnb, Booking…)",
    card: "Carta",
    cash: "Contanti",
    transfer: "Bonifico",
    mobile: "Pagamento da cellulare",
    voucher: "Carta regalo",
    at_destination: "Pagamento all'arrivo",
    other: "Altro",
  },
  paymentNote: "Solo il tipo di pagamento. Non ti chiederemo mai numeri di carta o di conto.",
  save: "Salva l'ospite",
  required: "Obbligatorio",
  invalid: "Controlla questo dato",
  contactMissing: "Indica un telefono o un'email",
  fix: "Controlla i campi segnati.",
  privacy:
    "I tuoi dati sono conservati cifrati solo sul computer dell'host e inviati solo alla polizia (SES.HOSPEDAJES o Mossos d'Esquadra). Vengono cancellati appena la legge lo permette: dopo l'invio, o dopo 3 anni se l'host è un professionista.",
  notFound: "Link non valido",
  notFoundText: "Questo link di registrazione non esiste o è scaduto. Chiedine uno nuovo all'host.",
  forbidden: "Solo dalla rete locale",
  steps: { data: "I tuoi dati", document: "Documento", confirm: "Conferma" },
  stepLabel: (n) => `Passo ${n} di 3`,
  privacyShort: "I tuoi dati restano cifrati sul computer dell'host, vanno solo alla polizia e si cancellano da soli appena la legge lo permette.",
  invalidFor: {
    givenName: "Solo lettere, spazi, apostrofi, punti e trattini; fino a 50 caratteri.",
    surname1: "Solo lettere, spazi, apostrofi, punti e trattini; fino a 50 caratteri.",
    surname2: "Solo lettere, spazi, apostrofi, punti e trattini; fino a 50 caratteri.",
    birthDate: "Controlla la data: non può essere nel futuro né di più di 120 anni fa.",
    docIssued: "Controlla la data di rilascio: non può essere nel futuro.",
    docNumber: "Controlla il numero: da 3 a 20 lettere e cifre; per DNI e NIE conta anche la lettera finale.",
    docSupport: "Il numero di supporto ha esattamente 9 lettere e cifre.",
    postalCode: "Controlla il CAP: in Spagna sono 5 cifre.",
    street: "Al massimo 100 caratteri.",
    locality: "Al massimo 100 caratteri.",
    phone: "Solo cifre, spazi, + e trattini, da 6 a 20 caratteri.",
    email: "Scrivi un indirizzo completo, come nome@esempio.it.",
    sex: "Scegli una voce dall'elenco.",
    nationality: "Scegli un paese dall'elenco.",
    country: "Scegli un paese dall'elenco.",
    docType: "Scegli un tipo di documento dall'elenco.",
    kinship: "Scegli una voce dall'elenco.",
    payment: "Scegli una voce dall'elenco.",
    birthCountry: "Scegli uno Stato dall'elenco.",
    docCountry: "Scegli uno Stato dall'elenco.",
    birthPlace: "Scrivilo come sul documento; se ce ne sono due con lo stesso nome, indica la provincia.",
    docPlace: "Scrivilo come sul documento; se ce ne sono due con lo stesso nome, indica la provincia.",
    birthProvince: "Le due lettere della provincia, come RM o MI.",
    docProvince: "Le due lettere della provincia, come RM o MI.",
  },
  forbiddenText: "Questo modulo si apre solo dalla rete dell'alloggio.",
  tooMany: "Troppi tentativi. Aspetta qualche minuto.",
  italy: {
    intro:
      "La legge italiana (art. 109 del Testo unico delle leggi di pubblica sicurezza) obbliga l'alloggio a comunicare alla Polizia di Stato, con il servizio Alloggiati Web, i dati di ogni persona che vi soggiorna. Compila un modulo per persona, bambini compresi. All'arrivo l'host vi riconoscerà di persona o in videochiamata, con il documento.",
    privacy:
      "I tuoi dati sono conservati cifrati solo sul computer dell'host e inviati solo alla Polizia di Stato (Alloggiati Web). Vengono cancellati appena esiste la ricevuta dell'invio: resta solo la ricevuta, per 5 anni, come chiede la legge.",
    privacyShort: "I tuoi dati restano cifrati sul computer dell'host, vanno solo alla Polizia di Stato e si cancellano da soli dopo l'invio.",
    surname: "Cognome",
    kinshipHint: "Solo per i familiari di chi ha prenotato; lascialo vuoto per amici o compagni di viaggio.",
    birthPlaceHint: "Solo per chi è nato in Italia.",
    docPlaceHint: "Solo per i documenti rilasciati in Italia: il comune che lo ha rilasciato.",
    noDocument: "Per i familiari e gli altri membri del gruppo il documento non serve: basta quello di chi ha prenotato.",
  },
};

export const WORDS: Record<Lang, Words> = { es, en, it };

/** ?lang= first, then the browser's languages, then Spanish. */
export function pickLang(query: string | null, acceptLanguage: string | undefined): Lang {
  if (query && (LANGS as readonly string[]).includes(query)) return query as Lang;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if ((LANGS as readonly string[]).includes(code)) return code as Lang;
  }
  return "es";
}
