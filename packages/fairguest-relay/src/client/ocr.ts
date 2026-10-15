/**
 * Reading the MRZ of a photo, in the guest's browser. The OCR (Tesseract,
 * Apache-2.0) and its MRZ model (BSD-3-Clause) are files of this site: no other
 * address is ever contacted. The image lives only in memory, in a canvas that
 * is emptied when the reading ends; it is never sent nor stored.
 */
import { parseMrz, type MrzFields } from "fairguest/browser";

/** The longest side the image is reduced to: enough for the MRZ, light on a phone. */
const MAX_SIDE = 1800;

function canvasFor(bitmap: ImageBitmap, crop: { top: number }): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const fullHeight = Math.round(bitmap.height * scale);
  const top = Math.round(fullHeight * crop.top);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = fullHeight - top;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no canvas");
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(bitmap, 0, top / scale, bitmap.width, (fullHeight - top) / scale, 0, 0, width, fullHeight - top);
  return canvas;
}

function wipe(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * The MRZ fields of the photo, or null. The whole image is tried first, then
 * its lower part, where the MRZ sits on passports and identity cards.
 */
export async function readDocument(file: Blob, today: string): Promise<MrzFields | null> {
  // tesseract.js is CommonJS: bundled, its exports arrive under "default".
  const loaded = (await import("tesseract.js")) as typeof import("tesseract.js") & { default?: typeof import("tesseract.js") };
  const { createWorker, OEM, PSM } = loaded.default ?? loaded;
  const bitmap = await createImageBitmap(file);
  const worker = await createWorker("mrz", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: false,
    cacheMethod: "none",
    workerBlobURL: false,
  });
  let best: MrzFields | null = null;
  try {
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    for (const top of [0, 0.55]) {
      const canvas = canvasFor(bitmap, { top });
      try {
        const { data } = await worker.recognize(canvas);
        const found = parseMrz(data.text, today);
        if (found && (!best || found.failed.length < best.failed.length)) best = found;
        if (best?.valid) break;
      } finally {
        wipe(canvas);
      }
    }
  } finally {
    await worker.terminate();
    bitmap.close();
  }
  return best;
}
