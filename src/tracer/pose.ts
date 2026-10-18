import type { ToeLine } from './aimSuggest';
import { posePaths } from './posePaths';

const LEFT_HEEL = 29;
const RIGHT_HEEL = 30;
const LEFT_TOE = 31;
const RIGHT_TOE = 32;

export interface FeetHit {
  feet: ToeLine;
  confidence: number;
}

type Landmarker = {
  detect: (image: HTMLCanvasElement) => { landmarks: { x: number; y: number; visibility?: number; presence?: number }[][] };
};

let loading: Promise<Landmarker | null> | null = null;

function drawFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 2 || height < 2) return null;
  const scale = Math.min(1, 640 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
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
    const timer = window.setTimeout(finish, 700);
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = time;
    } catch {
      finish();
    }
  });
}

/** A frame from a copy of the clip, so the picture Scott is watching does not jump. */
export async function frameAtTime(blob: Blob, time: number): Promise<HTMLCanvasElement | null> {
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
    const duration = Number.isFinite(video.duration) ? video.duration : time;
    await seekTo(video, Math.min(Math.max(0, time), Math.max(0, duration - 0.04)));
    return drawFrame(video);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

async function landmarker(base: string): Promise<Landmarker | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const paths = posePaths(base);
        const vision = await FilesetResolver.forVisionTasks(paths.wasm);
        const options = {
          baseOptions: { modelAssetPath: paths.model },
          runningMode: 'IMAGE' as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.4,
          minPosePresenceConfidence: 0.4,
        };
        const created = await PoseLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        }).catch(() =>
          PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }),
        );
        return {
          detect: (image: HTMLCanvasElement) => created.detect(image),
        };
      } catch {
        return null;
      }
    })().then((value) => {
      if (!value) loading = null;
      return value;
    });
  }
  return loading;
}

function footScore(point: { visibility?: number; presence?: number } | undefined): number {
  if (!point) return 0;
  const visibility = typeof point.visibility === 'number' ? point.visibility : 0;
  const presence = typeof point.presence === 'number' ? point.presence : visibility;
  return Math.min(visibility, presence);
}

/** Feet at address. Low confidence returns null so the straight-ahead aim stays. */
export async function detectFeet(frame: HTMLCanvasElement, base: string): Promise<FeetHit | null> {
  try {
    const pose = await landmarker(base);
    if (!pose) return null;
    const landmarks = pose.detect(frame).landmarks[0];
    if (!landmarks || landmarks.length < 33) return null;
    const leftToe = landmarks[LEFT_TOE];
    const rightToe = landmarks[RIGHT_TOE];
    const leftHeel = landmarks[LEFT_HEEL];
    const rightHeel = landmarks[RIGHT_HEEL];
    const confidence = Math.min(footScore(leftToe), footScore(rightToe), footScore(leftHeel), footScore(rightHeel));
    if (confidence < 0.5) return null;
    const feet: ToeLine = {
      leftToe: { x: leftToe.x, y: leftToe.y },
      rightToe: { x: rightToe.x, y: rightToe.y },
      leftHeel: { x: leftHeel.x, y: leftHeel.y },
      rightHeel: { x: rightHeel.x, y: rightHeel.y },
    };
    return { feet, confidence };
  } catch {
    return null;
  }
}
