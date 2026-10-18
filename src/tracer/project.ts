import type { Pt, ViewAngle } from '../types';
import type { FlightSample } from './flight';

export interface TracerCamera {
  view: ViewAngle;
  /** Meters. */
  height: number;
  /** Meters. */
  distance: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface TracerPoint {
  x: number;
  y: number;
  t: number;
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface Frame {
  at: Vec;
  forward: Vec;
  right: Vec;
  up: Vec;
  fov: number;
}

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Tripod camera. The ball is the origin and the target is +Z on the ground (Y = 0).
 * Pitch comes from the ball tap, so a phone a few meters back is not forced to stare
 * at the ball. Nothing here is fitted to a particular range or photo.
 */
function cameraFrame(camera: TracerCamera, ballY: number): Frame {
  const height = Math.max(0.2, camera.height);
  const distance = Math.max(0.3, camera.distance);
  const fov = Math.min(120, Math.max(10, camera.fov));
  const half = Math.tan(((fov * Math.PI) / 180) / 2);
  const aimY = Math.min(0.98, Math.max(0.02, ballY));
  const alpha = Math.atan(height / distance);
  const elevation = Math.atan((0.5 - aimY) * 2 * half);
  const phi = Math.min(0.95, Math.max(-0.2, alpha + elevation));
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const at: Vec = camera.view === 'face' ? { x: -distance, y: height, z: 0 } : { x: 0, y: height, z: -distance };
  const forward: Vec = camera.view === 'face' ? { x: cp, y: -sp, z: 0 } : { x: 0, y: -sp, z: cp };
  const right: Vec = camera.view === 'face' ? { x: 0, y: 0, z: -1 } : { x: 1, y: 0, z: 0 };
  const up: Vec = camera.view === 'face' ? { x: sp, y: cp, z: 0 } : { x: 0, y: cp, z: sp };
  return { at, forward, right, up, fov };
}

function projectRaw(sample: FlightSample, frame: Frame, width: number, height: number): { x: number; y: number } | null {
  const rel = sub({ x: sample.x, y: sample.y, z: sample.z }, frame.at);
  const z = dot(rel, frame.forward);
  if (z < 0.05) return null;
  const x = dot(rel, frame.right);
  const y = dot(rel, frame.up);
  const focal = height / 2 / Math.tan(((frame.fov * Math.PI) / 180) / 2);
  return {
    x: width / 2 + focal * (x / z),
    y: height / 2 - focal * (y / z),
  };
}

/**
 * Project the flight. The aim tap is the intended line only: world +Z on the
 * ground, which sets which way the camera is turned. It is not the landing.
 * Launch direction and spin are already in the samples, so the ball can finish
 * left or right of that line. Camera height, distance, and field of view are
 * what change the arc's size.
 */
export function projectFlight(
  samples: FlightSample[],
  camera: TracerCamera,
  ball: Pt,
  target: Pt,
  width: number,
  height: number,
): TracerPoint[] {
  if (samples.length < 2 || width < 2 || height < 2) return [];
  const frame = cameraFrame(camera, ball.y);
  const raw: TracerPoint[] = [];
  for (const sample of samples) {
    const pixel = projectRaw(sample, frame, width, height);
    if (!pixel) continue;
    raw.push({ x: pixel.x, y: pixel.y, t: sample.t });
  }
  if (raw.length < 2) return [];

  const origin = raw[0];
  let aim: { x: number; y: number } | null = null;
  for (const z of [40, 100, 200]) {
    const pixel = projectRaw({ t: 0, x: 0, y: 0, z }, frame, width, height);
    if (!pixel) continue;
    if (Math.hypot(pixel.x - origin.x, pixel.y - origin.y) > 8) {
      aim = pixel;
      break;
    }
  }
  const ballX = ball.x * width;
  const ballY = ball.y * height;
  const projX = (aim?.x ?? origin.x) - origin.x;
  const projY = (aim?.y ?? origin.y) - origin.y;
  const wantX = target.x * width - ballX;
  const wantY = target.y * height - ballY;
  let cos = 1;
  let sin = 0;
  if (Math.hypot(projX, projY) > 4 && Math.hypot(wantX, wantY) > 4) {
    const turn = Math.atan2(wantY, wantX) - Math.atan2(projY, projX);
    cos = Math.cos(turn);
    sin = Math.sin(turn);
  }

  return raw.map((point) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return {
      x: (ballX + dx * cos - dy * sin) / width,
      y: (ballY + dx * sin + dy * cos) / height,
      t: point.t,
    };
  });
}

export function defaultTracer(): {
  ball: null;
  target: null;
  impactTime: null;
  cameraHeight: number;
  cameraDistance: number;
  fov: number;
} {
  return {
    ball: null,
    target: null,
    impactTime: null,
    cameraHeight: 1.4,
    cameraDistance: 3.5,
    fov: 60,
  };
}
