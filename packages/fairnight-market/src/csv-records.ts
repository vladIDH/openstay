/**
 * A streaming CSV reader: text goes in by chunks, records come out as lists of
 * cells. Quoted cells may hold separators, doubled quotes and line breaks (the
 * listing descriptions of Inside Airbnb do), and a record may be split across
 * two chunks. Nothing is kept in memory but the record being read.
 */
export class CsvRecords {
  private cell = "";
  private row: string[] = [];
  private quoted = false;
  /** The last character was a closing quote, or a quote that may start a doubled one. */
  private quotePending = false;
  private started = false;
  private line = 1;
  private recordLine = 1;

  constructor(
    private readonly onRecord: (cells: string[], line: number) => void,
    private readonly separator = ",",
  ) {}

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i] as string;
      if (!this.started) {
        this.started = true;
        if (ch.charCodeAt(0) === 0xfeff) continue; // byte-order mark
      }
      if (this.quotePending) {
        this.quotePending = false;
        if (ch === '"') {
          this.cell += '"';
          continue;
        }
        this.quoted = false;
      }
      if (this.quoted) {
        if (ch === '"') this.quotePending = true;
        else {
          if (ch === "\n") this.line++;
          this.cell += ch;
        }
        continue;
      }
      if (ch === "\r") continue;
      if (ch === '"' && this.cell === "") {
        this.quoted = true;
        continue;
      }
      if (ch === this.separator) {
        this.row.push(this.cell);
        this.cell = "";
        continue;
      }
      if (ch === "\n") {
        this.flush();
        this.line++;
        this.recordLine = this.line;
        continue;
      }
      this.cell += ch;
    }
  }

  end(): void {
    if (this.quotePending) {
      this.quotePending = false;
      this.quoted = false;
    }
    this.flush();
  }

  private flush(): void {
    this.row.push(this.cell);
    const cells = this.row;
    this.row = [];
    this.cell = "";
    if (cells.length === 1 && (cells[0] as string).trim() === "") return; // empty line
    this.onRecord(
      cells.map((c) => c.trim()),
      this.recordLine,
    );
  }
}

/** Read a whole text at once. */
export function readCsv(text: string, separator = ","): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  const reader = new CsvRecords((cells, line) => out.push({ cells, line }), separator);
  reader.push(text);
  reader.end();
  return out;
}

/** Comma, or semicolon when the first line has semicolons and no commas. */
export function guessSeparator(text: string): string {
  const first = text.slice(0, text.search(/\r?\n|$/));
  return first.includes(";") && !first.includes(",") ? ";" : ",";
}
