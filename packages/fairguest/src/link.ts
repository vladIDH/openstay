/**
 * The check-in link that works from anywhere:
 *
 *   https://<relay>/c/<box>#v1.<payload>
 *
 * Everything after "#" stays in the guest's browser: browsers never send it
 * to the server. It carries the host's public key, the write secret of the box
 * and what the page shows (country, listing name, dates), so the relay learns
 * none of it.
 */
import { COUNTRIES, type Country } from "./types.js";
import { isDate } from "./dates.js";
import { fromBase64url, toBase64url } from "./web-seal.js";

export interface LinkPayload {
  /** The host's public key, base64url DER SPKI. */
  k: string;
  /** The write secret of the box. */
  w: string;
  c: Country;
  /** Name of the listing, as the guest sees it. */
  n: string;
  /** Check-in and check-out, "YYYY-MM-DD". */
  i: string;
  o: string;
  /** 1 when the residence is asked (Italy, a listing that sends Istat data). */
  r?: 1;
  /** The town of a tourist tax that residents do not pay: the form asks each guest. */
  t?: string;
}

export const BOX_ID = /^[A-Za-z0-9_-]{22}$/;

export function linkFor(relay: string, box: string, payload: LinkPayload): string {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return `${relay.replace(/\/+$/, "")}/c/${box}#v1.${toBase64url(json)}`;
}

/** The payload from location.hash, or null when it is not a valid link. */
export function readLinkFragment(hash: string): LinkPayload | null {
  const m = /^#?v1\.([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromBase64url(m[1] as string))) as Partial<LinkPayload>;
    const ok =
      typeof p.k === "string" &&
      /^[A-Za-z0-9_-]{40,80}$/.test(p.k) &&
      typeof p.w === "string" &&
      /^[A-Za-z0-9_-]{22,86}$/.test(p.w) &&
      COUNTRIES.includes(p.c as Country) &&
      typeof p.n === "string" &&
      p.n.length <= 80 &&
      isDate(p.i) &&
      isDate(p.o) &&
      (p.r === undefined || p.r === 1) &&
      (p.t === undefined || (typeof p.t === "string" && p.t.length > 0 && p.t.length <= 80));
    return ok ? (p as LinkPayload) : null;
  } catch {
    return null;
  }
}

/** Where a guest sealed for the box is opened: the host's computer gives the same place to `open`. */
export const relayPlace = (box: string) => `relay/${box}`;
