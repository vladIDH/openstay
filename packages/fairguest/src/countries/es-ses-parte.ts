/**
 * SES.HOSPEDAJES: our stays mapped to the parte de viajeros (PV) and the
 * reserva de hospedaje (RH), as ordered element trees.
 *
 * Source of every element name, order, length and code: the public
 * "Instrucciones para el alta masiva de comunicaciones" v1.1.0 (SGTIC,
 * 08-01-2024), https://hospedajes.ses.mir.es/hospedajes-sede/assets/docs/Instrucciones.pdf
 * - figure 1 and § 3: PV, peticion > solicitud > codigoEstablecimiento, comunicacion 1..n (contrato, persona 1..n);
 * - figure 2 and § 4: RH, peticion > solicitud > comunicacion 1..n (establecimiento, contrato, persona 1..n);
 * - figure 5 and § 7.1: the block direccion; codigoMunicipio is "códigos de municipios del INE (5 dígitos)";
 * - figure 6 and § 7.2: the block pago; only tipoPago is mandatory and only tipoPago is ever sent;
 * - § 8: the code tables (spain.ts).
 * The same structures are those of the web service (specification
 * «MIR-HOSPE-DSI-WS Servicio de Comunicación» v3.1.2, figures 3 and 4).
 *
 * The tree is NOT the XML: namespaces, the exact types and whether children
 * are qualified are in the Ministry's XSD, published only inside the SES
 * application. They come in through ONE hook, `SES_SCHEMA` below: until it is
 * filled in from the XSD, `sesXml` refuses and nothing can leave the computer.
 */
import { KINSHIP_CODES, PAYMENT_CODES, SES_DOCUMENT_CODES, SES_SEX_CODES } from "../spain.js";
import { NotAvailableError, type Address, type Guest, type Kind, type Stay } from "../types.js";

/** An element with a text value, or with child elements, in schema order. */
export type SesNode = { name: string; value: string } | { name: string; children: SesNode[] };

const leaf = (name: string, value: string | undefined | null): SesNode | null => (value === undefined || value === null || value === "" ? null : { name, value });
const node = (name: string, children: (SesNode | null)[]): SesNode => ({ name, children: children.filter((c): c is SesNode => c !== null) });

/** Max communications in one request (specification § 3.1). */
export const SES_MAX_PER_REQUEST = 100;

/** "AAAA-MM-DDThh:mm:ss"; with no known hour, midnight (§ 4: "enviar AAAA-MM-DDT00:00:00"). */
export const sesDateTime = (date: string, time?: string): string => `${date}T${time ?? "00:00"}:00`;

/**
 * The INE municipality code SES wants: 5 digits (province + municipality).
 * We keep the 6-digit code with its check digit (the Mossos want that one), so
 * the last digit is dropped here; a 5-digit code passes as it is.
 */
export function sesMunicipality(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (/^\d{6}$/.test(code)) return code.slice(0, 5);
  return /^\d{5}$/.test(code) ? code : undefined;
}

/** Cut to the length of the field, as the instructions give it (String(n)). */
const cut = (s: string | undefined, n: number) => (s === undefined ? undefined : s.trim().slice(0, n));

function direccion(a: Address | undefined): SesNode | null {
  if (!a || !a.street) return null;
  const spain = a.country === "ESP";
  return node("direccion", [
    leaf("direccion", cut(a.street, 100)),
    leaf("codigoMunicipio", spain ? sesMunicipality(a.municipalityCode) : undefined),
    leaf("nombreMunicipio", cut(a.locality, 100)),
    leaf("codigoPostal", cut(a.postalCode, 20)),
    leaf("pais", a.country),
  ]);
}

/** Support number only for NIF and NIE (§ 3: "obligatorio si el tipo de documento es NIF, NIE"). */
function documento(g: Guest) {
  const d = g.document;
  if (!d) return [];
  const code = SES_DOCUMENT_CODES[d.type];
  return [leaf("tipoDocumento", code), leaf("numeroDocumento", cut(d.number, 15)), leaf("soporteDocumento", code === "NIF" || code === "NIE" ? cut(d.support, 9) : undefined)];
}

/** personaHospedajeType (PV, figure 1): rol is always VI, everyone listed sleeps there. */
function personaParte(g: Guest): SesNode {
  return node("persona", [
    leaf("rol", "VI"),
    leaf("nombre", cut(g.givenName, 50)),
    leaf("apellido1", cut(g.surname1, 50)),
    leaf("apellido2", cut(g.surname2, 50)),
    ...documento(g),
    leaf("fechaNacimiento", g.birthDate),
    leaf("nacionalidad", g.nationality),
    leaf("sexo", g.sex ? SES_SEX_CODES[g.sex] : undefined),
    direccion(g.address),
    leaf("telefono", cut(g.phone, 20)),
    leaf("telefono2", cut(g.phone2, 20)),
    leaf("correo", cut(g.email, 50)),
    leaf("parentesco", g.kinship ? KINSHIP_CODES[g.kinship] : undefined),
  ]);
}

/** personaReservaType (RH, figure 2): the holder is TI, the travellers known so far VI; no support number, no kinship. */
function personaReserva(g: Guest, holder: boolean): SesNode {
  const d = g.document;
  return node("persona", [
    leaf("rol", holder ? "TI" : "VI"),
    leaf("nombre", cut(g.givenName, 50)),
    leaf("apellido1", cut(g.surname1, 50)),
    leaf("apellido2", cut(g.surname2, 50)),
    leaf("tipoDocumento", d ? SES_DOCUMENT_CODES[d.type] : undefined),
    leaf("numeroDocumento", cut(d?.number, 15)),
    leaf("fechaNacimiento", g.birthDate),
    leaf("nacionalidad", g.nationality),
    leaf("sexo", g.sex ? SES_SEX_CODES[g.sex] : undefined),
    direccion(g.address),
    leaf("telefono", cut(g.phone, 20)),
    leaf("telefono2", cut(g.phone2, 20)),
    leaf("correo", cut(g.email, 50)),
  ]);
}

/** contratoHospedajeType: the same block for PV and RH. */
function contrato(s: Stay): SesNode {
  return node("contrato", [
    leaf("referencia", cut(s.reference, 50)),
    leaf("fechaContrato", s.contractDate),
    leaf("fechaEntrada", sesDateTime(s.checkIn, s.checkInTime)),
    leaf("fechaSalida", sesDateTime(s.checkOut, s.checkOutTime)),
    leaf("numPersonas", String(s.people)),
    leaf("numHabitaciones", s.rooms !== undefined ? String(s.rooms) : undefined),
    leaf("internet", s.internet === undefined ? undefined : String(s.internet)),
    s.payment ? node("pago", [leaf("tipoPago", PAYMENT_CODES[s.payment.type])]) : null,
  ]);
}

/** One comunicacion of a stay. */
export function sesCommunication(s: Stay, kind: Kind): SesNode {
  if (kind === "checkin") return node("comunicacion", [contrato(s), ...s.guests.map(personaParte)]);
  return node("comunicacion", [node("establecimiento", [leaf("codigo", s.establishment)]), contrato(s), ...s.guests.map((g, i) => personaReserva(g, i === 0))]);
}

/** One request: what goes into one call (one establishment for a PV, at most 100 communications). */
export interface SesRequest {
  kind: Kind;
  /** PV only: the establishment of every communication inside. */
  establishment: string | null;
  stayIds: string[];
  tree: SesNode;
}

/**
 * The requests for these stays: a PV carries one codigoEstablecimiento for the
 * whole request, so PV stays are grouped by establishment; every request holds
 * at most 100 communications.
 */
export function sesRequests(stays: Stay[], kind: Kind): SesRequest[] {
  const groups = new Map<string, Stay[]>();
  for (const s of stays) {
    const k = kind === "checkin" ? s.establishment : "";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out: SesRequest[] = [];
  for (const [establishment, group] of groups) {
    for (let i = 0; i < group.length; i += SES_MAX_PER_REQUEST) {
      const part = group.slice(i, i + SES_MAX_PER_REQUEST);
      const comms = part.map((s) => sesCommunication(s, kind));
      out.push({
        kind,
        establishment: kind === "checkin" ? establishment : null,
        stayIds: part.map((s) => s.id),
        tree: node("peticion", [node("solicitud", [kind === "checkin" ? leaf("codigoEstablecimiento", establishment) : null, ...comms])]),
      });
    }
  }
  return out;
}

/** The tree as lines "path: value", for the host's preview (and the tests). */
export function sesLines(n: SesNode, prefix = ""): string[] {
  const p = prefix ? `${prefix}/${n.name}` : n.name;
  return "value" in n ? [`${p}: ${n.value}`] : n.children.flatMap((c) => sesLines(c, p));
}

// ------------------------------------------------------------------ the hook for the XSD

/**
 * Everything of the XML that only the Ministry's XSD and WSDL can say. When
 * they arrive (C:\Users\vladd\openstay-ses-docs, see docs/fairguest-ses.md):
 * 1. compare SES_SCHEMA_DRAFT with the XSD of altaParteHospedaje, of the RH,
 *    of consultarComunicacion and with the WSDL, and correct it;
 * 2. check the element order of es-ses-parte.ts against the XSD sequences;
 * 3. set SES_SCHEMA = { ...the checked values, verifiedOn: "YYYY-MM-DD" };
 * 4. the test "ses-xsd" then validates the generated XML against the XSD.
 */
export interface SesSchema {
  /** Version of the specification the values were checked against, e.g. "3.1.2". */
  specification: string;
  /** Day the values were checked against the XSD. */
  verifiedOn: string;
  /** Namespace of the document root (peticion) for each kind. */
  namespace: Record<Kind, string>;
  /** Are the child elements in the namespace too (elementFormDefault="qualified")? */
  qualified: boolean;
  /** The SOAP service: namespace and element names of the WSDL. */
  service: {
    namespace: string;
    communication: string;
    batchQuery: string;
  };
  /** codigoEstado values of a batch (consultaLote): done, still pending, refused as a whole. */
  batchStates: { done: string[]; pending: string[]; error: string[] };
}

/**
 * What the specification v3.1.2 says in its text (docs/registro-ospiti.md § 1),
 * read from a third-party copy: NOT verified on the XSD. Never used to send.
 */
export const SES_SCHEMA_DRAFT: Omit<SesSchema, "verifiedOn"> = {
  specification: "3.1.2 (unverified)",
  namespace: { checkin: "http://www.neg.hospedajes.mir.es/altaParteHospedaje", reservation: "http://www.neg.hospedajes.mir.es/altaReservaHospedaje" },
  qualified: false,
  service: { namespace: "http://www.soap.servicios.hospedajes.mir.es/comunicacion", communication: "comunicacionRequest", batchQuery: "consultaLoteRequest" },
  batchStates: { done: ["1"], pending: ["4", "5"], error: ["6"] },
};

/** THE hook: null until the values are checked on the Ministry's XSD. */
export const SES_SCHEMA: SesSchema | null = null;

export const SES_XSD_MISSING =
  "SES.HOSPEDAJES: the data is ready, but the XML is not switched on yet. It needs the Ministry's XSD schemas, published only inside the SES application: " +
  'download them into the folder openstay-ses-docs next to the repository (docs/fairguest-ses.md, "When the schemas arrive"). ' +
  "Nothing was prepared and nothing was sent. Until then, enter the guests on the SES.HOSPEDAJES website and record it with \"fairnight ospiti inviato\".";

const xmlEscape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);

function write(n: SesNode, prefix: string): string {
  const tag = `${prefix}${n.name}`;
  if ("value" in n) return `<${tag}>${xmlEscape(n.value)}</${tag}>`;
  return `<${tag}>${n.children.map((c) => write(c, prefix)).join("")}</${tag}>`;
}

/** The XML document of a request. Throws NotAvailableError while the hook is empty. */
export function sesXml(request: SesRequest, schema: SesSchema | null = SES_SCHEMA): string {
  if (!schema) throw new NotAvailableError(SES_XSD_MISSING);
  const ns = schema.namespace[request.kind];
  const root = request.tree;
  if ("value" in root) throw new Error("the root of a SES request has children");
  const inner = root.children.map((c) => write(c, schema.qualified ? "ns2:" : "")).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ns2:${root.name} xmlns:ns2="${xmlEscape(ns)}">${inner}</ns2:${root.name}>`;
}
