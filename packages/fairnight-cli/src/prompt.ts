/**
 * Ask a question on the terminal. With hidden, nothing typed is echoed (for
 * the Smoobu key and secret): they never end up on screen or in the shell
 * history, because they are never passed as arguments.
 */
export function terminalPrompt(
  stdin: NodeJS.ReadStream = process.stdin,
  stdout: NodeJS.WriteStream = process.stdout,
): (question: string, options: { hidden: boolean }) => Promise<string> {
  return (question, { hidden }) =>
    new Promise((resolve, reject) => {
      stdout.write(question);
      const raw = hidden && stdin.isTTY;
      if (raw) stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.resume();
      let answer = "";
      const done = (error?: Error) => {
        stdin.off("data", onData);
        stdin.off("end", onEnd);
        if (raw) stdin.setRawMode(false);
        stdin.pause();
        stdout.write("\n");
        if (error) reject(error);
        else resolve(answer);
      };
      const onEnd = () => done();
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\u0003") return done(new Error("Cancelled.")); // Ctrl+C
          if (ch === "\r" || ch === "\n") return done();
          if (ch === "\u007f" || ch === "\b") answer = answer.slice(0, -1);
          else answer += ch;
        }
      };
      stdin.on("data", onData);
      stdin.on("end", onEnd);
    });
}
