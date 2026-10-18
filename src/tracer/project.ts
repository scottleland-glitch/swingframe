import type { Pt, ViewAngle } from '../types';
import type { FlightSample } from './flight';

export interface TracerCamera {
  view: ViewAngle;
  /** Meters. */
  height: number;
  /** Meters. */
  distance: number;
  /** Vertical degrees. */
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

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec, b: Vec): Vec {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function norm(v: Vec): Vec {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function basis(camera: TracerCamera) {
  const height = Math.max(0.2, camera.height);
  const distance = Math.max(0.3, camera.distance);
  const at: Vec = camera.view === 'face' ? { x: -distance, y: height, z: 0 } : { x: 0, y: height, z: -distance };
  const look: Vec = { x: 0, y: 0, z: 0 };
  const forward = norm(sub(look, at));
  const worldUp: Vec = { x: 0, y: 1, z: 0 };
  let right = norm(cross(worldUp, forward));
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = { x: 1, y: 0, z: 0 };
  const up = norm(cross(forward, right));
  return { at, forward, right, up };
}

function projectRaw(
  sample: FlightSample,
  camera: TracerCamera,
  frame: { at: Vec; forward: Vec; right: Vec; up: Vec },
  width: number,
  height: number,
): { x: number; y: number } | null {
  const rel = sub({ x: sample.x, y: sample.y, z: sample.z }, frame.at);
  const z = dot(rel, frame.forward);
  if (z < 0.05) return null;
  const x = dot(rel, frame.right);
  const y = dot(rel, frame.up);
  const fov = Math.min(120, Math.max(10, camera.fov));
  const focal = height / 2 / Math.tan(((fov * Math.PI) / 180) / 2);
  return {
    x: width / 2 + focal * (x / z),
    y: height / 2 - focal * (y / z),
  };
}

/**
 * Pinhole projection, then a 2D move and rotate so the ball sits on the tap
 * and the first part of the flight points at the target tap. The target tap
 * does not scale the shot. Height, distance, and field of view do.
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
  const frame = basis(camera);
  const raw: TracerPoint[] = [];
  for (const sample of samples) {
    const pixel = projectRaw(sample, camera, frame, width, height);
    if (!pixel) continue;
    raw.push({ x: pixel.x / width, y: pixel.y / height, t: sample.t });
  }
  if (raw.length < 2) return [];
  const origin = raw[0];
  const ahead = raw.find((point) => point.t >= 0.2) ?? raw[raw.length - 1];
  const projX = ahead.x - origin.x;
  const projY = ahead.y - origin.y;
  const wantX = target.x - ball.x;
  const wantY = target.y - ball.y;
  let cos = 1;
  let sin = 0;
  if (Math.hypot(projX, projY) > 0.004 && Math.hypot(wantX, wantY) > 0.004) {
    const turn = Math.atan2(wantY, wantX) - Math.atan2(projY, projX);
    cos = Math.cos(turn);
    sin = Math.sin(turn);
  }
  return raw.map((point) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return {
      x: ball.x + dx * cos - dy * sin,
      y: ball.y + dx * sin + dy * cos,
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
    cameraHeight: 5 * 0.3048,
    cameraDistance: 3 * 0.9144,
    fov: 58,
  };
}
