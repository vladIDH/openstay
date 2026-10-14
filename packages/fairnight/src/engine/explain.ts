/**
 * Human-readable explanation of one night, built only from the quote itself.
 *
 *   Sat 2026-11-14 · 109 EUR: base 100 → season "High season" +15% = 115
 *   → last minute (≤7 days) -5% = 109.25 → within floor 60 and ceiling 250
 *   → rounded to 1 = 109. Min stay 2 (last minute).
 *
 * A room type with more than one unit also says how many are free and which
 * rule moved the price the most:
 *
 *   Sat 2026-11-14 · 109 EUR (3 of 6 rooms free): base 100 → … Min stay 2
 *   (default). Weighed most: season "High season" +15%.
 */
import { unitsFree } from "./factors.js";
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

/** The step that moved the price the most (base and unchanged limits never count). */
function heaviestStep(steps: readonly PriceStep[]): PriceStep | null {
  let best: PriceStep | null = null;
  for (const s of steps) {
    if (s.factor === "base" || s.before === s.after) continue;
    if (!best || Math.abs(s.after - s.before) > Math.abs(best.after - best.before)) best = s;
  }
  return best;
}

function describeWeight(step: PriceStep): string {
  if (step.percent !== undefined) return `${step.label} ${formatPercent(step.percent)}`;
  const diff = step.after - step.before;
  return `${step.label} ${diff >= 0 ? "+" : "-"}${formatAmount(Math.abs(Math.round(diff * 100) / 100))}`;
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
  const u = quote.units;
  if (quote.price === null) {
    return u ? `${head}: not for sale (${quote.status}, ${unitsFree(u.free, u.total)}).` : `${head}: not for sale (${quote.status}).`;
  }
  const chain = quote.steps.map(describeStep).join(" → ");
  const minStay =
    quote.minStay === null || quote.minStaySource === null
      ? ""
      : ` Min stay ${quote.minStay} (${MIN_STAY_LABEL[quote.minStaySource]}).`;
  if (!u) return `${head} · ${formatAmount(quote.price)} ${currency}: ${chain}.${minStay}`;
  const heaviest = heaviestStep(quote.steps);
  const weighed = heaviest ? ` Weighed most: ${describeWeight(heaviest)}.` : "";
  const over = u.overbooked ? ` Overbooked by ${u.overbooked} on the channel.` : "";
  return `${head} · ${formatAmount(quote.price)} ${currency} (${unitsFree(u.free, u.total)}): ${chain}.${minStay}${weighed}${over}`;
}
