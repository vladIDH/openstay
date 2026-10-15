/**
 * The model that writes the drafts, with the host's own key or on the host's
 * own computer. Only the shape of the requests and of the answers lives here:
 * sending them is the caller's job, so this package never touches the network.
 *
 * - Anthropic (default): the Messages API, model claude-haiku-5-5, low effort,
 *   JSON schema output. The system part (rules + house file) is marked for
 *   caching. The key goes in the "x-api-key" header and nowhere else.
 * - Ollama: a model running on this computer (http://127.0.0.1:11434), with
 *   the same JSON schema. Nothing leaves the computer.
 */
import { DRAFT_SCHEMA, parseModelDraft, type ModelDraft, type Prompt } from "./prompt.js";

export const PROVIDERS = ["anthropic", "ollama"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export const OLLAMA_URL = "http://127.0.0.1:11434";

export class ModelError extends Error {
  constructor(
    message: string,
    /** False when trying again later will not help (wrong key, refusal). */
    readonly retry: boolean,
    /** True when every other request would fail the same way (wrong key, model missing, no connection): stop. */
    readonly fatal = false,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelAnswer {
  draft: ModelDraft;
  usage: Usage;
}

export function anthropicRequest(prompt: Prompt, options: { apiKey: string; model?: string; baseUrl?: string }): ModelRequest {
  const body = {
    model: options.model ?? DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt.user }],
    output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
  };
  return {
    url: options.baseUrl ? `${options.baseUrl.replace(/\/+$/, "")}/v1/messages` : ANTHROPIC_URL,
    headers: { "content-type": "application/json", "x-api-key": options.apiKey, "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify(body),
  };
}

function errorText(text: string): string | null {
  try {
    const b = JSON.parse(text) as { error?: { message?: unknown } };
    return typeof b.error?.message === "string" ? b.error.message : null;
  } catch {
    return null;
  }
}

/** Anthropic's answer (status and body) → the draft, or a ModelError in plain words. */
export function readAnthropic(status: number, text: string): ModelAnswer {
  if (status !== 200) {
    const said = errorText(text);
    const tail = said ? ` Anthropic says: "${said}".` : "";
    if (status === 401) throw new ModelError(`Anthropic refused the key (401).${tail} Save it again with "fairnight risposte collega".`, false, true);
    if (status === 403) throw new ModelError(`Anthropic does not allow this request (403).${tail}`, false, true);
    if (status === 400) throw new ModelError(`Anthropic did not accept the request (400).${tail}`, false);
    if (status === 429 || status === 529 || status >= 500) throw new ModelError(`Anthropic is busy (${status}).${tail} Try again in a few minutes.`, true);
    throw new ModelError(`Anthropic answered ${status}.${tail}`, false);
  }
  let b: {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  try {
    b = JSON.parse(text);
  } catch {
    throw new ModelError("Anthropic sent an answer that is not JSON.", true);
  }
  if (b.stop_reason === "refusal") throw new ModelError("The model declined to write this draft: answer this guest yourself.", false);
  if (b.stop_reason === "max_tokens") throw new ModelError("The model's answer was cut off: answer this guest yourself, or try again.", true);
  const out = (b.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const u = b.usage ?? {};
  return {
    draft: parseModelDraftOrFail(out),
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
  };
}

export function ollamaRequest(prompt: Prompt, options: { model: string; baseUrl?: string }): ModelRequest {
  const body = {
    model: options.model,
    stream: false,
    format: DRAFT_SCHEMA,
    options: { temperature: 0.3 },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  };
  return {
    url: `${(options.baseUrl ?? OLLAMA_URL).replace(/\/+$/, "")}/api/chat`,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function readOllama(status: number, text: string, model: string): ModelAnswer {
  if (status === 404) throw new ModelError(`Ollama does not have the model "${model}": run "ollama pull ${model}" first.`, false, true);
  if (status !== 200) throw new ModelError(`Ollama answered ${status}. Is it running ("ollama serve")?`, true);
  let b: { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  try {
    b = JSON.parse(text);
  } catch {
    throw new ModelError("Ollama sent an answer that is not JSON.", true);
  }
  return {
    draft: parseModelDraftOrFail(b.message?.content ?? ""),
    usage: { input: b.prompt_eval_count ?? 0, output: b.eval_count ?? 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function parseModelDraftOrFail(text: string): ModelDraft {
  try {
    return parseModelDraft(text);
  } catch (e) {
    throw new ModelError(`${(e as Error).message}: answer this guest yourself, or try again.`, true);
  }
}
