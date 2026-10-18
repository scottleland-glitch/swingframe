/** Same-origin paths under the Pages base. The worker must not fall through to a CDN. */
export function tesseractPaths(base: string): { workerPath: string; corePath: string; langPath: string } {
  const root = base.endsWith('/') ? base : `${base}/`;
  return {
    workerPath: `${root}tesseract/worker.min.js`,
    corePath: `${root}tesseract/tesseract-core-simd-lstm.wasm.js`,
    langPath: `${root}tesseract/lang`,
  };
}
