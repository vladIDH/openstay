import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { FetchLike, Io } from "../src/io.js";

const made: string[] = [];

/** A fresh empty folder, deleted after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fairnight-test-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export type FakeAnswer = string | { status: number } | Error;

/**
 * A fake network: answers only the URLs it was given, records every request,
 * and fails the test (by throwing) if anything else is requested.
 */
export function fakeFetch(answers: Record<string, FakeAnswer>): FetchLike & { calls: string[]; set(url: string, a: FakeAnswer): void } {
  const table = new Map(Object.entries(answers));
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const answer = table.get(url);
    if (answer === undefined) throw new Error(`unexpected request to ${url}`);
    if (answer instanceof Error) throw answer;
    if (typeof answer === "string") return { ok: true, status: 200, text: async () => answer };
    return { ok: answer.status < 400, status: answer.status, text: async () => "" };
  }) as FetchLike & { calls: string[]; set(url: string, a: FakeAnswer): void };
  fn.calls = calls;
  fn.set = (url, a) => table.set(url, a);
  return fn;
}

export interface TestIo extends Io {
  lines: string[];
  errors: string[];
  setNow(iso: string): void;
}

export function testIo(cwd: string, fetch: FetchLike = fakeFetch({}), now = "2026-11-01T09:00:00Z"): TestIo {
  let current = new Date(now);
  const io: TestIo = {
    cwd,
    lines: [],
    errors: [],
    out: (l) => io.lines.push(...l.split("\n")),
    err: (l) => io.errors.push(...l.split("\n")),
    fetch,
    now: () => current,
    setNow: (iso) => {
      current = new Date(iso);
    },
  };
  return io;
}
