export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  thumbnail: Blob | null;
}

function waitFor(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out reading that video.'));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Could not read that video.'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onOk);
      target.removeEventListener('error', onErr);
    };
    target.addEventListener(event, onOk, { once: true });
    target.addEventListener('error', onErr, { once: true });
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72);
  });
}

function frameLooksBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const sample = ctx.getImageData(0, 0, Math.min(8, w), Math.min(8, h)).data;
    let sum = 0;
    for (let i = 0; i < sample.length; i += 4) {
      sum += sample[i] + sample[i + 1] + sample[i + 2];
    }
    return sum === 0;
  } catch {
    return false;
  }
}

async function snapshot(video: HTMLVideoElement): Promise<Blob | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const canvas = document.createElement('canvas');
  const w = 360;
  const h = Math.max(1, Math.round((360 * vh) / vw));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const draw = () => {
    ctx.drawImage(video, 0, 0, w, h);
  };
  try {
    draw();
  } catch {
    return null;
  }
  if (frameLooksBlank(ctx, w, h)) {
    try {
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      video.pause();
      draw();
    } catch {
      /* A blank poster is fine. The swing still saves. */
    }
  }
  return canvasToBlob(canvas);
}

export function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  return /\.(mov|mp4|m4v|webm|avi|mkv)$/i.test(file.name);
}

export async function probeVideo(file: File): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.style.position = 'fixed';
  video.style.left = '-4000px';
  video.style.width = '8px';
  video.style.height = '8px';
  document.body.appendChild(video);
  try {
    video.src = url;
    await waitFor(video, 'loadedmetadata', 8000);
    if (!Number.isFinite(video.duration)) {
      await waitFor(video, 'durationchange', 1500).catch(() => undefined);
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (duration > 0) {
      const target = Math.min(0.2, Math.max(0.001, duration * 0.08));
      try {
        video.currentTime = target;
        await waitFor(video, 'seeked', 3000);
      } catch {
        /* Use whatever frame is available. */
      }
    }
    const thumbnail = await snapshot(video);
    return { duration, width, height, thumbnail };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
