/**
 * The SES.HOSPEDAJES web service, without the network: the caller passes the
 * transport, as for Alloggiati Web.
 *
 * From the specification «MIR-HOSPE-DSI-WS Servicio de Comunicación» v3.1.2
 * (docs/registro-ospiti.md § 1): SOAP 1.1 with HTTP Basic over TLS; operation
 * `comunicacion` with a header (codigoArrendador, aplicacion, tipoOperacion,
 * tipoComunicacion) and the document zipped and in Base64; the answer gives a
 * batch number, read later with `consultaLote`. The element names of the
 * envelope come from the schema hook (es-ses-parte.ts): until it is filled in
 * from the WSDL nothing here is ever called by the commands.
 */
import { deflateRawSync } from "node:zlib";
import type { Kind, Transport } from "../types.js";
import type { SesSchema } from "./es-ses-parte.js";

export const SES_ENDPOINTS = {
  test: "https://hospedajes.pre-ses.mir.es/hospedajes-web/ws/v1/comunicacion",
  production: "https://hospedajes.ses.mir.es/hospedajes-web/ws/v1/comunicacion",
} as const;
export type SesEnvironment = keyof typeof SES_ENDPOINTS;
/** The free field `aplicacion` of the header: the name of the software. */
export const SES_APPLICATION = "Fairnight";

export interface SesCredentials {
  user: string;
  password: string;
}

export class SesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SesError";
  }
}

// ------------------------------------------------------------------ zip (one file, deflate)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive with one deflated file (APPNOTE 6.3: local header, data, central directory). */
export function zipOne(name: string, content: Uint8Array): Buffer {
  const fileName = Buffer.from(name, "utf8");
  const data = deflateRawSync(content);
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(0, 10); // time and date: none
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 30); // extra, comment lengths
  central.writeUInt32LE(0, 34); // disk, internal attributes
  central.writeUInt32LE(0, 38); // external attributes
  central.writeUInt32LE(0, 42); // offset of the local header
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(local.length + fileName.length + data.length, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

/** The `solicitud` of the request: the XML zipped, then Base64 (specification § 3). */
export const sesPayload = (xml: string): string => zipOne("solicitud.xml", Buffer.from(xml, "utf8")).toString("base64");

// ------------------------------------------------------------------ SOAP

const xmlEscape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string);

function element(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`).exec(xml);
  return m ? (m[1] ?? "") : null;
}
const all = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>)`, "g"))].map((m) => m[1] ?? "");
const text = (xml: string, name: string) =>
  (element(xml, name) ?? "")
    .trim()
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e] as string);

/** What the service answered to a communication: code 0 and a batch number when taken. */
export interface SesAnswer {
  ok: boolean;
  code: string;
  description: string;
  batch: string | null;
}

/** One communication of a batch, as consultaLote reports it (order inside the request, from 1). */
export interface SesLine {
  order: number;
  ok: boolean;
  /** codigoComunicacion given by SES when the communication was registered. */
  code: string | null;
  error: string | null;
}

export interface SesBatch {
  state: "done" | "pending" | "error" | "unknown";
  code: string;
  description: string;
  lines: SesLine[];
}

/**
 * One request per call, never retried: a communication sent twice is
 * registered twice. A timeout or a lost answer is reported as such, and the
 * caller says to check on the SES website before sending again.
 */
export class SesClient {
  constructor(
    private readonly transport: Transport,
    private readonly url: string,
    private readonly credentials: SesCredentials,
    private readonly schema: SesSchema,
  ) {}

  private async call(operation: string, inner: string): Promise<string> {
    const s = this.schema.service;
    const body = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:com="${xmlEscape(s.namespace)}"><soapenv:Header/><soapenv:Body><com:${operation}>${inner}</com:${operation}></soapenv:Body></soapenv:Envelope>`;
    const res = await this.transport({
      url: this.url,
      headers: {
        "content-type": "text/xml; charset=utf-8",
        soapaction: '""',
        authorization: `Basic ${Buffer.from(`${this.credentials.user}:${this.credentials.password}`, "utf8").toString("base64")}`,
      },
      body,
    });
    if (res.status === 401 || res.status === 403) throw new SesError("SES.HOSPEDAJES did not accept the user and password of the web service (HTTP " + res.status + ").");
    if (res.status >= 400 || /<(?:[\w.-]+:)?Fault[\s>]/.test(res.body)) {
      throw new SesError(`SES.HOSPEDAJES refused the call: ${text(res.body, "faultstring") || `HTTP ${res.status}`}`);
    }
    return res.body;
  }

  /** Sends one request (tipoOperacion A = alta). From here the communications are with the police. */
  async communicate(landlord: string, kind: Kind, payload: string): Promise<SesAnswer> {
    const header =
      `<cabecera><codigoArrendador>${xmlEscape(landlord)}</codigoArrendador><aplicacion>${SES_APPLICATION}</aplicacion>` +
      `<tipoOperacion>A</tipoOperacion><tipoComunicacion>${kind === "checkin" ? "PV" : "RH"}</tipoComunicacion></cabecera>`;
    const xml = await this.call(this.schema.service.communication, `<peticion>${header}<solicitud>${payload}</solicitud></peticion>`);
    const code = text(xml, "codigo");
    const batch = text(xml, "lote") || null;
    return { ok: code === "0" && batch !== null, code, description: text(xml, "descripcion"), batch };
  }

  /** The outcome of a batch, communication by communication. Reads only. */
  async batch(lote: string): Promise<SesBatch> {
    const xml = await this.call(this.schema.service.batchQuery, `<codigosLote><lote>${xmlEscape(lote)}</lote></codigosLote>`);
    const code = text(xml, "codigoEstado");
    const st = this.schema.batchStates;
    const state = st.done.includes(code) ? "done" : st.pending.includes(code) ? "pending" : st.error.includes(code) ? "error" : "unknown";
    const lines = all(xml, "resultadoComunicacion").map((r, i): SesLine => {
      const error = [text(r, "tipoError"), text(r, "error")].filter(Boolean).join(" · ") || null;
      const comm = text(r, "codigoComunicacion") || null;
      return { order: Number(text(r, "orden")) || i + 1, ok: !error && comm !== null, code: comm, error };
    });
    return { state, code, description: text(xml, "descEstado") || text(xml, "descripcion"), lines };
  }
}
