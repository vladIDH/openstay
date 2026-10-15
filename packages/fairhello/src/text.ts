/**
 * Small checks on plain text: markdown left in a draft, prices, and the topics
 * the host must always handle personally.
 */

/**
 * Turns leftover markdown into plain text: Airbnb, Booking.com and the other
 * channels do not render it, so the guest would see the asterisks.
 */
export function plainText(text: string): string {
  return text
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1") // **bold** → bold
    .replace(/__([\s\S]+?)__/g, "$1") // __bold__ → bold
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // "### " at the start of a line
    .replace(/^[ \t]*[-*+][ \t]+/gm, "• ") // markdown bullets → "• "
    .replace(/\*\*/g, "") // stray ** left over
    .replace(/[ \t]+\n/g, "\n") // spaces at the end of a line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CURRENCY_WORDS = "€|eur|euro|euros|usd|dollars?|dólares|dollari|\\$|£|gbp|pounds?|sterline|chf|franchi|francos";

/** Amounts of money: "€80", "80 €", "80,50 EUR", "$ 120", "120 euros". */
const PRICE = new RegExp(
  `(?:(?:€|\\$|£)\\s?\\d(?:[\\d.,']*\\d)?)|(?:\\b\\d(?:[\\d.,']*\\d)?\\s?(?:${CURRENCY_WORDS})(?![a-z]))`,
  "giu",
);

/** Every amount of money written in the text (empty when there is none). */
export function findPrices(text: string): string[] {
  return [...text.matchAll(PRICE)].map((m) => m[0].trim());
}

export const TOPICS = ["money", "complaint", "cancellation", "emergency"] as const;
export type Topic = (typeof TOPICS)[number];

/** Words in Italian, Spanish, English, French, German and Portuguese, without accents. */
const TOPIC_WORDS: Record<Topic, string[]> = {
  money: [
    "price", "prices", "cost", "costs", "pay", "paid", "payment", "refund", "discount", "deposit", "fee", "fees", "invoice", "receipt", "cheaper", "money", "charge", "charged",
    "prezzo", "prezzi", "costo", "pagare", "pagato", "pagamento", "rimborso", "sconto", "caparra", "deposito", "fattura", "ricevuta", "soldi", "tassa",
    "precio", "precios", "coste", "pagar", "pago", "reembolso", "descuento", "fianza", "factura", "dinero",
    "prix", "payer", "paiement", "remboursement", "reduction", "caution", "facture", "argent",
    "preis", "kosten", "bezahlen", "zahlung", "erstattung", "rabatt", "kaution", "rechnung", "geld",
    "preco", "pagamento", "reembolso", "desconto",
  ],
  complaint: [
    "complaint", "complain", "dirty", "broken", "noise", "noisy", "disappointed", "unacceptable", "bad review", "not working", "doesn't work", "does not work", "cockroach", "bed bugs",
    "reclamo", "lamentela", "sporco", "sporca", "rotto", "rotta", "rumore", "deluso", "delusa", "inaccettabile", "non funziona", "scarafaggi",
    "queja", "reclamacion", "sucio", "sucia", "roto", "rota", "ruido", "decepcionado", "inaceptable", "no funciona", "cucarachas",
    "plainte", "bruit", "decu", "inacceptable", "ne marche pas", "ne fonctionne pas",
    "beschwerde", "schmutzig", "kaputt", "larm", "enttauscht", "inakzeptabel", "funktioniert nicht",
  ],
  cancellation: [
    "cancel", "cancellation", "cancelled", "canceled", "annullare", "annullamento", "disdetta", "disdire", "cancellare", "cancelar", "cancelacion", "anular", "annuler", "annulation", "stornieren", "stornierung", "absagen",
  ],
  emergency: [
    "emergency", "urgent", "fire", "flood", "leak", "gas leak", "police", "ambulance", "injured", "locked out",
    "emergenza", "urgente", "incendio", "allagamento", "perdita", "polizia", "ambulanza", "ferito", "chiuso fuori",
    "emergencia", "inundacion", "fuga", "policia", "ambulancia", "herido",
    "urgence", "incendie", "inondation", "fuite", "pompiers", "notfall", "dringend", "feuer", "wasserschaden", "polizei", "krankenwagen",
  ],
};

const plain = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9']+/g, " ")} `;

/** The sensitive topics a guest message touches, in a fixed order. */
export function topicsOf(text: string): Topic[] {
  const words = plain(text);
  return TOPICS.filter((t) => TOPIC_WORDS[t].some((w) => words.includes(` ${plain(w).trim()} `)));
}

/** "en-GB", "EN", "en_US" → "en"; anything that is not a language code → null. */
export function languageCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*([a-z]{2,3})(?:[-_][a-z0-9]+)*\s*$/i.exec(raw);
  return m ? (m[1] as string).toLowerCase() : null;
}
