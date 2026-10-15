/**
 * `fairnight risposte …` (also `fairnight hello …`): the guest assistant
 * (Fairhello) from the command line. Every reply is approved by the host:
 * `invia` shows what would be sent and sends only with --applica.
 */
import { existsSync } from "node:fs";
import { DEFAULT_ANTHROPIC_MODEL, OLLAMA_URL, type Provider } from "fairhello";
import { addDays } from "fairguest";
import { loadHostConfig, SetupError } from "../config.js";
import { openDb } from "../db.js";
import { UsageError } from "../errors.js";
import { dbPath, localToday, type Io } from "../io.js";
import { guidedHouse } from "./casa.js";
import { readHouse } from "./drafts.js";
import { formatReadSummary, readAndDraft, sendDraft } from "./run.js";
import { anthropicKeySource, loadSettings, saveAnthropicKey, saveSettings, settingsPath } from "./settings.js";
import { conversation, discardDraft, flagsOf, getDraft, getStay, lastRun, openDrafts, textToSend, tokensSince } from "./store.js";
import { HELLO_WORDS } from "./texts.js";

export const HELLO_USAGE = `  fairnight risposte                               replies to approve, with their number (also: fairnight hello)
  fairnight risposte collega                       choose the model: Anthropic with your own key (asked, never shown) or Ollama on this computer
  fairnight risposte casa --listing <name>         write casa/<name>.md, what the assistant knows about the house, with a few questions
  fairnight risposte leggi                         read new guest messages from Smoobu and Beds24 and write drafts [--senza-bozze]
  fairnight risposte mostra <n>                    the conversation and the draft
  fairnight risposte invia <n>                     show what would be sent; sends only with --applica
  fairnight risposte scarta <n>                    throw a draft away
  fairnight risposte stato                         model, house files, last reading, tokens used in 30 days
  The page http://localhost:4321/risposte (fairnight serve) does the same with buttons.`;

export interface HelloOptions {
  listing?: string;
  applica?: boolean;
  "senza-bozze"?: boolean;
}

const short = (t: string, n = 90) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

function draftId(raw: string | undefined): number {
  if (raw === undefined) throw new UsageError('Which draft? Give its number (see "fairnight risposte").');
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`The draft number must be a whole number, got "${raw}"`);
  return n;
}

export async function runHello(dir: string, values: HelloOptions, rest: string[], io: Io): Promise<number> {
  const [sub, ...args] = rest;
  const extra = (n: number) => {
    if (args.length > n) throw new UsageError(`Unexpected argument "${args[n]}".`);
  };
  switch (sub) {
    case undefined:
    case "elenco":
    case "list":
      extra(0);
      return list(dir, io);
    case "collega":
    case "connect":
      extra(0);
      return connect(dir, io);
    case "casa":
    case "house":
      extra(0);
      return guidedHouse(dir, io, values.listing);
    case "leggi":
    case "read": {
      extra(0);
      const summary = await readAndDraft(dir, io, { drafts: !(values["senza-bozze"] ?? false) });
      for (const line of formatReadSummary(summary)) io.out(line);
      if (summary.drafts?.written) io.out('See them with "fairnight risposte", or on the page /risposte of "fairnight serve".');
      return summary.reads.some((r) => r.error) || summary.drafts?.stopped ? 1 : 0;
    }
    case "mostra":
    case "show":
      extra(1);
      return show(dir, io, draftId(args[0]));
    case "invia":
    case "send":
      extra(1);
      return send(dir, io, draftId(args[0]), values.applica ?? false);
    case "scarta":
    case "discard": {
      extra(1);
      const id = draftId(args[0]);
      const db = openDb(dbPath(dir));
      try {
        if (!discardDraft(db, id, io.now())) throw new SetupError(`Draft ${id} cannot be discarded: it does not exist, or it was already sent or discarded.`);
      } finally {
        db.close();
      }
      io.out(`Draft ${id} discarded.`);
      return 0;
    }
    case "stato":
    case "status":
      extra(0);
      return status(dir, io);
    default:
      throw new UsageError(`Unknown command "risposte ${sub}". Use collega, casa, leggi, mostra, invia, scarta or stato.`);
  }
}

function list(dir: string, io: Io): number {
  const config = loadHostConfig(dir);
  const w = HELLO_WORDS.en;
  const db = openDb(dbPath(dir));
  try {
    const all = openDrafts(db, localToday(io.now()));
    const ready = all.filter((v) => v.freshness.sendable);
    if (ready.length === 0) io.out("No replies to approve.");
    for (const { draft, stay } of ready) {
      const flags = flagsOf(draft);
      const title = config.listings.find((l) => l.name === stay.listing)?.pricing.name ?? stay.listing;
      io.out(
        `#${draft.id}  ${title}, ${stay.check_in} → ${stay.check_out}${draft.language ? `, ${draft.language}` : ""}` +
          (flags.length ? `  [${flags.map((f) => w.flags[f]).join(", ")}]` : "") +
          (draft.status === "failed" ? "  [last attempt failed]" : ""),
      );
      io.out(`     ${short(textToSend(draft))}`);
    }
    const stale = all.length - ready.length;
    if (stale > 0) io.out(`${stale} outdated draft${stale === 1 ? "" : "s"} (the guest wrote again, or you already answered): they are not sent.`);
    return 0;
  } finally {
    db.close();
  }
}

function show(dir: string, io: Io, id: number): number {
  const w = HELLO_WORDS.en;
  const db = openDb(dbPath(dir));
  try {
    const d = getDraft(db, id);
    const stay = d ? getStay(db, d.stay_id) : null;
    if (!d || !stay) throw new SetupError(`No draft ${id}.`);
    io.out(`Stay ${stay.id} (${stay.listing}), ${stay.check_in} → ${stay.check_out}${stay.channel ? `, ${stay.channel}` : ""}${stay.language ? `, language ${stay.language}` : ""}`);
    io.out("");
    for (const m of conversation(db, stay.id).slice(-10)) io.out(`${m.sender === "guest" ? "GUEST" : m.sender === "host" ? "YOU  " : "CHANNEL"}: ${m.text.replace(/\n/g, "\n       ")}`);
    io.out("");
    io.out(`Draft #${d.id} (${d.status}${d.edited_text !== null ? ", changed by you" : ""}):`);
    io.out(textToSend(d));
    const flags = flagsOf(d);
    if (flags.length) io.out(`Look at: ${flags.map((f) => w.flags[f]).join(", ")}`);
    if (d.note) io.out(`Assistant's note: ${d.note}`);
    if (d.error) io.out(`Last attempt failed: ${d.error}`);
    const f = (() => {
      const all = openDrafts(db, localToday(io.now())).find((v) => v.draft.id === id);
      return all?.freshness ?? null;
    })();
    if (f && !f.sendable) io.out(`Cannot be sent: ${w.reasons[f.reason]}.`);
    return 0;
  } finally {
    db.close();
  }
}

async function send(dir: string, io: Io, id: number, apply: boolean): Promise<number> {
  const w = HELLO_WORDS.en;
  if (!apply) {
    const db = openDb(dbPath(dir));
    try {
      const d = getDraft(db, id);
      if (!d) throw new SetupError(`No draft ${id}.`);
      io.out(`This would be sent to the guest of ${d.stay_id}:`);
      io.out(textToSend(d));
      io.out('Nothing was sent. To send it: "fairnight risposte invia ' + id + ' --applica".');
      return 0;
    } finally {
      db.close();
    }
  }
  const outcome = await sendDraft(dir, io, id);
  if (outcome.ok) {
    io.out(`Draft ${id} sent.`);
    return 0;
  }
  io.err(`Draft ${id} not sent: ${w.reasons[outcome.reason]}${outcome.detail ? `. ${outcome.detail}` : ""}.`);
  return 1;
}

async function connect(dir: string, io: Io): Promise<number> {
  if (!io.prompt) throw new SetupError('Choosing the model needs a terminal. Or write fairhello.json by hand (see "fairnight risposte stato").');
  const current = loadSettings(dir);
  io.out("Which model writes the drafts?");
  io.out("  1. Anthropic (Claude Haiku), with your own API key: about a cent a month for a house. Messages go to Anthropic.");
  io.out("  2. Ollama, a model on this computer: free, nothing leaves the computer, needs a recent computer.");
  const choice = (await io.prompt(`Choose 1 or 2 [${current.provider === "ollama" ? "2" : "1"}]: `, { hidden: false })).trim();
  if (!["", "1", "2"].includes(choice)) throw new UsageError("Choose 1 or 2.");
  const provider: Provider = choice === "2" ? "ollama" : choice === "1" ? "anthropic" : current.provider;
  const signature = (await io.prompt(`How do you sign your replies? [${current.signature ?? "no signature"}]: `, { hidden: false })).trim();
  const next = { ...current, provider, signature: signature || current.signature };
  if (provider === "anthropic") {
    next.model = current.provider === "anthropic" ? current.model : DEFAULT_ANTHROPIC_MODEL;
    if (anthropicKeySource(dir, io.env ?? {}) === "environment") io.out("Using the key in ANTHROPIC_API_KEY.");
    else {
      const key = (await io.prompt("Anthropic API key (console.anthropic.com → API keys; nothing is shown while you type): ", { hidden: true })).trim();
      if (!key) throw new SetupError("No key given: nothing was changed.");
      const where = saveAnthropicKey(dir, key);
      io.out(`Key saved in fairhello-credentials.json, ${where}. Never share that file.`);
    }
  } else {
    const model = (await io.prompt(`Ollama model, as pulled with "ollama pull" [${current.provider === "ollama" ? current.model : "qwen3:8b"}]: `, { hidden: false })).trim();
    next.model = model || (current.provider === "ollama" ? current.model : "qwen3:8b");
    next.ollamaUrl = current.ollamaUrl || OLLAMA_URL;
  }
  saveSettings(dir, next);
  io.out(`Saved ${settingsPath(dir)}: ${next.provider}, model ${next.model}.`);
  io.out('Next: "fairnight risposte casa --listing <name>" for each house, then "fairnight risposte leggi".');
  return 0;
}

function status(dir: string, io: Io): number {
  const config = loadHostConfig(dir);
  const s = loadSettings(dir);
  io.out(`Model: ${s.provider}, ${s.model}${s.provider === "ollama" ? ` at ${s.ollamaUrl}` : ""}${existsSync(settingsPath(dir)) ? "" : " (default: no fairhello.json yet)"}`);
  if (s.provider === "anthropic") {
    const src = anthropicKeySource(dir, io.env ?? {});
    io.out(`Anthropic key: ${src === "environment" ? "from ANTHROPIC_API_KEY" : src === "file" ? "saved in fairhello-credentials.json" : 'none yet ("fairnight risposte collega")'}`);
  }
  io.out(`Signature: ${s.signature ?? "none"} · messages erased ${s.retentionDays} days after check-out · at most ${s.maxDraftsPerRun} drafts per reading`);
  for (const l of config.listings) {
    const house = readHouse(dir, l.name);
    const prices = house?.warnings.filter((x) => x.kind === "prices") ?? [];
    io.out(
      `  ${l.name}: ` +
        (house === null
          ? `no casa/${l.name}.md (no drafts for this listing)`
          : `casa/${l.name}.md, ${house.sections.length} sections${house.codes ? ", access codes" : ""}` + (prices.length ? `, prices in ${prices.map((p) => `"${"heading" in p ? p.heading : ""}"`).join(", ")} (take them out)` : "")),
    );
  }
  const db = openDb(dbPath(dir));
  try {
    const run = lastRun(db);
    io.out(`Last reading: ${run ? `${run.at.replace("T", " ")}${run.error ? ` (problem: ${run.error})` : ""}` : "never"}`);
    const t = tokensSince(db, `${addDays(localToday(io.now()), -30)}T00:00`);
    io.out(`Last 30 days: ${t.drafts} drafts, ${t.input} tokens in, ${t.output} out, ${t.cached} read from cache.`);
  } finally {
    db.close();
  }
  return 0;
}
