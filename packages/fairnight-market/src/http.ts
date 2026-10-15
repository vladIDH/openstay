/**
 * One GET to a public statistics service (ISTAC, INE), with a few retries on
 * 429 and 5xx. No key and no personal data: these are open data services.
 */
import type { FetchLike } from "./airroi.js";

const MAX_RETRIES = 3;

export class OpenDataError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "OpenDataError";
  }
}

export interface OpenDataOptions {
  fetch: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export async function getText(url: string, accept: string, who: string, options: OpenDataOptions): Promise<string> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await options.fetch(url, {
        method: "GET",
        headers: { accept, "user-agent": "Fairnight (open-source pricing for hosts)" },
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new OpenDataError(`${who} could not be reached: ${(e as Error).message}`, null);
    }
    const text = await res.text();
    if (res.status >= 200 && res.status < 300) return text;
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw new OpenDataError(`${who} answered HTTP ${res.status}.`, res.status);
  }
}

/** "Adeje", "ADEJE", "Adéje " → "adeje": names compared without case and accents. */
export const plainName = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
