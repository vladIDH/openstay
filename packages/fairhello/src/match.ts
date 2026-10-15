/**
 * Which listing does a name from a channel belong to? Used only to SUGGEST a
 * link to the host ("Smoobu apartment 412 looks like listing seaview-loft"):
 * a draft is never written for a stay whose listing is not linked for sure.
 *
 * Three levels, in order:
 *  1. explicit aliases (normalised name → listing), set by the host;
 *  2. word overlap (Jaccard) between the name and each listing's names;
 *  3. when several listings tie (one channel listing shared by two units),
 *     the hint (e.g. the room type) picks the one whose keywords it contains;
 *     otherwise the answer is "ambiguous", never a guess.
 */

/** Words too common to tell two listings apart. */
const STOPWORDS = new Set([
  "apartment", "apartments", "apartamento", "apartamentos", "appartamento", "appartamenti", "apt", "studio", "house", "casa", "flat", "villa", "room",
  "the", "a", "an", "with", "and", "in", "of", "to", "near", "close", "by", "con", "en", "de", "del", "la", "el", "il", "di", "e", "y",
  "cozy", "cosy", "stunning", "beautiful", "lovely", "nice", "bright", "modern",
]);

/** Lowercase, no accents, everything that is not a letter or digit becomes one space. */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(
    normaliseName(s)
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((t) => b.has(t)).length;
  return shared / (a.size + b.size - shared);
}

export interface Candidate {
  id: string;
  /** The listing's names: its own name, its title, the titles on each channel. */
  names: string[];
  /** Words of a room type that point to this unit when units share one channel listing. */
  keywords?: string[];
}

export interface Match {
  id: string | null;
  /** The name that matched best. */
  name: string | null;
  /** Several listings match equally well: the host must choose. */
  ambiguous: boolean;
  candidates: string[];
}

/** Below this overlap a name matches nothing. */
export const MIN_SCORE = 0.4;
const EPS = 1e-9;

export function matchName(
  name: string | null | undefined,
  candidates: Candidate[],
  options: { aliases?: Record<string, string>; hint?: string | null } = {},
): Match {
  const none: Match = { id: null, name: null, ambiguous: false, candidates: [] };
  if (!name) return none;
  const pinned = options.aliases?.[normaliseName(name)];
  const pin = (): Match | null => {
    const c = pinned ? candidates.find((x) => x.id === pinned) : undefined;
    return c ? { id: c.id, name, ambiguous: false, candidates: [] } : null;
  };

  const target = tokens(name);
  const scored = candidates.map((c) => {
    let score = 0;
    let best = c.names[0] ?? c.id;
    for (const n of c.names) {
      const s = jaccard(target, tokens(n));
      if (s > score) {
        score = s;
        best = n;
      }
    }
    return { c, name: best, score };
  });
  const top = scored.reduce((a, b) => (b.score > a.score ? b : a), { c: null as Candidate | null, name: "", score: -1 });
  if (top.c === null || top.score < MIN_SCORE) return pin() ?? none;

  const winners = scored.filter((s) => Math.abs(s.score - top.score) <= EPS);
  if (winners.length === 1) return { id: top.c.id, name: top.name, ambiguous: false, candidates: [] };

  const hint = normaliseName(options.hint ?? "");
  if (hint) {
    const byHint = winners.filter((w) => (w.c.keywords ?? []).some((k) => ` ${hint} `.includes(` ${normaliseName(k)} `)));
    if (byHint.length === 1) return { id: (byHint[0] as (typeof winners)[number]).c.id, name: (byHint[0] as (typeof winners)[number]).name, ambiguous: false, candidates: [] };
  }
  return pin() ?? { id: null, name: top.name, ambiguous: true, candidates: winners.map((w) => w.c.id) };
}
