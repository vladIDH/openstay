/**
 * SHA-256 of every file of the guest's page, written by `npm run build -w fairguest-relay`.
 * `fairnight ospiti verifica-pagina` compares them with what a relay serves. Do not edit by hand.
 */
export const PAGE_HASHES: Record<string, string> = {
  "/app.css": "a2fbfa06bf615b660c7ef8ee1c831963b551982d4963a5c7a21190157f8a993d",
  "/app.js": "38e4f8af325f88532e60d9e874418c412c012c96bb9b2a57b037e1294e1c25f3",
  "/checkin.html": "0d87230da80a3233dd8b40c5f075a498f87fa168966ba1493848452911f77e78",
  "/chunks/chunk-VEUFWN6L.js": "e0cfe19a1a1c5a38ee8f92933457663a8d6b8097e1c489817a7c2626874d3489",
  "/chunks/chunk-ZGOTX6UK.js": "e41b59a05075d824fa6d3265186141639e11954f97e920f9299e05da53264ac5",
  "/chunks/ocr-CQ4MUVVI.js": "fe2cfe88f3623f5f053c7ab91da304eb90b58117976a9865f300984c3a88d56d",
  "/chunks/src-HHEQOMB4.js": "26fa808bee10b7b59f3643220de08da590387c01d28a610fb43c901aeea0b1c9",
  "/ocr/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "/ocr/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "/ocr/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "/ocr/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
};
