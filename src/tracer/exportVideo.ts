import { paint } from '../draw';
import type { Drawing } from '../types';
import { paintTracer, type TracerMarks } from './paintTracer';
import type { TracerPoint } from './project';
import { playClock, tracerPlayhead } from './timing';

/** How long the export runs. It starts at the clip and holds the last frame until the ball lands. */
export function exportSpan(clipStart: number, clipEnd: number, impact: number | null, flightTime: number): { start: number; end: number } {
  const start = Math.max(0, clipStart);
  const pictureEnd = Math.max(start, clipEnd);
  const land = impact != null && flightTime > 0 ? impact + flightTime : pictureEnd;
  return { start, end: Math.max(pictureEnd, land) };
}

/** Keep phone exports from a 4K frame stalling. The tracer is drawn in these pixels. */
export function exportSize(videoWidth: number, videoHeight: number): { w: number; h: number } {
  const w = videoWidth > 0 ? videoWidth : 720;
  const h = videoHeight > 0 ? videoHeight : 1280;
  const long = Math.max(w, h);
  const cap = 1920;
  if (long <= cap) return { w: Math.round(w), h: Math.round(h) };
  const scale = cap / long;
  return { w: Math.max(2, Math.round(w * scale)), h: Math.max(2, Math.round(h * scale)) };
}

/** Prefer mp4, which is what iOS Safari can record. Empty string lets the browser pick. Null means recording is unavailable. */
export function chooseRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  const candidates = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs="avc1.42E01E"', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* This browser rejects the query. Try the next type. */
    }
  }
  return '';
}

export interface ExportRequest {
  blob: Blob;
  drawings: Drawing[];
  tracerPath: TracerPoint[] | null;
  impactTime: number | null;
  flightTime: number;
  clipStart: number;
  clipEnd: number;
  videoWidth: number;
  videoHeight: number;
  marks: TracerMarks | null;
  tracerColor?: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  audio: boolean;
  note: string;
}

type StreamCanvas = HTMLCanvasElement & { captureStream?: (frameRate?: number) => MediaStream };

function resultNote(audio: boolean, mime: string): string {
  const ios = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const kind = mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'video';
  const sound = audio ? 'The clip’s sound is included.' : 'This file has no sound. This phone could not attach the audio to the recording.';
  const share = ios
    ? ' The share sheet can save it to Photos or Files. Some iOS versions reject a page-recorded mp4 in Photos; Files still keeps it.'
    : '';
  return `Saved a ${kind}. ${sound}${share}`;
}

interface AudioGraph {
  context: AudioContext;
  track: MediaStreamTrack | null;
}

function attachAudio(video: HTMLVideoElement): AudioGraph | null {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    const context = new Ctx();
    const source = context.createMediaElementSource(video);
    const dest = context.createMediaStreamDestination();
    source.connect(dest);
    return { context, track: dest.stream.getAudioTracks()[0] ?? null };
  } catch {
    return null;
  }
}

function openRecorder(stream: MediaStream, mime: string): MediaRecorder {
  const videoOnly = () => new MediaStream(stream.getVideoTracks());
  const options = mime ? { mimeType: mime, videoBitsPerSecond: 4_500_000 } : undefined;
  try {
    return new MediaRecorder(stream, options);
  } catch {
    const fallback = mime.startsWith('video/mp4') ? 'video/mp4' : mime;
    return new MediaRecorder(videoOnly(), fallback ? { mimeType: fallback, videoBitsPerSecond: 4_500_000 } : undefined);
  }
}

/**
 * Play the clip at real speed onto a canvas, draw the tracer and any visible drawings,
 * and record it. Stays on the page: no native fullscreen player.
 */
export async function recordTracerVideo(request: ExportRequest): Promise<ExportResult> {
  const mime = chooseRecorderMime();
  if (mime == null || typeof document === 'undefined') {
    throw new Error('This phone cannot record a video from the page. iOS Safari can record an mp4 from iOS 14.3 on. Chrome on iPhone uses the same player and may refuse.');
  }
  const canvas = document.createElement('canvas');
  const size = exportSize(request.videoWidth, request.videoHeight);
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  const streamCanvas = canvas as StreamCanvas;
  if (!ctx || !streamCanvas.captureStream) {
    throw new Error('This phone cannot capture the picture off the page.');
  }

  const url = URL.createObjectURL(request.blob);
  const video = document.createElement('video');
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.controls = false;
  video.preload = 'auto';
  video.muted = false;
  video.loop = false;
  video.onended = () => video.pause();
  video.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.appendChild(video);
  video.src = url;

  let audioGraph: AudioGraph | null = null;
  let audio = false;

  try {
    await new Promise<void>((resolve, reject) => {
      if (video.readyState >= 1) resolve();
      else {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('The video could not be read for export.')), { once: true });
      }
    });
    const fileEnd = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Math.max(request.clipEnd, 0.1);
    const pictureEnd = request.clipEnd > 0 ? Math.min(request.clipEnd, fileEnd) : fileEnd;
    const span = exportSpan(request.clipStart, pictureEnd, request.impactTime, request.flightTime);
    video.currentTime = span.start;
    await new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - span.start) < 0.08) resolve();
      else video.addEventListener('seeked', () => resolve(), { once: true });
    });

    audioGraph = attachAudio(video);
    if (audioGraph) {
      try {
        await audioGraph.context.resume();
      } catch {
        /* Recording can continue without sound. */
      }
    }
    try {
      await video.play();
    } catch {
      video.muted = true;
      await video.play();
    }

    const canvasStream = streamCanvas.captureStream(30);
    const mixed = new MediaStream(canvasStream.getVideoTracks());
    if (audioGraph?.track && !video.muted) {
      mixed.addTrack(audioGraph.track);
      audio = true;
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      let recorder: MediaRecorder;
      try {
        recorder = openRecorder(mixed, mime);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Recording could not start.'));
        return;
      }
      if (recorder.stream.getAudioTracks().length === 0) audio = false;
      const chunks: Blob[] = [];
      let raf = 0;
      let settled = false;
      const stopFrames = () => cancelAnimationFrame(raf);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        stopFrames();
        reject(error);
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => fail(new Error('Recording stopped early.'));
      recorder.onstop = () => {
        if (settled) return;
        settled = true;
        stopFrames();
        resolve(new Blob(chunks, { type: recorder.mimeType || mime || 'video/mp4' }));
      };
      const stop = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
      request.signal?.addEventListener('abort', stop, { once: true });
      const started = performance.now();
      let parkedPicture = false;
      let holdFrom: number | null = null;
      const tick = () => {
        if (request.signal?.aborted) return;
        const now = performance.now();
        const pictureDone = video.currentTime >= pictureEnd - 0.04 || video.ended;
        if (pictureDone && holdFrom == null) holdFrom = now;
        // The tracer follows the picture's own time, as in the player, so a slow start or a stall in the recording cannot shift it.
        // Only the hold after the last frame runs on the wall clock.
        const t = pictureDone ? pictureEnd + (now - (holdFrom ?? now)) / 1000 : Math.max(span.start, video.currentTime);
        if ((now - started) / 1000 > (span.end - span.start) * 3 + 8) {
          stop();
          return;
        }
        if (pictureDone) {
          video.pause();
          if (!parkedPicture && video.currentTime > pictureEnd + 0.04) {
            parkedPicture = true;
            try {
              video.currentTime = Math.max(span.start, pictureEnd - 0.001);
            } catch {
              /* The last decoded frame is enough. The tracer still finishes on the clock. */
            }
          }
        }
        ctx.drawImage(video, 0, 0, size.w, size.h);
        const viewW = 390;
        const viewH = Math.max(2, (viewW * size.h) / size.w);
        ctx.save();
        ctx.scale(size.w / viewW, size.h / viewH);
        paint(ctx, request.drawings, null, [], null, '#ffffff', viewW, viewH, null, false);
        const drawLine = Boolean(request.tracerPath && request.impactTime != null);
        if (drawLine || request.marks) {
          paintTracer(
            ctx,
            drawLine ? request.tracerPath : null,
            viewW,
            viewH,
            drawLine
              ? tracerPlayhead(
                  playClock({
                    videoTime: Math.min(t, pictureEnd),
                    clipEnd: pictureEnd,
                    impact: request.impactTime,
                    flightTime: request.flightTime,
                    hold: Math.max(0, t - pictureEnd),
                  }).playbackTime,
                  request.impactTime,
                  request.flightTime,
                )
              : null,
            request.marks,
            request.tracerColor ?? null,
          );
        }
        ctx.restore();
        const length = Math.max(0.001, span.end - span.start);
        request.onProgress?.(Math.max(0, Math.min(1, (t - span.start) / length)));
        if (t >= span.end) {
          stop();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      try {
        recorder.start(250);
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Recording could not start.'));
        return;
      }
      raf = requestAnimationFrame(tick);
    });

    const type = blob.type || mime || 'video/mp4';
    return { blob, mime: type, audio, note: resultNote(audio, type) };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
    if (audioGraph) {
      audioGraph.track?.stop();
      void audioGraph.context.close().catch(() => undefined);
    }
  }
}

/** Share the file when the phone allows it, otherwise download it. */
export async function offerRecording(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const type = blob.type || 'video/mp4';
  const file = new File([blob], filename, { type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Swingframe tracer' });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
