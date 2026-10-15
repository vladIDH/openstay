/**
 * SHA-256 of every file of the guest's page, written by `npm run build -w fairguest-relay`.
 * `fairnight ospiti verifica-pagina` compares them with what a relay serves. Do not edit by hand.
 */
export const PAGE_HASHES: Record<string, string> = {
  "/app.css": "a2fbfa06bf615b660c7ef8ee1c831963b551982d4963a5c7a21190157f8a993d",
  "/app.js": "2a44d7fc6c8d238b9a320b00897af108bbc15149b5a58dd89c1ad7d2c5c82350",
  "/checkin.html": "0d87230da80a3233dd8b40c5f075a498f87fa168966ba1493848452911f77e78",
  "/chunks/chunk-KMB2OILE.js": "73162cabd61c9b599307ed66ffb4fd381e02f5f5162f6ff592967a79b9c17ba3",
  "/chunks/chunk-ZGOTX6UK.js": "e41b59a05075d824fa6d3265186141639e11954f97e920f9299e05da53264ac5",
  "/chunks/ocr-BPM727Y4.js": "dcb96d6bc9afe9286751b68d8d3132a6709df7c450ed3cf4ed1f81a7c8e2c0d0",
  "/chunks/src-HHEQOMB4.js": "26fa808bee10b7b59f3643220de08da590387c01d28a610fb43c901aeea0b1c9",
  "/ocr/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "/ocr/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "/ocr/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "/ocr/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
};
