/**
 * SHA-256 of every file of the guest's page, written by `npm run build -w fairguest-relay`.
 * `fairnight ospiti verifica-pagina` compares them with what a relay serves. Do not edit by hand.
 */
export const PAGE_HASHES: Record<string, string> = {
  "/app.css": "9048c8d869afc0dbdc606a7b1fd10eec348960f5f3f0d26f92983357ed1d2ccd",
  "/app.js": "159724668c6e66d4110b1db61d9095673944f2310d82bcc49906f341f9726d33",
  "/checkin.html": "0d87230da80a3233dd8b40c5f075a498f87fa168966ba1493848452911f77e78",
  "/chunks/chunk-GAPWU6WI.js": "6c11189916145f8972ff7cb6b91c9c38149d2acdeea3da9f67fbc7f2a37c0015",
  "/chunks/chunk-ZGOTX6UK.js": "e41b59a05075d824fa6d3265186141639e11954f97e920f9299e05da53264ac5",
  "/chunks/ocr-TM4BBBDL.js": "cb9a9bc14b8312329a6bea5811cabc15960bc76f651d47266d753c791775da16",
  "/chunks/src-HHEQOMB4.js": "26fa808bee10b7b59f3643220de08da590387c01d28a610fb43c901aeea0b1c9",
  "/ocr/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "/ocr/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "/ocr/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "/ocr/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
};
