/**
 * Italy, Alloggiati Web (Polizia di Stato): the schedine and the web service.
 *
 * Built from the official documents of alloggiatiweb.poliziadistato.it:
 * - "WS_ALLOGGIATI – Documento di Descrizione", Rev. 01 of 24/01/2022
 *   (Download/Manuali/MANUALEWS.pdf) and the WSDL of service/service.asmx;
 * - the user manual (Download/Manuali/MANUALEALBERGHI.pdf), chapter 12;
 * - the code tables of the page Tabelle.aspx (Comuni, Stati, Documenti).
 *
 * A schedina is one line of 168 characters, fixed widths, padded with spaces.
 * The code tables are NOT in this package: the host's computer downloads them
 * from the public page and passes them in (AlloggiatiTables).
 *
 * The web service is SOAP 1.2. GenerateToken(Utente, Password, WsKey) gives a
 * token that goes with Utente in every other call. "Test" only checks the
 * schedine; "Send" checks them and sends the valid ones. There is no separate
 * test environment: both run on the real service. Network access is never
 * inside this file: the caller passes a Transport.
 */
import { ALPHA3_TO_ALPHA2 } from "../countries-iso.js";
import { ALLOGGIATI_DOCUMENT_CODES, daysOfStay, fullSurname, italyDeadlines, italyGuestRules, italyRetention, italyRules, ITALY_DOCUMENT_TYPES, lodgerTypes } from "../italy.js";
import { NotAvailableError, type Guest, type Place, type Problem, type Registry, type Stay, type Transport } from "../types.js";

export const ALLOGGIATI_PORTAL = "https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/";
export const ALLOGGIATI_SERVICE_URL = "https://alloggiatiweb.poliziadistato.it/service/service.asmx";

/** The public code tables (page Tabelle.aspx): comma-separated, no login needed. */
export const ALLOGGIATI_TABLE_URLS = {
  municipalities: "https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/ashx/Download.ashx?ID=0&N=COMUNI",
  states: "https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/ashx/Download.ashx?ID=1&N=STATI",
  documents: "https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/ashx/Download.ashx?ID=2&N=DOCUMENTI",
} as const;

export const SCHEDINA_LENGTH = 168;
/** The portal takes a file of at most 1000 lines (user manual, ch. 12). */
export const MAX_FILE_LINES = 1000;

export interface AlloggiatiPlace {
  code: string;
  name: string;
  /** Province of a municipality ("ES" for states, as in the table). */
  province: string;
  /** Last day the code was valid, for municipalities and states that no longer exist. */
  endedOn: string | null;
}

export interface AlloggiatiTables {
  municipalities: AlloggiatiPlace[];
  states: AlloggiatiPlace[];
  documents: { code: string; name: string }[];
}

/** "31/12/1983 00:00:00" → "1983-12-31". */
function tableDate(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function csvRows(text: string, header: string): string[][] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines[0]?.trim() !== header) throw new Error(`Unexpected Alloggiati Web table: the first line should be "${header}", it is "${(lines[0] ?? "").slice(0, 60)}".`);
  return lines.slice(1).map((l) => l.split(","));
}

/** The three tables from the text of the files downloaded from the portal. */
export function parseAlloggiatiTables(text: { municipalities: string; states: string; documents: string }): AlloggiatiTables {
  const places = (raw: string) =>
    csvRows(raw, "Codice,Descrizione,Provincia,DataFineVal").map(([code = "", name = "", province = "", end = ""]) => ({
      code: code.trim(),
      name: name.trim(),
      province: province.trim(),
      endedOn: tableDate(end),
    }));
  const tables: AlloggiatiTables = {
    municipalities: places(text.municipalities),
    states: places(text.states),
    documents: csvRows(text.documents, "Codice,Descrizione").map(([code = "", name = ""]) => ({ code: code.trim(), name: name.trim() })),
  };
  const bad = [...tables.municipalities, ...tables.states].find((p) => !/^\d{9}$/.test(p.code));
  if (bad) throw new Error(`Unexpected Alloggiati Web table: "${bad.code}" is not a 9-digit code.`);
  if (tables.states.length < 100 || tables.municipalities.length < 1000 || tables.documents.length < 3) throw new Error("The Alloggiati Web tables look incomplete: download them again.");
  return tables;
}

/** Upper case, no accents, only letters and digits: "Sant'Agata" and "SANT AGATA" are the same. */
export const placeKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * States whose Alloggiati Web name differs from the Italian name of the
 * country (written from the table "Stati" of October 2026). The others are
 * found by their Italian name.
 */
const STATE_NAMES: Record<string, string> = {
  AIA: "ANGUILLA (ISOLA)",
  BMU: "BERMUDE",
  BRN: "BRUNEI DARUSSALAM",
  CCK: "COCOS",
  CYM: "CAYMAN (ISOLE)",
  CXR: "CHRISTMAS",
  COD: "REPUBBLICA DEMOCRATICA DEL CONGO",
  COG: "CONGO",
  CZE: "REPUBBLICA CECA",
  ESH: "SAHARA SPAGNOLO",
  FLK: "MALVINE",
  FRO: "FAER OER",
  FSM: "MICRONESIA STATI FEDERALI",
  GUF: "GUAYANA FRANCESE",
  HKG: "HONG KONG",
  IMN: "MAN",
  KNA: "S. CHRISTOPHER E NEVIS",
  LKA: "SRI LANKA (CEYLON)",
  MAC: "MACAO",
  MHL: "MARSHALL",
  MKD: "MACEDONIA DEL NORD",
  MMR: "MYANMAR-BIRMANIA",
  MUS: "MAURIZIO",
  NFK: "NORFOLK",
  PCN: "PITCAIRN",
  PLW: "PALAU REPUBBLICA",
  PNG: "PAPUASIA-N.GUINEA",
  PRI: "PUERTO RICO",
  PSE: "PALESTINA",
  PYF: "POLINESIA",
  REU: "LA REUNION",
  RUS: "FEDERAZIONE RUSSA",
  SGS: "GEORGIA SUD E ISOLE SANDWICH AUSTRALI",
  SLB: "SALOMONE",
  SPM: "SAINT PIERRE ET MIQUELON",
  SVK: "REPUBBLICA SLOVACCA",
  SWZ: "SWAZILAND",
  TCA: "TURKS",
  TLS: "TIMOR",
  USA: "STATI UNITI D'AMERICA",
  VAT: "STATO DELLA CITTA' DEL VATICANO",
  VGB: "VERGINI BRITANNICHE (ISOLE)",
  VIR: "ISOLE VERGINI",
  WLF: "WALLIS",
};

const italianNames = new Intl.DisplayNames(["it"], { type: "region" });

/** The Alloggiati Web code of a country (ISO alpha-3), or null when the table has no such state. */
export function stateCode(tables: AlloggiatiTables, alpha3: string): string | null {
  const active = tables.states.filter((s) => s.endedOn === null);
  const wanted = STATE_NAMES[alpha3];
  if (wanted) return active.find((s) => s.name === wanted)?.code ?? null;
  const a2 = ALPHA3_TO_ALPHA2.get(alpha3);
  if (!a2) return null;
  const key = placeKey(italianNames.of(a2) ?? "");
  return active.find((s) => placeKey(s.name) === key)?.code ?? null;
}

export type Lookup = { code: string; province: string } | { problem: string };

/**
 * The code of an Italian municipality from what the guest wrote. `on` is the
 * day it must have existed (birth or issue date): codes of municipalities that
 * ended earlier are left out. With two municipalities of the same name the
 * province is needed.
 */
export function municipalityCode(tables: AlloggiatiTables, place: Place, on: string | undefined): Lookup {
  const key = placeKey(place.locality ?? "");
  if (!key) return { problem: "the municipality is missing" };
  let found = tables.municipalities.filter((m) => placeKey(m.name) === key);
  if (found.length === 0) return { problem: `no Italian municipality called "${place.locality}" in the Alloggiati Web table: check how it is written` };
  if (place.province) {
    found = found.filter((m) => m.province === place.province);
    if (found.length === 0) return { problem: `no municipality "${place.locality}" in the province ${place.province}` };
  }
  const day = on ?? "9999-12-31";
  const valid = found.filter((m) => m.endedOn === null || m.endedOn >= day);
  const choice = valid.length > 0 ? valid : found;
  const provinces = new Set(choice.map((m) => m.province));
  if (provinces.size > 1) return { problem: `"${place.locality}" exists in more than one province (${[...provinces].sort().join(", ")}): the province is needed` };
  // Several codes in one province: the one in force on that day, i.e. the first to end after it.
  const best = [...choice].sort((a, b) => (a.endedOn ?? "9999").localeCompare(b.endedOn ?? "9999"))[0] as AlloggiatiPlace;
  return { code: best.code, province: best.province };
}

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Fixed width: cut and padded with spaces on the right. */
const pad = (s: string, n: number) => s.slice(0, n).padEnd(n, " ");
/** Letters (also accented), spaces and apostrophes, as the DM 2013 allows for names. */
const nameField = (s: string) =>
  s
    .replace(/[.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("it");

function placeCode(tables: AlloggiatiTables, place: Place | undefined, on: string | undefined, path: string, problems: Problem[]): { municipality: string; province: string; state: string } {
  const out = { municipality: "", province: "", state: "" };
  if (!place?.country) return out;
  const state = stateCode(tables, place.country);
  if (!state) problems.push({ path: `${path}.country`, message: `the country ${place.country} is not in the Alloggiati Web table of states: choose the state it is part of` });
  else out.state = state;
  if (place.country === "ITA") {
    const m = municipalityCode(tables, place, on);
    if ("problem" in m) problems.push({ path: `${path}.locality`, message: m.problem });
    else {
      out.municipality = m.code;
      out.province = m.province;
    }
  }
  return out;
}

/** One schedina; problems when a code cannot be found. */
function schedina(stay: Stay, g: Guest, index: number, type: string, tables: AlloggiatiTables, problems: Problem[]): string {
  const p = `guests[${index}]`;
  const birth = placeCode(tables, g.birthPlace, g.birthDate, `${p}.birthPlace`, problems);
  const citizenship = g.nationality ? stateCode(tables, g.nationality) : null;
  if (g.nationality && !citizenship) problems.push({ path: `${p}.nationality`, message: `the citizenship ${g.nationality} is not in the Alloggiati Web table of states` });
  let document = " ".repeat(34);
  if (type === "16" || type === "17" || type === "18") {
    const d = g.document;
    const code = d ? ALLOGGIATI_DOCUMENT_CODES[d.type] : undefined;
    if (code && !tables.documents.some((x) => x.code === code)) problems.push({ path: `${p}.document.type`, message: `the document code ${code} is not in the Alloggiati Web table` });
    const issued = placeCode(tables, d?.issuedIn, d?.issuedOn, `${p}.document.issuedIn`, problems);
    const where = d?.issuedIn?.country === "ITA" ? issued.municipality : issued.state;
    document = pad(code ?? "", 5) + pad(d?.number ?? "", 20) + pad(where, 9);
  }
  const line =
    type +
    ddmmyyyy(stay.checkIn) +
    String(Math.min(daysOfStay(stay), 30)).padStart(2, "0") +
    pad(nameField(fullSurname(g)), 50) +
    pad(nameField(g.givenName), 30) +
    (g.sex === "male" ? "1" : g.sex === "female" ? "2" : " ") +
    (g.birthDate ? ddmmyyyy(g.birthDate) : " ".repeat(10)) +
    pad(birth.municipality, 9) +
    pad(birth.province, 2) +
    pad(birth.state, 9) +
    pad(citizenship ?? "", 9) +
    document;
  if (line.length !== SCHEDINA_LENGTH) throw new Error(`Internal error: a schedina of ${line.length} characters instead of ${SCHEDINA_LENGTH}.`);
  return line;
}

/**
 * The schedine of a stay, holder first and then the family or group, as the
 * portal wants them. Nothing is returned when a rule or a code is missing.
 */
export function schedine(stay: Stay, tables: AlloggiatiTables): { lines: string[]; problems: Problem[] } {
  const problems = italyRules(stay, "checkin");
  if (problems.length > 0) return { lines: [], problems };
  const types = lodgerTypes(stay.guests);
  const lines = stay.guests.map((g, i) => schedina(stay, g, i, types[i] as string, tables, problems));
  return problems.length > 0 ? { lines: [], problems } : { lines, problems };
}

/** The text file to upload by hand on the portal ("Invio file"): CR LF between lines, none after the last. */
export function alloggiatiFile(lines: string[], name: string): { name: string; text: string; bytes: Uint8Array } {
  if (lines.length === 0) throw new Error("No schedina to put in the file.");
  if (lines.length > MAX_FILE_LINES) throw new Error(`The portal takes at most ${MAX_FILE_LINES} schedine per file.`);
  const text = lines.join("\r\n");
  // The user manual says UTF-8 (the DM 2013 says standard ASCII; names with accents need UTF-8).
  return { name, text, bytes: new TextEncoder().encode(text) };
}

// ---------------------------------------------------------------- web service

export interface AlloggiatiCredentials {
  /** "Utente" of the structure, given by the Questura. */
  user: string;
  password: string;
  /** "Chiave Web Service" generated on the portal (menu of the user, Chiave Web Service). */
  wsKey: string;
}

export interface ServiceOutcome {
  ok: boolean;
  code: string;
  description: string;
  detail: string;
}

export interface LinesOutcome {
  /** General outcome of the call. */
  result: ServiceOutcome;
  /** Number of schedine that passed the checks. */
  valid: number;
  /** One outcome per line sent, in the same order. */
  lines: ServiceOutcome[];
}

export class AlloggiatiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlloggiatiError";
  }
}

const xmlEscape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);
const xmlUnescape = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) =>
    e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );

/** Inner text of the first element with this local name (any namespace prefix); "" for an empty element, null when absent. */
export function xmlElement(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`);
  const m = re.exec(xml);
  if (!m) return null;
  return m[1] === undefined ? "" : m[1];
}

function allElements(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`, "g");
  return [...xml.matchAll(re)].map((m) => m[1] ?? "");
}

const text = (xml: string, name: string) => xmlUnescape((xmlElement(xml, name) ?? "").trim());

function outcome(xml: string): ServiceOutcome {
  return { ok: text(xml, "esito") === "true", code: text(xml, "ErroreCod"), description: text(xml, "ErroreDes"), detail: text(xml, "ErroreDettaglio") };
}

function envelope(method: string, params: [string, string | string[]][]): string {
  const body = params
    .map(([k, v]) => (Array.isArray(v) ? `<all:${k}>${v.map((s) => `<all:string>${xmlEscape(s)}</all:string>`).join("")}</all:${k}>` : `<all:${k}>${xmlEscape(v)}</all:${k}>`))
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:all="AlloggiatiService"><soap:Header/><soap:Body><all:${method}>${body}</all:${method}></soap:Body></soap:Envelope>`;
}

/**
 * The calls of the Alloggiati Web service. Every method makes exactly one
 * request through the transport and never retries a Send: sending twice
 * would register the guests twice.
 */
export class AlloggiatiClient {
  constructor(
    private readonly transport: Transport,
    private readonly url: string = ALLOGGIATI_SERVICE_URL,
  ) {}

  private async call(method: string, params: [string, string | string[]][]): Promise<string> {
    const res = await this.transport({
      url: this.url,
      headers: { "content-type": `application/soap+xml; charset=utf-8; action="AlloggiatiService/${method}"` },
      body: envelope(method, params),
    });
    if (res.status >= 400 || /<(?:[\w.-]+:)?Fault[\s>]/.test(res.body)) {
      const reason = text(res.body, "Text") || text(res.body, "faultstring") || `HTTP ${res.status}`;
      throw new AlloggiatiError(`Alloggiati Web refused the call ${method}: ${reason}`);
    }
    return res.body;
  }

  /** A token for the other calls. The password and key are sent only here. */
  async token(c: AlloggiatiCredentials): Promise<{ token: string; expires: string }> {
    const xml = await this.call("GenerateToken", [
      ["Utente", c.user],
      ["Password", c.password],
      ["WsKey", c.wsKey],
    ]);
    const result = outcome(xmlElement(xml, "result") ?? "");
    const token = text(xml, "token");
    if (!result.ok || !token) throw new AlloggiatiError(`Alloggiati Web did not give a token: ${[result.code, result.description, result.detail].filter(Boolean).join(" · ") || "no reason given"}`);
    return { token, expires: text(xml, "expires") };
  }

  async authenticationTest(user: string, token: string): Promise<ServiceOutcome> {
    const xml = await this.call("Authentication_Test", [
      ["Utente", user],
      ["token", token],
    ]);
    return outcome(xmlElement(xml, "Authentication_TestResult") ?? "");
  }

  private async lines(method: "Test" | "Send", user: string, token: string, lines: string[], apartmentId?: number): Promise<LinesOutcome> {
    const name = apartmentId === undefined ? method : `GestioneAppartamenti_${method}`;
    const params: [string, string | string[]][] = [
      ["Utente", user],
      ["token", token],
      ["ElencoSchedine", lines],
    ];
    if (apartmentId !== undefined) params.push(["IdAppartamento", String(apartmentId)]);
    const xml = await this.call(name, params);
    const result = outcome(xmlElement(xml, `${name}Result`) ?? "");
    const detail = xmlElement(xml, "result") ?? "";
    const valid = Number(text(detail, "SchedineValide") || "0");
    return { result, valid, lines: allElements(xmlElement(detail, "Dettaglio") ?? "", "EsitoOperazioneServizio").map(outcome) };
  }

  /** Checks the schedine without sending them. */
  test(user: string, token: string, lines: string[], apartmentId?: number): Promise<LinesOutcome> {
    return this.lines("Test", user, token, lines, apartmentId);
  }

  /** Checks the schedine and sends the valid ones: from here they are registered with the police. */
  send(user: string, token: string, lines: string[], apartmentId?: number): Promise<LinesOutcome> {
    return this.lines("Send", user, token, lines, apartmentId);
  }

  /** The PDF receipt of the sends of one day (the last 30 days, today excluded). */
  async receipt(user: string, token: string, day: string): Promise<{ result: ServiceOutcome; pdf: Uint8Array | null }> {
    const xml = await this.call("Ricevuta", [
      ["Utente", user],
      ["token", token],
      ["Data", `${day}T00:00:00`],
    ]);
    const result = outcome(xmlElement(xml, "RicevutaResult") ?? "");
    const b64 = text(xml, "PDF").replace(/\s+/g, "");
    return { result, pdf: result.ok && b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : null };
  }

  /** A table of the service as CSV separated by ";" (ListaAppartamenti: the apartments of the user). */
  async table(user: string, token: string, kind: "Luoghi" | "Tipi_Documento" | "Tipi_Alloggiato" | "TipoErrore" | "ListaAppartamenti"): Promise<{ result: ServiceOutcome; csv: string }> {
    const xml = await this.call("Tabella", [
      ["Utente", user],
      ["token", token],
      ["tipo", kind],
    ]);
    return { result: outcome(xmlElement(xml, "TabellaResult") ?? ""), csv: text(xml, "CSV") };
  }
}

export const ALLOGGIATI_NEEDS_TABLES =
  "Alloggiati Web: the schedine need the code tables of the portal (municipalities, states, documents). " +
  'Download them with "fairnight ospiti tabelle"; nothing was prepared and nothing was sent.';

export const alloggiatiRegistry: Registry = {
  country: "IT",
  authority: "Alloggiati Web (Polizia di Stato)",
  documentTypes: ITALY_DOCUMENT_TYPES,
  validate: italyRules,
  checkGuest: italyGuestRules,
  deadlines: italyDeadlines,
  /** The schedine need the code tables: use `schedine` and `alloggiatiFile` with them. */
  prepare() {
    throw new NotAvailableError(ALLOGGIATI_NEEDS_TABLES);
  },
  retention: italyRetention,
};
