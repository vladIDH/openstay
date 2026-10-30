/**
 * explain_night on the nights of the daily cap: one held back, one confirmed.
 * The rows are the ones a run and the host's confirmation leave in the database.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../../fairnight-cli/src/db.js";
import { main } from "../../fairnight-cli/src/main.js";
import { confirmNights, saveHeld } from "../../fairnight-cli/src/pilota-conferme.js";
import { buildServer } from "../src/server.js";

const HELD = "2026-11-10";
const CONFIRMED = "2026-11-11";
const EXCEEDED = "2026-11-12";
const NOW = "2026-11-01T09:00:00";

let dir = "";
let client: Client;
const now = () => new Date(NOW);
const io = (cwd: string) => ({ cwd, out: () => {}, err: () => {}, now, fetch: async () => ({ ok: false, status: 500, text: async () => "" }) });

async function call(date: string) {
  const r = (await client.callTool({ name: "explain_night", arguments: { listing: "seaview-loft", date } })) as {
    content: { text: string }[];
    structuredContent: object;
  };
  return { text: r.content.map((c) => c.text).join("\n").replace(/\u00a0/g, " "), data: r.structuredContent };
}
const night = async (date: string) => (await call(date)).data as { price: number; held?: object; confirmation?: object };

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "fairnight-mcp-tetto-"));
  await main(["init"], io(dir));
  const file = path.join(dir, "fairnight.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.listings[0].pilot = { enabled: true };
  writeFileSync(file, JSON.stringify(config));

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildServer({ dir, now }).connect(serverSide);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("explain_night and the daily cap", () => {
  it("tells a night held back from a confirmed one", async () => {
    const { price } = await night(HELD);
    const at = new Date(NOW).toISOString();
    const db = openDb(path.join(dir, "data", "fairnight.db"));
    saveHeld(db, "seaview-loft", [HELD, EXCEEDED].map((date) => ({ date, calculated: price, sent: price - 18, maxChange: 15 })), at);
    confirmNights(db, "seaview-loft", [CONFIRMED], { by: "anna", via: "page" }, at, () => price);
    confirmNights(db, "seaview-loft", [EXCEEDED], { by: "anna", via: "command" }, at, () => price - 10);
    db.close();

    const held = await night(HELD);
    expect(held.held).toEqual({ calculated: price, sent: price - 18, difference: -18, maxChange: 15, at });
    expect(held.confirmation).toBeUndefined();

    expect((await call(HELD)).text).toContain(`Held back by the cap: €${price - 18} instead of €${price}`);

    const confirmed = await night(CONFIRMED);
    expect(confirmed.held).toBeUndefined();
    expect(confirmed.confirmation).toEqual({ by: "anna", via: "page", at, price, exceeded: false });

    expect((await call(CONFIRMED)).text).toContain(`Confirmed by anna on 2026-11-01 `);
    expect((await call(CONFIRMED)).text).toContain(`, up to €${price}.`);

    const exceeded = await night(EXCEEDED);
    expect(exceeded.held).toMatchObject({ calculated: price, sent: price - 18 });
    expect(exceeded.confirmation).toMatchObject({ price: price - 10, exceeded: true });
    expect((await call(EXCEEDED)).text).toContain(`Confirmed up to €${price - 10}, today the calculation says €${price}.`);
  });

  it("says nothing on a night the cap never touched", async () => {
    const other = await night("2026-11-13");
    expect(other.held).toBeUndefined();
    expect(other.confirmation).toBeUndefined();
    expect((await call("2026-11-13")).text).not.toContain("cap");
  });
});
