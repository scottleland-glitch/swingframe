import type { Pt } from '../types';
import { detectImpact } from './impact';

function audioCtor(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const legacy = (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return legacy ?? null;
}

async function impactFromAudio(blob: Blob): Promise<number | null> {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    return detectImpact(decoded.getChannelData(0), decoded.sampleRate);
  } catch {
    return null;
  } finally {
    await ctx.close();
  }
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 450);
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = time;
    } catch {
      finish();
    }
  });
}

/** Watch a small patch on the ball. Used when the clip has no usable hit sound. */
async function impactFromMotion(blob: Blob, ball: Pt): Promise<number | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 4000);
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('video'));
      };
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration < 0.2) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 28;
    canvas.height = 28;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const stop = Math.min(duration, 4);
    let previous: Uint8ClampedArray | null = null;
    let best = 0;
    let bestAt = -1;
    const diffs: number[] = [];
    for (let time = 0.05; time <= stop; time += 1 / 20) {
      await seekTo(video, time);
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      const size = Math.max(12, Math.round(Math.min(vw, vh) * 0.06));
      const sx = Math.max(0, Math.min(vw - size, ball.x * vw - size / 2));
      const sy = Math.max(0, Math.min(vh - size, ball.y * vh - size / 2));
      ctx.drawImage(video, sx, sy, size, size, 0, 0, 28, 28);
      const frame = ctx.getImageData(0, 0, 28, 28).data;
      if (previous) {
        let sum = 0;
        for (let i = 0; i < frame.length; i += 4) {
          sum += Math.abs(frame[i] - previous[i]);
        }
        const diff = sum / (frame.length / 4);
        diffs.push(diff);
        if (diff > best) {
          best = diff;
          bestAt = time;
        }
      }
      previous = frame;
    }
    if (bestAt < 0 || best < 12) return null;
    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (best < Math.max(12, median * 3)) return null;
    return bestAt;
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Audio spike first, then ball movement if the tap is known. */
export async function detectImpactTime(blob: Blob, ball: Pt | null): Promise<number | null> {
  const heard = await impactFromAudio(blob);
  if (heard != null) return heard;
  if (!ball) return null;
  return impactFromMotion(blob, ball);
}
