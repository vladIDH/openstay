/**
 * A very small PDF writer: A4 pages of text in Helvetica, nothing else. Enough
 * for the tourist tax summary, with no dependency. Text is WinAnsi (Latin
 * letters with accents and the euro sign); any other character becomes "?".
 */

export interface PdfText {
  x: number;
  /** From the top of the page, in points. */
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
  /** Right-aligned at x (figures in a column). */
  right?: boolean;
}

export const A4 = { width: 595, height: 842 } as const;

/** WinAnsi bytes that differ from Latin-1 (only the ones a summary can use). */
const WIN_ANSI: Record<number, number> = { 0x20ac: 0x80, 0x2019: 0x92, 0x2018: 0x91, 0x201c: 0x93, 0x201d: 0x94, 0x2013: 0x96, 0x2014: 0x97, 0x2022: 0x95, 0x2026: 0x85 };

function winAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    const byte = WIN_ANSI[code] ?? (code >= 0x20 && code <= 0xff && !(code >= 0x7f && code < 0xa0) ? code : 0x3f);
    out += String.fromCharCode(byte);
  }
  return out;
}

const escapePdf = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** Helvetica widths of WinAnsi characters 32–126, per 1000 units (the rest count as 556). */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width of a text in points (bold counted about 6% wider). */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of winAnsi(text)) {
    const c = ch.charCodeAt(0);
    units += c >= 32 && c <= 126 ? (HELVETICA[c - 32] as number) : 556;
  }
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

/** The PDF file, as bytes. */
export function pdfFile(pages: PdfText[][], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // the object number: they start at 1
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${escapePdf(winAnsi(title))}) /Producer (Fairguest) >>`);
  const kids: number[] = [];
  for (const items of pages.length > 0 ? pages : [[]]) {
    const ops = items
      .map((t) => {
        const size = t.size ?? 10;
        const x = t.right ? t.x - textWidth(t.text, size, t.bold) : t.x;
        return `BT /${t.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${(A4.height - t.y).toFixed(2)} Td (${escapePdf(winAnsi(t.text))}) Tj ET`;
      })
      .join("\n");
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%" + String.fromCharCode(0xe2, 0xe3, 0xcf, 0xd3) + "\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
