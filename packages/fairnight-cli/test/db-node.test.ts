import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SetupError } from "../src/config.js";
import { openDb } from "../src/db.js";
import { tempDir } from "./helpers.js";

// better-sqlite3 built for another Node.js: what happens after the host updates Node to a new major version.
vi.mock("better-sqlite3", () => ({
  default: class {
    constructor() {
      throw Object.assign(new Error("was compiled against a different Node.js version"), { code: "ERR_DLOPEN_FAILED" });
    }
  },
}));

describe("database after a Node.js update", () => {
  it("tells the host to run the installer again instead of showing a stack trace", () => {
    const file = path.join(tempDir(), "data", "fairnight.db");
    expect(() => openDb(file)).toThrow(SetupError);
    expect(() => openDb(file)).toThrow(/rilancia «Installa Fairnight» per adattarlo/);
  });
});
