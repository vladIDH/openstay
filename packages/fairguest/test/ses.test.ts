/**
 * SES.HOSPEDAJES without the network: the mapping to the parte de viajeros and
 * the reserva de hospedaje (public instructions v1.1.0), the zip, and the SOAP
 * client against a fake transport. Invented data only.
 */
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  crc32,
  NotAvailableError,
  SES_ENDPOINTS,
  SES_SCHEMA,
  SES_SCHEMA_DRAFT,
  SES_XSD_MISSING,
  SesClient,
  SesError,
  sesDateTime,
  sesLines,
  sesMunicipality,
  sesPayload,
  sesRequests,
  sesXml,
  validateGuestSettings,
  zipOne,
  type Guest,
  type SesRequest,
  type SesSchema,
  type Transport,
} from "../src/index.js";
import { child, holder, stay } from "./data.js";

const one = (r: SesRequest[]) => r[0] as SesRequest;

/** The draft values, ONLY to exercise the code against fakes: never the Ministry's. */
const FAKE_SCHEMA: SesSchema = { ...SES_SCHEMA_DRAFT, verifiedOn: "fake, tests only" };

const spanish = (): Guest => ({
  givenName: "Lucía",
  surname1: "Prueba",
  surname2: "Ejemplo",
  birthDate: "2060-07-02",
  sex: "female",
  nationality: "ESP",
  document: { type: "dni", number: "00000000T", support: "ZZZ000000" },
  address: { country: "ESP", street: "Calle de Prueba 1", locality: "Adeje", postalCode: "38670", municipalityCode: "380017" },
  phone: "+34 600 000 000",
});

/** Unzip the single file of zipOne, reading the local header. */
function unzip(zip: Buffer): { name: string; text: string } {
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const size = zip.readUInt32LE(18);
  const nameLength = zip.readUInt16LE(26);
  const name = zip.subarray(30, 30 + nameLength).toString("utf8");
  const data = zip.subarray(30 + nameLength, 30 + nameLength + size);
  const text = inflateRawSync(data).toString("utf8");
  expect(crc32(Buffer.from(text, "utf8"))).toBe(zip.readUInt32LE(14));
  return { name, text };
}

describe("SES mapping (Instrucciones alta masiva v1.1.0)", () => {
  it("builds the parte de viajeros in the order of figure 1, codes of § 8, INE code of 5 digits", () => {
    const req = one(sesRequests([stay({ guests: [spanish(), child()] })], "checkin"));
    expect(req.establishment).toBe("ZZ00000000");
    const lines = sesLines(req.tree);
    expect(lines.slice(0, 10)).toEqual([
      "peticion/solicitud/codigoEstablecimiento: ZZ00000000",
      "peticion/solicitud/comunicacion/contrato/referencia: PROVA-0001",
      "peticion/solicitud/comunicacion/contrato/fechaContrato: 2099-05-20",
      "peticion/solicitud/comunicacion/contrato/fechaEntrada: 2099-06-10T16:00:00",
      "peticion/solicitud/comunicacion/contrato/fechaSalida: 2099-06-13T10:00:00",
      "peticion/solicitud/comunicacion/contrato/numPersonas: 2",
      "peticion/solicitud/comunicacion/contrato/numHabitaciones: 1",
      "peticion/solicitud/comunicacion/contrato/internet: true",
      "peticion/solicitud/comunicacion/contrato/pago/tipoPago: PLATF",
      "peticion/solicitud/comunicacion/persona/rol: VI",
    ]);
    const first = lines.filter((l) => l.includes("/persona/")).slice(0, 15).map((l) => l.replace("peticion/solicitud/comunicacion/persona/", ""));
    expect(first).toEqual([
      "rol: VI",
      "nombre: Lucía",
      "apellido1: Prueba",
      "apellido2: Ejemplo",
      "tipoDocumento: NIF",
      "numeroDocumento: 00000000T",
      "soporteDocumento: ZZZ000000",
      "fechaNacimiento: 2060-07-02",
      "nacionalidad: ESP",
      "sexo: M",
      "direccion/direccion: Calle de Prueba 1",
      "direccion/codigoMunicipio: 38001",
      "direccion/nombreMunicipio: Adeje",
      "direccion/codigoPostal: 38670",
      "direccion/pais: ESP",
    ]);
    // The minor: no document, the kinship code; never a card number or an IBAN anywhere.
    expect(lines).toContain("peticion/solicitud/comunicacion/persona/parentesco: HJ");
    expect(lines.join("\n")).not.toMatch(/medioPago|titular|caducidadTarjeta/);
  });

  it("abroad: no INE code, the town by name; a passport has no support number", () => {
    const req = one(sesRequests([stay({ guests: [{ ...holder(), document: { type: "passport", number: "ZZ0000000", support: "IGNORED" } }] })], "checkin"));
    const lines = sesLines(req.tree).join("\n");
    expect(lines).toContain("direccion/nombreMunicipio: Città di Prova");
    expect(lines).toContain("direccion/pais: ITA");
    expect(lines).not.toContain("codigoMunicipio");
    expect(lines).not.toContain("soporteDocumento");
    expect(lines).toContain("tipoDocumento: PAS");
  });

  it("builds the reserva de hospedaje of figure 2: establishment per communication, holder TI, midnight when no hour", () => {
    const req = one(sesRequests([stay({ checkInTime: undefined, checkOutTime: undefined, guests: [spanish(), holder()] })], "reservation"));
    expect(req.establishment).toBeNull();
    const lines = sesLines(req.tree);
    expect(lines[0]).toBe("peticion/solicitud/comunicacion/establecimiento/codigo: ZZ00000000");
    expect(lines).toContain("peticion/solicitud/comunicacion/contrato/fechaEntrada: 2099-06-10T00:00:00");
    const roles = lines.filter((l) => l.endsWith("/rol: TI") || l.endsWith("/rol: VI"));
    expect(roles).toEqual(["peticion/solicitud/comunicacion/persona/rol: TI", "peticion/solicitud/comunicacion/persona/rol: VI"]);
    // personaReservaType has no support number and no kinship.
    expect(lines.join("\n")).not.toMatch(/soporteDocumento|parentesco/);
  });

  it("groups a PV by establishment and never puts more than 100 communications in a request", () => {
    const many = Array.from({ length: 205 }, (_, i) => stay({ id: `s${i}`, establishment: i < 203 ? "AAAAAAAAAA" : "BBBBBBBBBB" }));
    const reqs = sesRequests(many, "checkin");
    expect(reqs.map((r) => [r.establishment, r.stayIds.length])).toEqual([
      ["AAAAAAAAAA", 100],
      ["AAAAAAAAAA", 100],
      ["AAAAAAAAAA", 3],
      ["BBBBBBBBBB", 2],
    ]);
    expect(sesRequests(many, "reservation").map((r) => r.stayIds.length)).toEqual([100, 100, 5]);
  });

  it("dates, INE codes, cut fields", () => {
    expect(sesDateTime("2099-06-10")).toBe("2099-06-10T00:00:00");
    expect(sesDateTime("2099-06-10", "16:30")).toBe("2099-06-10T16:30:00");
    expect(sesMunicipality("380017")).toBe("38001");
    expect(sesMunicipality("38001")).toBe("38001");
    expect(sesMunicipality("3800")).toBeUndefined();
    const req = one(sesRequests([stay({ reference: "R".repeat(80) })], "checkin"));
    expect(sesLines(req.tree)).toContain(`peticion/solicitud/comunicacion/contrato/referencia: ${"R".repeat(50)}`);
  });
});

describe("the XSD hook", () => {
  it("is empty until the values are checked on the Ministry's XSD: nothing can be built", () => {
    expect(SES_SCHEMA).toBeNull();
    const req = one(sesRequests([stay()], "checkin"));
    expect(() => sesXml(req)).toThrow(NotAvailableError);
    expect(() => sesXml(req)).toThrow(SES_XSD_MISSING);
    expect(SES_XSD_MISSING).toMatch(/openstay-ses-docs/);
    expect(SES_XSD_MISSING).toMatch(/Nothing was prepared and nothing was sent/);
  });

  it("with schema values (fake here) writes the document with the root in its namespace, escaped", () => {
    const req = one(sesRequests([stay({ reference: "A&B <1>" })], "checkin"));
    const xml = sesXml(req, FAKE_SCHEMA);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><ns2:peticion xmlns:ns2="http:\/\/www\.neg\.hospedajes\.mir\.es\/altaParteHospedaje"><solicitud><codigoEstablecimiento>ZZ00000000<\/codigoEstablecimiento><comunicacion><contrato><referencia>A&amp;B &lt;1&gt;<\/referencia>/);
    expect(xml.endsWith("</ns2:peticion>")).toBe(true);
    expect(sesXml(req, { ...FAKE_SCHEMA, qualified: true })).toContain("<ns2:solicitud><ns2:codigoEstablecimiento>");
  });
});

describe("zip and Base64", () => {
  it("crc32 of the standard check string", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("one deflated file that any unzip can read back", () => {
    const xml = `<?xml version="1.0"?><a>${"ñ".repeat(500)}</a>`;
    const back = unzip(Buffer.from(sesPayload(xml), "base64"));
    expect(back).toEqual({ name: "solicitud.xml", text: xml });
    const zip = zipOne("x.xml", Buffer.from("hello"));
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });
});

describe("the SOAP client (fake transport)", () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const lastCall = () => calls[calls.length - 1] as { url: string; headers: Record<string, string>; body: string };
  const answer = (body: string, status = 200): Transport => async (req) => {
    calls.push(req);
    return { status, body };
  };
  const env = (inner: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:respuesta xmlns:ns2="x">${inner}</ns2:respuesta></soap:Body></soap:Envelope>`;

  it("sends the header, the payload and HTTP Basic; reads the batch number", async () => {
    const c = new SesClient(answer(env("<codigo>0</codigo><descripcion>Ok</descripcion><lote>11111111-2222-3333-4444-555555555555</lote>")), SES_ENDPOINTS.test, { user: "usuario", password: "clave" }, FAKE_SCHEMA);
    const a = await c.communicate("0000000001", "checkin", "UEsDBA==");
    expect(a).toEqual({ ok: true, code: "0", description: "Ok", batch: "11111111-2222-3333-4444-555555555555" });
    const req = lastCall();
    expect(req.url).toBe("https://hospedajes.pre-ses.mir.es/hospedajes-web/ws/v1/comunicacion");
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from("usuario:clave").toString("base64")}`);
    expect(req.body).toContain("<cabecera><codigoArrendador>0000000001</codigoArrendador><aplicacion>Fairnight</aplicacion><tipoOperacion>A</tipoOperacion><tipoComunicacion>PV</tipoComunicacion></cabecera>");
    expect(req.body).toContain("<solicitud>UEsDBA==</solicitud>");
    expect(req.body).toContain('xmlns:com="http://www.soap.servicios.hospedajes.mir.es/comunicacion"');
  });

  it("a refusal with its code, a wrong password, a SOAP fault", async () => {
    const refused = new SesClient(answer(env("<codigo>10120</codigo><descripcion>Arrendador sin canal de servicio web</descripcion>")), "u", { user: "u", password: "p" }, FAKE_SCHEMA);
    expect(await refused.communicate("0000000001", "reservation", "x")).toEqual({ ok: false, code: "10120", description: "Arrendador sin canal de servicio web", batch: null });
    expect(lastCall().body).toContain("<tipoComunicacion>RH</tipoComunicacion>");
    await expect(new SesClient(answer("", 401), "u", { user: "u", password: "p" }, FAKE_SCHEMA).communicate("0000000001", "checkin", "x")).rejects.toThrow(/did not accept the user and password/);
    await expect(
      new SesClient(answer("<soap:Envelope><soap:Body><soap:Fault><faultstring>XML mal formado</faultstring></soap:Fault></soap:Body></soap:Envelope>", 500), "u", { user: "u", password: "p" }, FAKE_SCHEMA).communicate("0000000001", "checkin", "x"),
    ).rejects.toThrow(SesError);
  });

  it("reads a batch: done, pending, line by line", async () => {
    const done = env(
      "<codigoEstado>1</codigoEstado><descEstado>Tramitado</descEstado><resultadoComunicaciones>" +
        "<resultadoComunicacion><orden>1</orden><codigoComunicacion>C-0001</codigoComunicacion></resultadoComunicacion>" +
        "<resultadoComunicacion><orden>2</orden><tipoError>E</tipoError><error>Documento no válido</error></resultadoComunicacion>" +
        "</resultadoComunicaciones>",
    );
    const r = await new SesClient(answer(done), "u", { user: "u", password: "p" }, FAKE_SCHEMA).batch("lote-1");
    expect(r.state).toBe("done");
    expect(r.lines).toEqual([
      { order: 1, ok: true, code: "C-0001", error: null },
      { order: 2, ok: false, code: null, error: "E · Documento no válido" },
    ]);
    expect(lastCall().body).toContain("<codigosLote><lote>lote-1</lote></codigosLote>");
    const pending = await new SesClient(answer(env("<codigoEstado>4</codigoEstado>")), "u", { user: "u", password: "p" }, FAKE_SCHEMA).batch("lote-2");
    expect(pending.state).toBe("pending");
  });
});

describe('the "ses" block of a listing', () => {
  it("is for Spain only, needs a 10-character codigoArrendador, starts on the test service", () => {
    const ok = validateGuestSettings({ country: "ES", establishment: "0000000001", ses: { landlord: "0000000abc" } }, "f");
    expect(ok.value?.ses).toEqual({ landlord: "0000000ABC", account: "principale", environment: "test" });
    expect(validateGuestSettings({ country: "ES", establishment: "0000000001", ses: { landlord: "0000000001", environment: "production" } }, "f").value?.ses?.environment).toBe("production");
    const bad = validateGuestSettings({ country: "ES", establishment: "0000000001", ses: { landlord: "123", environment: "live", password: "x" } }, "f");
    expect(bad.issues.map((i) => i.path)).toEqual(["f.ses.password", "f.ses.landlord", "f.ses.environment"]);
    expect(validateGuestSettings({ country: "IT", establishment: "X1", ses: { landlord: "0000000001" } }, "f").issues[0]?.message).toMatch(/only for listings that send to SES/);
  });
});
