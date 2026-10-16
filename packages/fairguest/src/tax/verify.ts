/**
 * The points of a rule that the host must check with the town, as sentences
 * in the host's language: the page /pagamenti, the summary (CSV and PDF) and
 * `fairnight tassa` show them until the host confirms.
 */
import type { TaxRule, TaxVerify } from "./rules.js";

export type VerifyLang = "it" | "es" | "en";

export interface VerifyText {
  title: string;
  /** The words of the regulation. */
  quote: string;
  url: string;
  /** What Fairguest computes meanwhile, and how to settle it. */
  explain: string;
  /** Where the quote was read and what the town's page says, if that differs. */
  note?: string;
}

const W = {
  it: {
    title: (town: string, field: string) => (field === "exemptUnderAge" ? `Da verificare: età esenti a ${town}` : `Da verificare: ${field} a ${town}`),
    age: (n: number) =>
      `Fairguest ora esenta chi ha meno di ${n} anni. Se il comune intende «fino a ${n} anni compiuti», scrivi "exemptUnderAge": ${n + 1} nel blocco touristTax; se è giusto così, scrivi "confirmed": true (oppure premi «Ho verificato» nella pagina Pagamenti).`,
    other: 'Controlla con il comune; poi scrivi il tuo valore nel blocco touristTax, oppure "confirmed": true.',
    unofficial: "Il testo è stato letto in una copia non ufficiale del regolamento: quello ufficiale non è stato trovato in rete.",
    townPage: (words: string) => `La pagina del comune dice che l'imposta è dovuta da chi è «${words}».`,
  },
  es: {
    title: (town: string, field: string) => (field === "exemptUnderAge" ? `Por verificar: edades exentas en ${town}` : `Por verificar: ${field} en ${town}`),
    age: (n: number) =>
      `Fairguest exime ahora a quien tiene menos de ${n} años. Si el municipio entiende «hasta ${n} años cumplidos», escriba "exemptUnderAge": ${n + 1} en el bloque touristTax; si es correcto, escriba "confirmed": true (o pulse «Lo he verificado» en la página Pagos).`,
    other: 'Compruébelo con el municipio; luego escriba su valor en el bloque touristTax, o "confirmed": true.',
    unofficial: "El texto se leyó en una copia no oficial del reglamento: el oficial no se encontró en línea.",
    townPage: (words: string) => `La página del municipio dice que el impuesto lo paga quien es «${words}».`,
  },
  en: {
    title: (town: string, field: string) => (field === "exemptUnderAge" ? `To check: exempt ages in ${town}` : `To check: ${field} in ${town}`),
    age: (n: number) =>
      `Fairguest now exempts guests younger than ${n}. If the town means "up to ${n} years completed", write "exemptUnderAge": ${n + 1} in the touristTax block; if it is right, write "confirmed": true (or press "I checked" on the Payments page).`,
    other: 'Check with the town; then write your own value in the touristTax block, or "confirmed": true.',
    unofficial: "The text was read in an unofficial copy of the regulation: the official one was not found online.",
    townPage: (words: string) => `The town's page says the tax is paid by those «${words}».`,
  },
};

export function verifyTexts(rule: TaxRule, lang: VerifyLang): VerifyText[] {
  const w = W[lang];
  return (rule.verify ?? []).map((v: TaxVerify) => {
    const out: VerifyText = {
      title: w.title(rule.name, v.field),
      quote: v.quote,
      url: v.url,
      explain: v.field === "exemptUnderAge" && rule.exemptUnderAge !== undefined ? w.age(rule.exemptUnderAge) : w.other,
    };
    const note = [v.unofficialCopy ? w.unofficial : "", v.townPageSays ? w.townPage(v.townPageSays) : ""].filter(Boolean).join(" ");
    if (note) out.note = note;
    return out;
  });
}
