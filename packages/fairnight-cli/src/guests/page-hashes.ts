/**
 * SHA-256 of every file of the guest's page, written by `npm run build -w fairguest-relay`.
 * `fairnight ospiti verifica-pagina` compares them with what a relay serves. Do not edit by hand.
 */
export const PAGE_HASHES: Record<string, string> = {
  "/app.css": "40a0cd2277cfb604922149c0805d06360fe31d2c21b97a67e7776fef3f15238c",
  "/app.js": "3585d4465487579953ea29c6cd25c45b46faeaf6748b2100389cbcb81b3cd420",
  "/checkin.html": "0d87230da80a3233dd8b40c5f075a498f87fa168966ba1493848452911f77e78",
  "/chunks/chunk-74MHNDTM.js": "87c185922ac0dc1bcd4e94c79ffae2abe147daf759b14293d482739a0099b7d8",
  "/chunks/chunk-ZGOTX6UK.js": "e41b59a05075d824fa6d3265186141639e11954f97e920f9299e05da53264ac5",
  "/chunks/ocr-CMRWTRRP.js": "3dd8743c93f970b52284d41ee353cc8212c62f17dc0d82b49651f7859f6477f9",
  "/chunks/src-HHEQOMB4.js": "26fa808bee10b7b59f3643220de08da590387c01d28a610fb43c901aeea0b1c9",
  "/ocr/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "/ocr/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "/ocr/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "/ocr/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
};
