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
  documentTypes: { dni: "DNI / NIF español", nie: "NIE (extranjero en España)", passport: "Pasaporte", other: "Otro documento de identidad" },
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
  forbiddenText: "Este formulario se abre solo desde la red del alojamiento.",
  tooMany: "Demasiados intentos. Espere unos minutos.",
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
  documentTypes: { dni: "Spanish DNI / NIF", nie: "NIE (foreigner in Spain)", passport: "Passport", other: "Other identity document" },
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
  forbiddenText: "This form opens only from the accommodation's network.",
  tooMany: "Too many attempts. Please wait a few minutes.",
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
  documentTypes: { dni: "DNI / NIF spagnolo", nie: "NIE (straniero in Spagna)", passport: "Passaporto", other: "Altro documento d'identità" },
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
  forbiddenText: "Questo modulo si apre solo dalla rete dell'alloggio.",
  tooMany: "Troppi tentativi. Aspetta qualche minuto.",
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
