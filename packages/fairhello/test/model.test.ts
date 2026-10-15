import { describe, expect, it } from "vitest";
import { anthropicRequest, DEFAULT_ANTHROPIC_MODEL, ModelError, ollamaRequest, readAnthropic, readOllama } from "../src/index.js";

const prompt = { system: "RULES", user: "MESSAGE" };
const DRAFT = { language: "it", reply: "Ciao!", needsHost: false, note: "" };

describe("Anthropic", () => {
  it("builds a request with the key only in its header, the system part cached and a JSON schema", () => {
    const r = anthropicRequest(prompt, { apiKey: "test-key-not-real" });
    expect(r.url).toBe("https://api.anthropic.com/v1/messages");
    expect(r.headers).toEqual({ "content-type": "application/json", "x-api-key": "test-key-not-real", "anthropic-version": "2023-06-01" });
    const body = JSON.parse(r.body);
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(body.system).toEqual([{ type: "text", text: "RULES", cache_control: { type: "ephemeral" } }]);
    expect(body.messages).toEqual([{ role: "user", content: "MESSAGE" }]);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.effort).toBe("low");
    expect(r.body).not.toContain("test-key-not-real");
    expect(anthropicRequest(prompt, { apiKey: "k", model: "claude-sonnet-5-5", baseUrl: "http://127.0.0.1:9/" }).url).toBe("http://127.0.0.1:9/v1/messages");
  });

  it("reads the draft and the tokens, after a thinking block", () => {
    const answer = readAnthropic(
      200,
      JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(DRAFT) }],
        usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
      }),
    );
    expect(answer).toEqual({ draft: DRAFT, usage: { input: 120, output: 40, cacheRead: 900, cacheWrite: 0 } });
  });

  it("explains errors in plain words and says which ones are worth retrying", () => {
    const err = (status: number, body = "") => {
      try {
        readAnthropic(status, body);
      } catch (e) {
        return e as ModelError;
      }
      throw new Error("no error");
    };
    expect(err(401, JSON.stringify({ error: { message: "invalid x-api-key" } })).message).toContain('Anthropic says: "invalid x-api-key"');
    expect(err(401).retry).toBe(false);
    expect(err(401).fatal).toBe(true);
    expect(err(429).fatal).toBe(false);
    expect(err(429).retry).toBe(true);
    expect(err(529).retry).toBe(true);
    expect(err(400).retry).toBe(false);
    expect(err(418).message).toBe("Anthropic answered 418.");
    expect(err(200, "nope").message).toContain("not JSON");
    expect(err(200, JSON.stringify({ stop_reason: "refusal", content: [] })).retry).toBe(false);
    expect(err(200, JSON.stringify({ stop_reason: "max_tokens", content: [] })).message).toContain("cut off");
    expect(err(200, JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "Ciao" }] })).message).toContain("did not answer with JSON");
  });
});

describe("Ollama", () => {
  it("builds a local request with the same schema", () => {
    const r = ollamaRequest(prompt, { model: "qwen3:8b" });
    expect(r.url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({ model: "qwen3:8b", stream: false, messages: [{ role: "system", content: "RULES" }, { role: "user", content: "MESSAGE" }] });
    expect(body.format.required).toContain("reply");
  });

  it("reads the answer and explains a missing model", () => {
    expect(readOllama(200, JSON.stringify({ message: { content: JSON.stringify(DRAFT) }, prompt_eval_count: 300, eval_count: 50 }), "m")).toEqual({
      draft: DRAFT,
      usage: { input: 300, output: 50, cacheRead: 0, cacheWrite: 0 },
    });
    expect(() => readOllama(404, "", "qwen3:8b")).toThrow('ollama pull qwen3:8b');
    try {
      readOllama(404, "", "m");
    } catch (e) {
      expect((e as { fatal: boolean }).fatal).toBe(true);
    }
    expect(() => readOllama(500, "", "m")).toThrow("ollama serve");
    expect(() => readOllama(200, "{", "m")).toThrow("not JSON");
  });
});
