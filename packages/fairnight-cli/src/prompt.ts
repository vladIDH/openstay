/**
 * Ask a question on the terminal. With hidden, nothing typed is echoed (for
 * the Smoobu key and secret): they never end up on screen or in the shell
 * history, because they are never passed as arguments.
 *
 * Input that arrives after the end of an answer (several answers piped in at
 * once) is kept for the next question instead of being lost.
 */
export function terminalPrompt(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): (question: string, options: { hidden: boolean }) => Promise<string> {
  let pending = "";
  let ended = false;
  return (question, { hidden }) =>
    new Promise((resolve, reject) => {
      stdout.write(question);
      const raw = hidden && stdin.isTTY;
      let answer = "";
      let finished = false;
      let rawOn = false;
      const done = (error?: Error) => {
        finished = true;
        stdin.off("data", onData);
        stdin.off("end", onEnd);
        if (rawOn) stdin.setRawMode(false);
        stdin.pause();
        // A terminal echoing what is typed has already moved to the next line with the Enter key.
        if (!(stdin.isTTY && !hidden)) stdout.write("\n");
        if (error) reject(error);
        else resolve(answer);
      };
      const onEnd = () => {
        ended = true;
        done();
      };
      const onData = (chunk: string) => {
        for (let i = 0; i < chunk.length; i++) {
          const ch = chunk[i] as string;
          if (ch === "\u0003") return done(new Error("Cancelled.")); // Ctrl+C
          if (ch === "\r" || ch === "\n") {
            // "\r\n" from a Windows pipe or console is one line end, not two.
            const next = ch === "\r" && chunk[i + 1] === "\n" ? i + 2 : i + 1;
            pending = chunk.slice(next);
            return done();
          }
          if (ch === "\u007f" || ch === "\b") answer = answer.slice(0, -1);
          else answer += ch;
        }
      };
      const leftover = pending;
      pending = "";
      if (leftover !== "") {
        onData(leftover);
        if (finished) return;
      }
      // The input may have ended while no question was waiting for it.
      if (ended || stdin.readableEnded) return done();
      if (raw) {
        stdin.setRawMode(true);
        rawOn = true;
      }
      stdin.setEncoding("utf8");
      stdin.on("data", onData);
      stdin.on("end", onEnd);
      stdin.resume();
    });
}
