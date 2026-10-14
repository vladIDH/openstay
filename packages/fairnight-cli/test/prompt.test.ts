import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { terminalPrompt } from "../src/prompt.js";

/** A fake terminal: what is typed goes in, what is shown is collected. */
function terminal(tty: boolean) {
  const stdin = Object.assign(new PassThrough(), { isTTY: tty, rawModes: [] as boolean[] }) as unknown as NodeJS.ReadStream & { rawModes: boolean[] };
  (stdin as unknown as { setRawMode: (on: boolean) => void }).setRawMode = (on) => stdin.rawModes.push(on);
  let shown = "";
  const stdout = { write: (s: string) => ((shown += s), true) } as unknown as NodeJS.WriteStream;
  return { stdin, stdout, shown: () => shown };
}

describe("terminal prompt", () => {
  it("reads a hidden answer in raw mode and never shows it", async () => {
    const t = terminal(true);
    const answer = terminalPrompt(t.stdin, t.stdout)("Smoobu API secret: ", { hidden: true });
    t.stdin.write("s3cr");
    t.stdin.write("x\u007fet\r");
    expect(await answer).toBe("s3cret");
    expect(t.shown()).toBe("Smoobu API secret: \n");
    expect(t.stdin.rawModes).toEqual([true, false]);
  });

  it("works when the input is piped, and stops on Ctrl+C", async () => {
    const piped = terminal(false);
    const a = terminalPrompt(piped.stdin, piped.stdout)("Key: ", { hidden: true });
    piped.stdin.write("from-a-pipe\n");
    expect(await a).toBe("from-a-pipe");
    expect(piped.stdin.rawModes).toEqual([]);

    const t = terminal(true);
    const b = terminalPrompt(t.stdin, t.stdout)("Key: ", { hidden: true });
    t.stdin.write("ab\u0003");
    await expect(b).rejects.toThrow("Cancelled.");
    expect(t.stdin.rawModes).toEqual([true, false]);

    const ended = terminal(false);
    const c = terminalPrompt(ended.stdin, ended.stdout)("Key: ", { hidden: false });
    ended.stdin.end("partial");
    expect(await c).toBe("partial");
  });

  it("keeps the answers that arrive together for the next questions (answers piped in at once)", async () => {
    const t = terminal(false);
    const ask = terminalPrompt(t.stdin, t.stdout);
    t.stdin.write("Casa Limone\r\nAdeje\n\n90");
    t.stdin.end();
    expect(await ask("Nome: ", { hidden: false })).toBe("Casa Limone");
    expect(await ask("Città: ", { hidden: false })).toBe("Adeje");
    expect(await ask("Link: ", { hidden: false })).toBe("");
    expect(await ask("Prezzo: ", { hidden: false })).toBe("90");
    expect(await ask("Altro: ", { hidden: false })).toBe("");
    expect(t.shown()).toBe("Nome: \nCittà: \nLink: \nPrezzo: \nAltro: \n");
  });
});
