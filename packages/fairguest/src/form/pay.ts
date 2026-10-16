/**
 * The payments card of the check-in «Carta»: the tourist tax and the deposit,
 * each with a button to Stripe's own page. The money goes straight to the
 * host's Stripe account; the card details are typed on Stripe's page only.
 * Shared by the form on the host's network and the page of the link.
 */
import { esc, TICK } from "./render.js";
import type { Lang } from "./words.js";
import { formatCents } from "../tax/rules.js";

export interface PayItem {
  kind: "tax" | "deposit";
  amountCents: number;
  currency: string;
  /** open: the button; done: paid or held; later: from `from`; pending: the host prepares it. */
  state: "open" | "done" | "later" | "pending";
  /** Stripe's page (https://buy.stripe.com/… or https://checkout.stripe.com/…). */
  url?: string;
  /** "YYYY-MM-DD": when the deposit can be left. */
  from?: string;
  /** Tax: paying guests and nights. */
  people?: number;
  nights?: number;
}

export interface PayView {
  /** The town of the tax. */
  town?: string;
  items: PayItem[];
}

interface PayWords {
  title: string;
  tax: (town: string | undefined) => string;
  taxDetail: (people: number, nights: number) => string;
  taxButton: (amount: string) => string;
  taxDone: string;
  deposit: string;
  depositExplain: string;
  depositButton: (amount: string) => string;
  depositDone: string;
  later: (day: string) => string;
  pending: string;
  safe: string;
  /** The question of the form when residents of the town do not pay. */
  residentSection: string;
  resident: (town: string) => string;
}

export const PAY_WORDS: Record<Lang, PayWords> = {
  it: {
    title: "Pagamenti",
    tax: (town) => (town ? `Imposta di soggiorno · ${town}` : "Imposta di soggiorno"),
    taxDetail: (p, n) => `${p === 1 ? "1 persona" : `${p} persone`} × ${n === 1 ? "1 notte" : `${n} notti`}`,
    taxButton: (a) => `Paga ${a} con carta`,
    taxDone: "Pagata. Grazie.",
    deposit: "Cauzione",
    depositExplain: "È una preautorizzazione: la banca blocca l'importo sulla carta ma non lo addebita. Dopo la partenza l'host la rilascia, o ne trattiene una parte per eventuali danni.",
    depositButton: (a) => `Lascia la cauzione di ${a}`,
    depositDone: "Cauzione bloccata sulla carta.",
    later: (d) => `Si lascia da ${d}: una preautorizzazione dura pochi giorni.`,
    pending: "L'host prepara il pagamento appena riceve i vostri dati: riaprite questo link più tardi.",
    safe: "Si paga sulla pagina di Stripe, direttamente all'host. Né l'host né Fairguest vedono i dati della carta.",
    residentSection: "Imposta di soggiorno",
    resident: (t) => `Questa persona è residente a ${t} (non paga l'imposta)`,
  },
  es: {
    title: "Pagos",
    tax: (town) => (town ? `Impuesto turístico · ${town}` : "Impuesto turístico"),
    taxDetail: (p, n) => `${p === 1 ? "1 persona" : `${p} personas`} × ${n === 1 ? "1 noche" : `${n} noches`}`,
    taxButton: (a) => `Pagar ${a} con tarjeta`,
    taxDone: "Pagado. Gracias.",
    deposit: "Fianza",
    depositExplain: "Es una preautorización: el banco bloquea el importe en la tarjeta pero no lo cobra. Tras la salida el anfitrión la libera, o retiene una parte por posibles daños.",
    depositButton: (a) => `Dejar la fianza de ${a}`,
    depositDone: "Fianza bloqueada en la tarjeta.",
    later: (d) => `Se deja desde el ${d}: una preautorización dura pocos días.`,
    pending: "El anfitrión prepara el pago en cuanto recibe sus datos: vuelva a abrir este enlace más tarde.",
    safe: "Se paga en la página de Stripe, directamente al anfitrión. Ni el anfitrión ni Fairguest ven los datos de la tarjeta.",
    residentSection: "Impuesto turístico",
    resident: (t) => `Esta persona reside en ${t} (no paga el impuesto)`,
  },
  en: {
    title: "Payments",
    tax: (town) => (town ? `Tourist tax · ${town}` : "Tourist tax"),
    taxDetail: (p, n) => `${p === 1 ? "1 person" : `${p} people`} × ${n === 1 ? "1 night" : `${n} nights`}`,
    taxButton: (a) => `Pay ${a} by card`,
    taxDone: "Paid. Thank you.",
    deposit: "Deposit",
    depositExplain: "It is a hold: your bank blocks the amount on the card but does not charge it. After check-out the host releases it, or keeps part of it for any damage.",
    depositButton: (a) => `Leave the ${a} deposit`,
    depositDone: "Deposit held on the card.",
    later: (d) => `It can be left from ${d}: a hold lasts only a few days.`,
    pending: "The host prepares the payment as soon as they get your details: open this link again later.",
    safe: "You pay on Stripe's page, straight to the host. Neither the host nor Fairguest sees the card details.",
    residentSection: "Tourist tax",
    resident: (t) => `This person lives in ${t} (residents do not pay the tax)`,
  },
};

export function money(cents: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${formatCents(cents, lang === "en" ? "." : ",")} ${currency}`;
  }
}

/** Only Stripe's own payment pages are ever linked. */
export const isStripePayUrl = (u: unknown): u is string => typeof u === "string" && u.length <= 500 && /^https:\/\/(buy|checkout)\.stripe\.com\/[A-Za-z0-9_\-/#%.=?&]+$/.test(u);

/** The card, or "" when there is nothing to pay. `day` writes a date in the guest's language. */
export function payCard(view: PayView, lang: Lang, day: (iso: string) => string): string {
  if (view.items.length === 0) return "";
  const w = PAY_WORDS[lang];
  const rows = view.items
    .map((it) => {
      const amount = money(it.amountCents, it.currency, lang);
      const done = `<p class="pay-done">${TICK}<span>${esc(it.kind === "tax" ? w.taxDone : w.depositDone)}</span></p>`;
      const button = (label: string) => (it.url && isStripePayUrl(it.url) ? `<a class="button" href="${esc(it.url)}" rel="noopener noreferrer">${esc(label)}</a>` : "");
      if (it.kind === "tax") {
        const detail = it.people !== undefined && it.nights !== undefined ? `<span>${esc(w.taxDetail(it.people, it.nights))}</span>` : "";
        const action = it.state === "done" ? done : it.state === "open" ? button(w.taxButton(amount)) : `<p class="hint">${esc(w.pending)}</p>`;
        return `<div class="pay-item"><div class="pay-head"><b>${esc(w.tax(view.town))}</b><strong>${esc(amount)}</strong></div>${detail}${action}</div>`;
      }
      const action =
        it.state === "done"
          ? done
          : it.state === "open"
            ? button(w.depositButton(amount))
            : it.state === "later" && it.from
              ? `<p class="hint">${esc(w.later(day(it.from)))}</p>`
              : `<p class="hint">${esc(w.pending)}</p>`;
      return `<div class="pay-item"><div class="pay-head"><b>${esc(w.deposit)}</b><strong>${esc(amount)}</strong></div><p class="hint">${esc(w.depositExplain)}</p>${action}</div>`;
    })
    .join("");
  return `<section class="pay" aria-labelledby="pay-title"><h2 id="pay-title">${esc(w.title)}</h2>${rows}<p class="hint pay-safe">${esc(w.safe)}</p></section>`;
}
