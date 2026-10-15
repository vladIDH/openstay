/**
 * The guest assistant's settings and key, in the host's folder.
 *
 * fairhello.json (written by `fairnight risposte collega`, can be edited):
 *   {
 *     "provider": "anthropic",           // or "ollama": a model on this computer
 *     "model": "claude-haiku-5-5",       // for Ollama, the model pulled (e.g. "qwen3:8b")
 *     "ollamaUrl": "http://127.0.0.1:11434",
 *     "signature": "Marta",              // how the replies are signed
 *     "retentionDays": 60,               // messages erased this many days after check-out
 *     "maxDraftsPerRun": 20              // drafts written per reading, at most
 *   }
 *
 * The Anthropic key: the environment variable ANTHROPIC_API_KEY, or
 * fairhello-credentials.json (readable only by the user where the system
 * allows it). Sent only to Anthropic, never printed, not even shortened.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ANTHROPIC_MODEL, OLLAMA_URL, PROVIDERS, type Provider } from "fairhello";
import { SetupError } from "../config.js";
import { writePrivateFile } from "../credentials.js";
import { stripBom } from "../io.js";

export const SETTINGS_FILE = "fairhello.json";
export const HELLO_CREDENTIALS_FILE = "fairhello-credentials.json";
export const HOUSE_DIR = "casa";

export interface HelloSettings {
  provider: Provider;
  model: string;
  ollamaUrl: string;
  signature: string | null;
  retentionDays: number;
  maxDraftsPerRun: number;
}

export const DEFAULT_SETTINGS: HelloSettings = {
  provider: "anthropic",
  model: DEFAULT_ANTHROPIC_MODEL,
  ollamaUrl: OLLAMA_URL,
  signature: null,
  retentionDays: 60,
  maxDraftsPerRun: 20,
};

const FIELDS = ["provider", "model", "ollamaUrl", "signature", "retentionDays", "maxDraftsPerRun"];

export const settingsPath = (dir: string) => path.join(dir, SETTINGS_FILE);
export const housePath = (dir: string, listing: string) => path.join(dir, HOUSE_DIR, `${listing}.md`);

/** The settings, or the defaults when the file does not exist yet. */
export function loadSettings(dir: string): HelloSettings {
  const file = settingsPath(dir);
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch (e) {
    throw new SetupError(`${SETTINGS_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new SetupError(`${SETTINGS_FILE} must be a JSON object.`);
  const o = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(o)) if (!FIELDS.includes(k)) problems.push(`unknown field "${k}" (allowed: ${FIELDS.join(", ")})`);
  const provider = o.provider ?? DEFAULT_SETTINGS.provider;
  if (!(PROVIDERS as readonly unknown[]).includes(provider)) problems.push(`provider must be ${PROVIDERS.join(" or ")}`);
  const model = o.model ?? (provider === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : undefined);
  if (typeof model !== "string" || model.trim() === "") problems.push(provider === "ollama" ? 'model must name the Ollama model, like "qwen3:8b"' : "model must be a model name");
  const ollamaUrl = o.ollamaUrl ?? OLLAMA_URL;
  if (typeof ollamaUrl !== "string" || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(ollamaUrl)) {
    problems.push("ollamaUrl must be on this computer, like http://127.0.0.1:11434");
  }
  const signature = o.signature ?? null;
  if (signature !== null && (typeof signature !== "string" || signature.length > 200)) problems.push("signature must be a short text");
  const whole = (v: unknown, fallback: number, min: number, max: number, name: string) => {
    const n = v ?? fallback;
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return n;
  };
  const retentionDays = whole(o.retentionDays, DEFAULT_SETTINGS.retentionDays, 3, 3650, "retentionDays");
  const maxDraftsPerRun = whole(o.maxDraftsPerRun, DEFAULT_SETTINGS.maxDraftsPerRun, 1, 500, "maxDraftsPerRun");
  if (problems.length > 0) throw new SetupError(`${SETTINGS_FILE}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return {
    provider: provider as Provider,
    model: (model as string).trim(),
    ollamaUrl: ollamaUrl as string,
    signature: typeof signature === "string" && signature.trim() !== "" ? signature.trim() : null,
    retentionDays,
    maxDraftsPerRun,
  };
}

export function saveSettings(dir: string, s: HelloSettings): void {
  const out: Record<string, unknown> = { provider: s.provider, model: s.model };
  if (s.provider === "ollama" || s.ollamaUrl !== OLLAMA_URL) out.ollamaUrl = s.ollamaUrl;
  if (s.signature) out.signature = s.signature;
  out.retentionDays = s.retentionDays;
  out.maxDraftsPerRun = s.maxDraftsPerRun;
  writeFileSync(settingsPath(dir), JSON.stringify(out, null, 2) + "\n", "utf8");
}

export type KeySource = "environment" | "file";

export function anthropicKeySource(dir: string, env: Record<string, string | undefined> = {}): KeySource | null {
  if (env.ANTHROPIC_API_KEY?.trim()) return "environment";
  return existsSync(path.join(dir, HELLO_CREDENTIALS_FILE)) ? "file" : null;
}

export function loadAnthropicKey(dir: string, env: Record<string, string | undefined> = {}): string {
  const fromEnv = env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dir, HELLO_CREDENTIALS_FILE);
  if (!existsSync(file)) throw new SetupError('No Anthropic key yet: run "fairnight risposte collega" (or set ANTHROPIC_API_KEY).');
  let parsed: { anthropicApiKey?: unknown };
  try {
    parsed = JSON.parse(stripBom(readFileSync(file, "utf8")));
  } catch {
    throw new SetupError(`${HELLO_CREDENTIALS_FILE} cannot be read: run "fairnight risposte collega" again.`);
  }
  if (typeof parsed.anthropicApiKey !== "string" || parsed.anthropicApiKey === "") {
    throw new SetupError(`${HELLO_CREDENTIALS_FILE} is incomplete: run "fairnight risposte collega" again.`);
  }
  return parsed.anthropicApiKey;
}

export function saveAnthropicKey(dir: string, apiKey: string, platform: NodeJS.Platform = process.platform): string {
  return writePrivateFile(path.join(dir, HELLO_CREDENTIALS_FILE), { anthropicApiKey: apiKey }, platform);
}
