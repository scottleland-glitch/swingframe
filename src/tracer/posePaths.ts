/** Same-origin pose files. The landmarker must not fall through to a CDN. */
export function posePaths(base: string): { wasm: string; model: string } {
  const root = base.endsWith('/') ? base : `${base}/`;
  return {
    wasm: `${root}pose/wasm`,
    model: `${root}pose/pose_landmarker_lite.task`,
  };
}
