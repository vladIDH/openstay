/**
 * Fairguest in Spain on the host's computer: SES.HOSPEDAJES through its web service.
 *
 * - The codigoArrendador and the environment are in fairnight.config.json
 *   ("ses" block of the listing); the user and password of the web service are
 *   sealed in the meta table, one entry per account and environment, and open
 *   only with the passphrase.
 * - Two environments: "test" (pre-ses, the Ministry's test service, nothing is
 *   registered) and "production". Production is used only when the listing's
 *   config says so; --ambiente prova always goes to the test service.
 * - Nothing leaves without --applica and a confirmation typed in a terminal.
 *   Every request, its batch number and the Ministry's answers are recorded in
 *   guest_submissions: channel "ses-ws" (production) or "ses-prova" (test,
 *   which never counts as a communication made).
 * - The XML needs the Ministry's XSD: until the schema hook is filled in
 *   (es-ses-parte.ts) prepare and send stop before any network access.
 */
import type { KeyObject } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  addDays,
  DEFAULT_ALLOGGIATI_ACCOUNT,
  localDateTime,
  open,
  publicKeyOf,
  registryFor,
  seal,
  SES_ENDPOINTS,
  SES_SCHEMA,
  SES_XSD_MISSING,
  SesClient,
  SesError,
  sesLines,
  sesPayload,
  sesRequests,
  sesXml,
  type GuestSettings,
  type Kind,
  type SesCredentials,
  type SesEnvironment,
  type SesSchema,
  type Transport,
} from "fairguest";
import type { HostConfig } from "../config.js";
import { SetupError } from "../config.js";
import { getMeta, setMeta, type Db } from "../db.js";
import { UsageError } from "../errors.js";
import { DATA_DIR, type Io } from "../io.js";
import { listStays, openStay, readKeys, recordSubmission, submissions, type OpenedStay, type StayRow, type SubmissionKind, type SubmissionRow } from "./store.js";

/** Channels of the records: production counts as a communication made, the test service never does. */
export const SES_CHANNEL = "ses-ws";
export const SES_TEST_CHANNEL = "ses-prova";
export const channelOf = (env: SesEnvironment) => (env === "production" ? SES_CHANNEL : SES_TEST_CHANNEL);
const ENV_WORDS: Record<SesEnvironment, string> = { test: "test service (pre-ses: nothing is registered)", production: "PRODUCTION (registered with the police)" };

/** What the commands of commands.ts lend to these ones. */
export interface SesHelpers {
  stayOrFail(id: string | undefined): StayRow;
  settingsOf(row: StayRow): GuestSettings;
  notErased(row: StayRow): void;
  unlockedKey(): Promise<KeyObject>;
  kindOf(raw: string | undefined): SubmissionKind;
}

export interface SesOptions {
  tipo?: string;
  out?: string;
  applica?: boolean;
  account?: string;
  ambiente?: string;
}

// ------------------------------------------------------------------ credentials

const credentialsKey = (account: string, env: SesEnvironment) => `fairguest_ses_${account}_${env}`;
const credentialsPlace = (account: string, env: SesEnvironment) => `meta/ses/${account}/${env}`;

export function saveSesCredentials(db: Db, account: string, env: SesEnvironment, c: SesCredentials): void {
  const record = readKeys(db);
  if (!record) throw new Error('Fairguest is not set up in this folder: run "fairnight ospiti attiva" first.');
  setMeta(db, credentialsKey(account, env), seal(publicKeyOf(record), c, credentialsPlace(account, env)));
}

export const hasSesCredentials = (db: Db, account: string, env: SesEnvironment) => getMeta(db, credentialsKey(account, env)) !== null;

export function loadSesCredentials(db: Db, account: string, env: SesEnvironment, key: KeyObject): SesCredentials | null {
  const sealed = getMeta(db, credentialsKey(account, env));
  return sealed ? open<SesCredentials>(key, sealed, credentialsPlace(account, env)) : null;
}

function envWord(raw: string | undefined): SesEnvironment | undefined {
  if (raw === undefined) return undefined;
  if (raw === "prova" || raw === "test" || raw === "pruebas") return "test";
  if (raw === "produzione" || raw === "production" || raw === "produccion" || raw === "producción") return "production";
  throw new UsageError(`--ambiente must be prova or produzione, got "${raw}"`);
}

/** The environment of a listing: its config, or the test service when asked; production only if the config says so. */
export function environmentOf(settings: GuestSettings, raw: string | undefined): SesEnvironment {
  const configured = settings.ses?.environment ?? "test";
  const asked = envWord(raw);
  if (asked === "production" && configured !== "production") {
    throw new SetupError('Production is switched on only in fairnight.config.json, in the listing\'s block: "ses": { "environment": "production" }. Nothing was sent.');
  }
  return asked ?? configured;
}

export async function sesCredentials(db: Db, values: SesOptions, io: Io): Promise<number> {
  const account = values.account ?? DEFAULT_ALLOGGIATI_ACCOUNT;
  if (!/^[a-z0-9-]{1,30}$/.test(account)) throw new UsageError(`--account must be a short name of lower-case letters, digits and dashes, got "${account}"`);
  const env = envWord(values.ambiente) ?? "test";
  if (!io.prompt) throw new SetupError("The credentials are asked in a terminal (the password without echo), never written on the command line.");
  const before = hasSesCredentials(db, account, env);
  io.out(`SES.HOSPEDAJES, ${env === "test" ? "test service (pre-ses)" : "production"}, account "${account}": the user and password of the WEB SERVICE, not those of the website.`);
  const user = (await io.prompt("Usuario del servicio web: ", { hidden: false })).trim();
  if (!/^[A-Za-z0-9._@-]{2,60}$/.test(user)) throw new SetupError("The user is a code of letters and digits, as SES.HOSPEDAJES gave it: nothing was saved.");
  const password = await io.prompt("Contraseña: ", { hidden: true });
  if (!password) throw new SetupError("No password given: nothing was saved.");
  saveSesCredentials(db, account, env, { user, password });
  io.out(`Saved${before ? ", replacing the previous ones" : ""}. They are sealed with your Fairguest key and open only with the passphrase; they are not in fairnight.config.json.`);
  return 0;
}

// ------------------------------------------------------------------ the network, the schema

export function sesSchemaOf(io: Io): SesSchema | null {
  return io.sesSchema !== undefined ? io.sesSchema : SES_SCHEMA;
}

function sesClient(io: Io, env: SesEnvironment, c: SesCredentials, schema: SesSchema): SesClient {
  const doFetch = io.sesFetch ?? ((url, init) => fetch(url, init));
  const transport: Transport = async (req) => {
    const res = await doFetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(60_000) });
    return { status: res.status, body: await res.text() };
  };
  return new SesClient(transport, io.sesUrls?.[env] ?? SES_ENDPOINTS[env], c, schema);
}

// ------------------------------------------------------------------ the state of a stay

const SES_KIND: Record<Kind, string> = { checkin: "parte de viajeros (PV)", reservation: "reserva de hospedaje (RH)" };

function sesKind(h: SesHelpers, raw: string | undefined): Kind {
  const k = h.kindOf(raw);
  if (k === "cancellation") throw new UsageError('A cancellation is made on the SES.HOSPEDAJES website; then record it with "fairnight ospiti inviato <stay> --tipo annullamento".');
  return k;
}

/** The last record of this kind on this channel: "sent" waits for its outcome, "accepted" is done, "rejected" can go again. */
export function lastSes(rows: SubmissionRow[], kind: Kind, channel: string): SubmissionRow | null {
  return rows.filter((r) => r.kind === kind && r.channel === channel).at(-1) ?? null;
}

function spanish(h: SesHelpers, row: StayRow): GuestSettings {
  const s = h.settingsOf(row);
  if (s.country !== "ES") throw new UsageError(`Stay ${row.id} does not go to SES.HOSPEDAJES (country ${s.country}).`);
  return s;
}

function needsSesBlock(row: StayRow, s: GuestSettings): NonNullable<GuestSettings["ses"]> {
  if (!s.ses) {
    throw new SetupError(`Listing "${row.listing}" has no "ses" block in fairnight.config.json: add "ses": { "landlord": "<codigoArrendador>", "environment": "test" } (docs/fairguest-ses.md).`);
  }
  return s.ses;
}

/** Problems that stop a stay; none = ready. */
function problems(o: OpenedStay, kind: Kind): string[] {
  return registryFor("ES")
    .validate(o.stay, kind)
    .map((p) => `${p.path}: ${p.message}`);
}

/** What the preview shows of one communication: the fields, without the path of the request. */
function preview(o: OpenedStay, kind: Kind, io: Io): void {
  const [request] = sesRequests([o.stay], kind);
  if (!request) return;
  for (const l of sesLines(request.tree)) io.out(`    ${l.replace(/^peticion\/solicitud\/(comunicacion\/)?/, "")}`);
}

// ------------------------------------------------------------------ prepara

export async function prepareSes(dir: string, db: Db, rows: StayRow[], values: SesOptions, io: Io, h: SesHelpers): Promise<number> {
  const kind = sesKind(h, values.tipo);
  rows.forEach((r) => {
    h.notErased(r);
    spanish(h, r);
  });
  const key = await h.unlockedKey();
  const today = localDateTime(io.now()).slice(0, 10);
  const stays = rows.map((r) => openStay(db, r, h.settingsOf(r), key, today));
  let failed = false;
  for (const o of stays) {
    const p = problems(o, kind);
    if (p.length > 0) {
      failed = true;
      io.out(`${o.stay.id}: the ${SES_KIND[kind]} cannot be made yet:`);
      for (const x of p) io.out(`  - ${x}`);
      continue;
    }
    io.out(`${o.stay.id} (${o.row.listing}): ${SES_KIND[kind]}, what SES.HOSPEDAJES will receive:`);
    preview(o, kind, io);
  }
  if (failed) {
    io.out('Complete the data with the check-in form or "fairnight ospiti correggi", then prepare again. Nothing was written.');
    return 1;
  }
  const schema = sesSchemaOf(io);
  if (!schema) {
    io.out(SES_XSD_MISSING);
    return 1;
  }
  const at = localDateTime(io.now());
  const folder = path.resolve(io.cwd, values.out ?? path.join(dir, DATA_DIR, "fairguest"));
  mkdirSync(folder, { recursive: true });
  for (const [i, request] of sesRequests(
    stays.map((o) => o.stay),
    kind,
  ).entries()) {
    const file = path.join(folder, `ses-${kind === "checkin" ? "pv" : "rh"}-${at.replace(/[-:]/g, "").replace("T", "-")}-${i + 1}.xml`);
    writeFileSync(file, sesXml(request, schema), { mode: 0o600 });
    chmodSync(file, 0o600);
    for (const id of request.stayIds) recordSubmission(db, { stayId: id, kind, channel: SES_CHANNEL, status: "prepared", at, file });
    io.out(`Wrote ${file}: ${request.stayIds.length} communication${request.stayIds.length === 1 ? "" : "s"}.`);
  }
  io.out('It can be uploaded on the SES.HOSPEDAJES website ("Alta masiva"), or sent with "fairnight ospiti invia --ses". The file holds the guests\' data in clear: it is deleted with the stay\'s data.');
  return 0;
}

// ------------------------------------------------------------------ invia

interface Ready {
  o: OpenedStay;
  env: SesEnvironment;
  ses: NonNullable<GuestSettings["ses"]>;
}

export async function sendSes(db: Db, config: HostConfig, args: string[], values: SesOptions, io: Io, h: SesHelpers): Promise<number> {
  const kind = sesKind(h, values.tipo);
  const today = localDateTime(io.now()).slice(0, 10);
  let rows: StayRow[];
  if (args.length > 0) rows = [...new Set(args)].map((id) => h.stayOrFail(id));
  else {
    rows = listStays(db).filter((r) => {
      if (r.erased_at || r.cancelled_at) return false;
      const s = config.listings.find((l) => l.name === r.listing)?.fairguest;
      if (s?.country !== "ES" || !s.ses) return false;
      const last = lastSes(submissions(db, r.id), kind, channelOf(environmentOf(s, values.ambiente)));
      if (last && last.status !== "rejected") return false;
      return kind === "checkin" ? r.check_in <= today && today <= addDays(r.check_out, 1) : r.check_out >= today;
    });
  }
  if (rows.length === 0) {
    io.out(`Nothing to send to SES.HOSPEDAJES: no ${SES_KIND[kind]} still to communicate${kind === "checkin" ? " for arrivals up to today" : ""}.`);
    return 0;
  }
  const targets = rows.map((r) => {
    h.notErased(r);
    const s = spanish(h, r);
    const ses = needsSesBlock(r, s);
    const env = environmentOf(s, values.ambiente);
    const last = lastSes(submissions(db, r.id), kind, channelOf(env));
    if (last?.status === "sent") throw new SetupError(`Stay ${r.id}: the ${SES_KIND[kind]} sent on ${last.at.replace("T", " ")} (batch ${last.batch}) is waiting for its outcome: "fairnight ospiti esito --ses". Nothing was sent.`);
    if (last?.status === "accepted") throw new SetupError(`Stay ${r.id}: the ${SES_KIND[kind]} is already registered on SES.HOSPEDAJES (${env === "test" ? "test service" : "production"}). A change is a new communication: make it on the SES website.`);
    return { r, s, ses, env, last };
  });
  const key = await h.unlockedKey();
  const ready: Ready[] = [];
  let failures = 0;
  for (const t of targets) {
    const o = openStay(db, t.r, t.s, key, today);
    const p = problems(o, kind);
    if (p.length > 0) {
      failures++;
      io.out(`${t.r.id} (${t.r.listing}): not ready`);
      for (const x of p) io.out(`  - ${x}`);
      continue;
    }
    ready.push({ o, env: t.env, ses: t.ses });
    io.out(`${t.r.id} (${t.r.listing}): ${SES_KIND[kind]} ready, ${o.stay.guests.length} ${o.stay.guests.length === 1 ? "person" : "people"} → ${ENV_WORDS[t.env]}${t.last?.status === "rejected" ? `, again after the refusal of ${t.last.at.replace("T", " ")}` : ""}`);
  }
  if (!values.applica) {
    io.out(ready.length > 0 ? '"--applica" sends them, after a confirmation. Nothing was sent.' : "Nothing was sent.");
    return failures > 0 ? 1 : 0;
  }
  if (ready.length === 0) return 1;
  if (!io.prompt) throw new SetupError("Sending to SES.HOSPEDAJES needs a confirmation typed in a terminal. Nothing was sent.");
  const schema = sesSchemaOf(io);
  if (!schema) {
    io.out(SES_XSD_MISSING);
    return 1;
  }
  // One client per account and environment; the credentials are checked before asking for the confirmation.
  const groups = new Map<string, { env: SesEnvironment; account: string; landlord: string; items: Ready[] }>();
  for (const item of ready) {
    const id = `${item.env}#${item.ses.account}#${item.ses.landlord}`;
    const g = groups.get(id) ?? { env: item.env, account: item.ses.account, landlord: item.ses.landlord, items: [] };
    g.items.push(item);
    groups.set(id, g);
  }
  const clients = new Map<string, SesClient>();
  for (const g of groups.values()) {
    const c = loadSesCredentials(db, g.account, g.env, key);
    if (!c) {
      throw new SetupError(
        `No SES.HOSPEDAJES credentials for account "${g.account}" (${g.env === "test" ? "test service" : "production"}): "fairnight ospiti credenziali --ses --ambiente ${g.env === "test" ? "prova" : "produzione"}${g.account === DEFAULT_ALLOGGIATI_ACCOUNT ? "" : ` --account ${g.account}`}". Nothing was sent.`,
      );
    }
    clients.set(`${g.env}#${g.account}`, sesClient(io, g.env, c, schema));
  }
  const production = ready.filter((r) => r.env === "production").length;
  const question = `Send ${ready.length} ${SES_KIND[kind]} to SES.HOSPEDAJES${production > 0 ? `, ${production} of them in PRODUCTION (registered with the police)` : ", test service only"}? Type SEND to confirm: `;
  if ((await io.prompt(question, { hidden: false })).trim() !== "SEND") {
    io.out("Not confirmed: nothing was sent.");
    return 1;
  }
  const at = localDateTime(io.now());
  for (const g of groups.values()) {
    const client = clients.get(`${g.env}#${g.account}`) as SesClient;
    const channel = channelOf(g.env);
    for (const request of sesRequests(
      g.items.map((i) => i.o.stay),
      kind,
    )) {
      const ids = request.stayIds;
      const record = (status: "sent" | "rejected", batch: string | null, detail: (i: number) => string) =>
        ids.forEach((id, i) => recordSubmission(db, { stayId: id, kind, channel, status, at, batch, detail: detail(i) }));
      let answer;
      try {
        answer = await client.communicate(g.landlord, kind, sesPayload(sesXml(request, schema)));
      } catch (e) {
        failures += ids.length;
        if (e instanceof SesError) {
          record("rejected", null, () => e.message);
          io.out(`${ids.join(", ")}: ${e.message} Not registered; it can be sent again once the cause is fixed.`);
        } else {
          // The request may have arrived: nothing is recorded as refused, and the host checks first.
          io.out(
            `${ids.join(", ")}: no answer from SES.HOSPEDAJES (${(e as Error).message}). The communication may have arrived: check "Consulta de comunicaciones" on the SES website before sending again.`,
          );
        }
        continue;
      }
      if (answer.ok && answer.batch) {
        record("sent", answer.batch, (i) => `order ${i + 1}; ${answer.code} ${answer.description}`.trim());
        io.out(`${ids.join(", ")}: taken by SES.HOSPEDAJES (${g.env === "test" ? "test service" : "production"}), batch ${answer.batch}. The outcome: "fairnight ospiti esito --ses".`);
      } else {
        failures += ids.length;
        record("rejected", answer.batch, () => `${answer.code} ${answer.description}`.trim() || "no reason given");
        io.out(`${ids.join(", ")}: refused by SES.HOSPEDAJES: ${[answer.code, answer.description].filter(Boolean).join(" · ") || "no reason given"}. Fix it and send again.`);
      }
    }
  }
  return failures > 0 ? 1 : 0;
}

// ------------------------------------------------------------------ esito

/** Reads the outcome of every batch still waiting, and records it communication by communication. */
export async function sesOutcome(db: Db, config: HostConfig, values: SesOptions, io: Io, h: SesHelpers): Promise<number> {
  const waiting: { row: StayRow; sub: SubmissionRow; env: SesEnvironment; account: string }[] = [];
  for (const row of listStays(db)) {
    const s = config.listings.find((l) => l.name === row.listing)?.fairguest;
    if (s?.country !== "ES" || !s.ses) continue;
    const rows = submissions(db, row.id);
    for (const env of ["test", "production"] as const) {
      for (const kind of ["reservation", "checkin"] as const) {
        const last = lastSes(rows, kind, channelOf(env));
        if (last?.status === "sent" && last.batch) waiting.push({ row, sub: last, env, account: s.ses.account });
      }
    }
  }
  if (waiting.length === 0) {
    io.out("No SES.HOSPEDAJES batch is waiting for its outcome.");
    return 0;
  }
  const schema = sesSchemaOf(io);
  if (!schema) {
    io.out(SES_XSD_MISSING);
    return 1;
  }
  const key = await h.unlockedKey();
  const at = localDateTime(io.now());
  const batches = new Map<string, typeof waiting>();
  for (const w of waiting) batches.set(`${w.env}#${w.account}#${w.sub.batch}`, [...(batches.get(`${w.env}#${w.account}#${w.sub.batch}`) ?? []), w]);
  let problemsLeft = 0;
  for (const [id, group] of batches) {
    const [env, account, batch] = id.split("#") as [SesEnvironment, string, string];
    const c = loadSesCredentials(db, account, env, key);
    if (!c) {
      problemsLeft++;
      io.out(`No credentials for account "${account}" (${env}): batch ${batch} was not read.`);
      continue;
    }
    let result;
    try {
      result = await sesClient(io, env, c, schema).batch(batch);
    } catch (e) {
      problemsLeft++;
      io.out(`Batch ${batch}: could not be read now (${(e as Error).message}). Try again later.`);
      continue;
    }
    if (result.state === "pending" || result.state === "unknown") {
      io.out(`Batch ${batch}: still being processed by SES.HOSPEDAJES${result.description ? ` (${result.description})` : ""}. Try again in a few minutes.`);
      continue;
    }
    for (const w of group) {
      const order = Number(/order (\d+)/.exec(w.sub.detail ?? "")?.[1] ?? "0");
      const line = result.lines.find((l) => l.order === order);
      const kind = w.sub.kind as Kind;
      if (line?.ok) {
        recordSubmission(db, { stayId: w.row.id, kind, channel: channelOf(env), status: "accepted", at, batch, detail: `codigoComunicacion ${line.code}` });
        io.out(`${w.row.id}: ${SES_KIND[kind]} registered (${env === "test" ? "test service" : "production"}), code ${line.code}.`);
      } else if (line || result.state === "error") {
        problemsLeft++;
        const why = line?.error ?? ([result.code, result.description].filter(Boolean).join(" · ") || "refused");
        recordSubmission(db, { stayId: w.row.id, kind, channel: channelOf(env), status: "rejected", at, batch, detail: why });
        io.out(`${w.row.id}: ${SES_KIND[kind]} refused: ${why}. Correct it ("fairnight ospiti correggi") and send again.`);
      } else {
        problemsLeft++;
        io.out(`${w.row.id}: batch ${batch} says nothing about this communication. Check "Consulta de comunicaciones" on the SES website.`);
      }
    }
  }
  return problemsLeft > 0 ? 1 : 0;
}
