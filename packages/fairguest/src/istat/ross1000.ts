/**
 * ROSS1000 (GIES): the XML of the tourist movement and its web service, from
 * "Tracciato record di integrazione dati (XML) – Istruzioni per le software
 * house", version 3 of 18/03/2026, and the public WSDL (checkinV2).
 *
 * One <movimento> per day, every day, closed days included, with the state of
 * the structure (open, rooms occupied, rooms and beds available); the guests
 * who arrive that day (<arrivi>) and leave that day (<partenze>). Names are not
 * mandatory and are never sent. Network access goes through a transport.
 */
import { AlloggiatiError, xmlElement } from "../countries/it-alloggiati.js";
import type { Transport } from "../types.js";
import type { IstatGuest } from "./record.js";
import { ROSS_PRODUCT } from "./regions.js";

export interface RossDay {
  /** "YYYY-MM-DD". */
  day: string;
  open: boolean;
  roomsOccupied: number;
  rooms: number;
  beds: number;
  arrivals: IstatGuest[];
  departures: { id: string; type: string; arrival: string }[];
}

/** The values the specification lists for the two mandatory free fields; we never know the guest's reason or transport. */
export const NOT_SPECIFIED_TOURISM = "Non specificato";
export const NOT_SPECIFIED_TRANSPORT = "Non Specificato";

const x = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);
const compact = (d: string) => d.replaceAll("-", "");
const el = (name: string, value: string | number) => `<${name}>${x(String(value))}</${name}>`;

function arrival(g: IstatGuest): string {
  return (
    "<arrivo>" +
    el("idswh", g.id) +
    el("tipoalloggiato", g.type) +
    el("idcapo", g.type === "19" || g.type === "20" ? g.head : "") +
    el("sesso", g.sex) +
    el("cittadinanza", g.citizenship) +
    el("statoresidenza", g.residenceState) +
    el("luogoresidenza", g.residencePlace) +
    el("datanascita", compact(g.birthDate)) +
    el("statonascita", g.birthState) +
    el("comunenascita", g.birthState === "100000100" ? g.birthMunicipality : "") +
    el("tipoturismo", NOT_SPECIFIED_TOURISM) +
    el("mezzotrasporto", NOT_SPECIFIED_TRANSPORT) +
    el("canaleprenotazione", "") +
    el("titolostudio", "") +
    el("professione", "") +
    el("esenzioneimposta", "") +
    "</arrivo>"
  );
}

function day(d: RossDay): string {
  const closed = !d.open;
  return (
    "<movimento>" +
    el("data", compact(d.day)) +
    "<struttura>" +
    el("apertura", closed ? "NO" : "SI") +
    el("camereoccupate", closed ? 0 : d.roomsOccupied) +
    el("cameredisponibili", closed ? 0 : d.rooms) +
    el("lettidisponibili", closed ? 0 : d.beds) +
    "</struttura>" +
    (d.arrivals.length ? `<arrivi>${d.arrivals.map(arrival).join("")}</arrivi>` : "") +
    (d.departures.length ? `<partenze>${d.departures.map((p) => `<partenza>${el("idswh", p.id)}${el("tipoalloggiato", p.type)}${el("arrivo", compact(p.arrival))}</partenza>`).join("")}</partenze>` : "") +
    "</movimento>"
  );
}

const body = (code: string, days: RossDay[]) => `${el("codice", code)}${el("prodotto", ROSS_PRODUCT)}${days.map(day).join("")}`;

/** The file to upload by hand ("Importa file gestionale"), UTF-8, days in increasing order. */
export function rossFile(code: string, days: RossDay[]): string {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<movimenti>${body(code, sorted)}</movimenti>\n`;
}

export interface RossOutcome {
  day: string;
  ok: boolean;
  /** The refused records, "idswh: reason". */
  errors: string[];
}

/** The web service of a region: one call per structure, with the days in order. */
export class Ross1000Client {
  constructor(
    private readonly transport: Transport,
    private readonly endpoint: string,
  ) {}

  async send(user: string, password: string, code: string, days: RossDay[]): Promise<RossOutcome[]> {
    const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:inviaMovimentazione xmlns:ns2="http://checkin.ws.service.turismo5.gies.it/"><movimentazione>${body(code, sorted)}</movimentazione></ns2:inviaMovimentazione></S:Body></S:Envelope>`;
    const res = await this.transport({
      url: this.endpoint,
      headers: { "content-type": "text/xml; charset=utf-8", soapaction: '""', authorization: `Basic ${btoa(`${user}:${password}`)}` },
      body: envelope,
    });
    if (res.status === 401 || res.status === 403) throw new AlloggiatiError("ROSS1000 refused the user or password of the structure (HTTP " + res.status + ").");
    if (res.status >= 400 || /<(?:[\w.-]+:)?Fault[\s>]/.test(res.body)) {
      throw new AlloggiatiError(`ROSS1000 refused the data: ${(xmlElement(res.body, "faultstring") ?? "").trim() || `HTTP ${res.status}`}`);
    }
    const ret = xmlElement(res.body, "return") ?? "";
    const results = [...ret.matchAll(/<risultatiGiorno>([\s\S]*?)<\/risultatiGiorno>|<risultatiGiorno\s*\/>/g)].map((m) => m[1] ?? "");
    return sorted.map((d, i) => {
      const r = results[i] ?? "";
      const errors = [...r.matchAll(/<(?:arrivo|partenza|prenotazione|eliminazione)>([\s\S]*?)<\/(?:arrivo|partenza|prenotazione|eliminazione)>/g)]
        .map((m) => m[1] as string)
        .filter((item) => (xmlElement(item, "successo") ?? "").trim() === "false")
        .map((item) => `${(xmlElement(item, "idswh") ?? "").trim()}: ${(xmlElement(item, "errore") ?? "").trim() || "refused"}`);
      return { day: d.day, ok: errors.length === 0 && (results.length === sorted.length || d.arrivals.length + d.departures.length === 0), errors };
    });
  }
}
