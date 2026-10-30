/** True when a canvas is nearly all black, which is how a thumbnail looks if the phone gave a blank frame. */
export function canvasLooksBlack(canvas: HTMLCanvasElement): boolean {
  try {
    const probe = document.createElement('canvas');
    probe.width = 24;
    probe.height = 24;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0, 24, 24);
    const data = ctx.getImageData(0, 0, 24, 24).data;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    return total / (24 * 24 * 3) < 10;
  } catch {
    return false;
  }
}

export async function blobLooksBlack(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    canvas.getContext('2d')?.drawImage(img, 0, 0, 24, 24);
    return canvasLooksBlack(canvas);
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A 360px wide JPEG of a canvas, the same size the import step makes. */
export function canvasToThumbnail(source: HTMLCanvasElement): Promise<Blob | null> {
  const w = 360;
  const h = Math.max(1, Math.round((w * source.height) / Math.max(1, source.width)));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72));
}
