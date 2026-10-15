/**
 * get_guest_replies: the drafts waiting for the host, read only, texts only when asked.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { openDb } from "../../fairnight-cli/src/db.js";
import { main } from "../../fairnight-cli/src/main.js";
import { buildServer } from "../src/server.js";

const now = () => new Date("2026-11-01T09:00:00");
const io = (cwd: string) => ({ cwd, out: () => {}, err: () => {}, now, fetch: async () => ({ ok: false, status: 404, text: async () => "" }) });
const hash = (dir: string) => createHash("sha256").update(readFileSync(path.join(dir, "data", "fairnight.db"))).digest("hex");

async function call(dir: string, args: Record<string, unknown> = {}) {
  const [c, srv] = InMemoryTransport.createLinkedPair();
  await buildServer({ dir, now }).connect(srv);
  const cl = new Client({ name: "test", version: "1.0.0" });
  await cl.connect(c);
  const r = await cl.callTool({ name: "get_guest_replies", arguments: args });
  await cl.close();
  return { text: (r.content as { text: string }[])[0]?.text ?? "", data: r.structuredContent as Record<string, unknown> };
}

describe("replies to guests (Fairhello)", () => {
  it("lists the drafts waiting, texts only when asked, without writing", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-hello-"));
    try {
      await main(["init"], io(dir));
      const db = openDb(path.join(dir, "data", "fairnight.db"));
      db.prepare(
        "INSERT INTO hello_stays (id, listing, source, booking_id, check_in, check_out, language, channel, guests, seen_at) VALUES ('smoobu:1', 'seaview-loft', 'smoobu', 1, '2026-11-04', '2026-11-08', 'de', 'Airbnb', 2, '2026-11-01T08:00')",
      ).run();
      db.prepare("INSERT INTO hello_messages (stay_id, id, seq, sender, text, seen_at) VALUES ('smoobu:1', '5', 5, 'guest', 'Can we pay less?', '2026-11-01T08:00')").run();
      db.prepare(
        "INSERT INTO hello_drafts (stay_id, message_id, text, language, needs_host, flags, model, status, created_at) VALUES ('smoobu:1', '5', 'The host will answer you.', 'en', 1, ?, 'anthropic:claude-haiku-5-5', 'waiting', '2026-11-01T08:01')",
      ).run(JSON.stringify(["money"]));
      db.close();
      const before = hash(dir);

      const r = await call(dir);
      expect(r.text).toBe("Today 2026-11-01. 1 reply waiting for approval, 0 outdated.\n- #1 seaview-loft 2026-11-04 → 2026-11-08, en: waiting for approval, look at: money");
      expect(JSON.stringify(r.data)).not.toContain("pay less");

      const withText = await call(dir, { includeText: true });
      expect(withText.text).toContain("guest: Can we pay less?\n  draft: The host will answer you.");
      expect(hash(dir)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
