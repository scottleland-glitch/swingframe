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

function waitEvent(target: HTMLVideoElement, name: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      target.removeEventListener(name, on);
      resolve(false);
    }, ms);
    const on = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    target.addEventListener(name, on, { once: true });
  });
}

function nextPaint(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const timer = window.setTimeout(resolve, 450);
    if (withCallback.requestVideoFrameCallback) {
      withCallback.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        resolve();
      });
    }
  });
}

/**
 * Finds a real picture in a clip. iPhone Safari often gives a black frame for the very first frames, or when
 * the video is off screen, so this uses a tiny on-screen video and tries several points in the clip.
 */
export async function grabGoodFrame(blob: Blob, hintDuration = 0): Promise<HTMLCanvasElement | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('muted', '');
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.preload = 'auto';
  video.style.cssText =
    'position:fixed;left:0;bottom:0;width:64px;height:64px;opacity:0.02;pointer-events:none;z-index:-1;';
  document.body.appendChild(video);
  try {
    video.src = url;
    video.load();
    const loaded = await waitEvent(video, 'loadeddata', 8000);
    if (!loaded && video.readyState < 2) return null;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : hintDuration;
    if (!duration || !video.videoWidth) return null;
    const w = 360;
    const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    for (const fraction of [0.12, 0.3, 0.5, 0.2, 0.7, 0.05, 0.85]) {
      const at = Math.min(Math.max(0.05, duration * fraction), Math.max(0.05, duration - 0.1));
      video.currentTime = at;
      await waitEvent(video, 'seeked', 3000);
      await nextPaint(video);
      ctx.drawImage(video, 0, 0, w, h);
      if (!canvasLooksBlack(canvas)) return canvas;
      // Some iPhones only hand over a picture once the video has played a moment.
      try {
        await video.play();
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        video.pause();
        ctx.drawImage(video, 0, 0, w, h);
        if (!canvasLooksBlack(canvas)) return canvas;
      } catch {
        /* Autoplay can be refused. Try the next point. */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
