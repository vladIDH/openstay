/**
 * Human-readable explanation of one night, built only from the quote itself.
 *
 *   Sat 2026-11-14 · 109 EUR: base 100 → season "High season" +15% = 115
 *   → last minute (≤7 days) -5% = 109.25 → within floor 60 and ceiling 250
 *   → rounded to 1 = 109. Min stay 2 (last minute).
 */
import type { MinStaySource, NightQuote, PriceStep } from "./types.js";

const WEEKDAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" } as const;

const MIN_STAY_LABEL: Record<MinStaySource, string> = {
  override: "date override",
  farOut: "far out",
  lastMinute: "last minute",
  default: "default",
  gap: "lowered to fill the gap",
};

export function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatPercent(p: number): string {
  return `${p >= 0 ? "+" : ""}${formatAmount(p)}%`;
}

function describeStep(step: PriceStep): string {
  if (step.factor === "base") return `base ${formatAmount(step.after)}`;
  if (step.factor === "limits" && step.before === step.after) return step.note ?? "within limits";
  const change = step.percent !== undefined ? ` ${formatPercent(step.percent)}` : "";
  const note = step.note ? ` (${step.note})` : "";
  return `${step.label}${change} = ${formatAmount(step.after)}${note}`;
}

export function explainNight(quote: NightQuote, currency: string): string {
  const head = `${WEEKDAY_LABEL[quote.weekday]} ${quote.date}`;
  if (quote.price === null) {
    return `${head}: not for sale (${quote.status}).`;
  }
  const chain = quote.steps.map(describeStep).join(" → ");
  const minStay =
    quote.minStay === null || quote.minStaySource === null
      ? ""
      : ` Min stay ${quote.minStay} (${MIN_STAY_LABEL[quote.minStaySource]}).`;
  return `${head} · ${formatAmount(quote.price)} ${currency}: ${chain}.${minStay}`;
}
