/**
 * `fairnight apri`: what the Fairnight icon on the desktop runs. Reads the
 * calendars, starts the calendar page and opens it in the browser, with
 * messages in Italian for hosts who never use a terminal.
 *
 * - No config yet: runs the guided setup first.
 * - Fairnight already running for this folder: only opens the browser again.
 * - Port taken by something else: tries the next ones (4321 … 4330).
 * The page listens on this computer only (127.0.0.1), as `fairnight serve` does.
 */
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { configura, feedLineIt } from "./configura.js";
import { loadHostConfig, SetupError } from "./config.js";
import { openDb } from "./db.js";
import { configPath, dbPath, type Io } from "./io.js";
import { folderId, startServer } from "./serve.js";
import { syncEverything } from "./sync-all.js";

export interface ApriOptions {
  /** First port to try; the next nine are tried when it is taken. */
  port: number;
  days: number;
  /** Open the browser (default). Off for tests and automated checks. */
  browser: boolean;
}

/** Is Fairnight already answering on this port, and for which folder? */
async function whoIsOn(port: number, folder: string, io: Io): Promise<"this-folder" | "something-else" | "free"> {
  try {
    const res = await io.fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return "something-else";
    const body = JSON.parse(await res.text()) as { app?: unknown; folder?: unknown };
    return body.app === "fairnight" && body.folder === folder ? "this-folder" : "something-else";
  } catch (e) {
    // Nothing listening: the connection is refused. Anything else answering garbage counts as taken.
    return e instanceof SyntaxError ? "something-else" : "free";
  }
}

/** The exit code, and the server when this call started one (tests close it). */
export interface ApriResult {
  code: number;
  server?: Server;
}

export async function apri(dir: string, io: Io, opts: ApriOptions): Promise<ApriResult> {
  if (!existsSync(configPath(dir))) {
    io.out("Fairnight non è ancora configurato: bastano poche domande.");
    io.out("");
    const code = await configura(dir, io);
    if (code !== 0) return { code };
    io.out("");
  }
  const config = loadHostConfig(dir);
  const folder = folderId(dir);

  for (let port = opts.port; port < opts.port + 10; port++) {
    const state = await whoIsOn(port, folder, io);
    if (state === "something-else") continue;
    const url = `http://localhost:${port}`;
    if (state === "this-folder") {
      io.out(`Fairnight è già acceso: ${url}`);
      if (opts.browser) {
        io.openUrl?.(url);
        io.out("Ho aperto di nuovo il calendario nel browser. Questa finestra si può chiudere.");
      }
      return { code: 0 };
    }

    io.out("Leggo i calendari…");
    const titles = new Map(config.listings.map((l) => [l.name, l.pricing.name ?? l.name]));
    const db = openDb(dbPath(dir));
    try {
      const { reports } = await syncEverything(db, dir, config.listings, io);
      for (const r of reports) io.out(feedLineIt(r, titles));
      if (reports.length === 0) io.out("  Nessun calendario collegato: aggiungi i link con «Cambia impostazioni».");
    } finally {
      db.close();
    }

    let server: Server;
    try {
      server = await startServer({ dir, io, days: opts.days, port, lan: false, quiet: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw e;
    }
    io.out("");
    io.out(`Fairnight è acceso: ${url}`);
    if (opts.browser) {
      io.openUrl?.(url);
      io.out("Il calendario si apre nel browser. Se non lo vedi, copia l'indirizzo qui sopra nella barra del browser.");
    }
    io.out("Lascia aperta questa finestra mentre usi il calendario: quando la chiudi, Fairnight si spegne.");
    return { code: 0, server }; // the open server keeps the process running
  }
  throw new SetupError(`Le porte da ${opts.port} a ${opts.port + 9} sono tutte occupate: chiudi qualche programma e riprova.`);
}
