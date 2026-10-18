import type { Pt, TracerCalibration, ViewAngle } from '../types';
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

/** Default downward pitch, from the tripod and where the ball sits in the frame. */
export function cameraPitch(camera: TracerCamera, ballY: number): number {
  const height = Math.max(0.2, camera.height);
  const distance = Math.max(0.3, camera.distance);
  const fov = Math.min(120, Math.max(10, camera.fov));
  const half = Math.tan(((fov * Math.PI) / 180) / 2);
  const aimY = Math.min(0.98, Math.max(0.02, ballY));
  const alpha = Math.atan(height / distance);
  const elevation = Math.atan((0.5 - aimY) * 2 * half);
  return Math.min(0.95, Math.max(-0.2, alpha + elevation));
}

/**
 * Tripod camera. The ball is the origin and the target is +Z on the ground (Y = 0).
 * Pitch comes from the ball tap, so a phone a few meters back is not forced to stare
 * at the ball. A landing-ground tap can pass its own pitch. Nothing here is fitted
 * to a particular range or photo.
 */
function cameraFrame(camera: TracerCamera, ballY: number, pitch?: number): Frame {
  const height = Math.max(0.2, camera.height);
  const distance = Math.max(0.3, camera.distance);
  const fov = Math.min(120, Math.max(10, camera.fov));
  const phi = pitch ?? cameraPitch(camera, ballY);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const at: Vec = camera.view === 'face' ? { x: -distance, y: height, z: 0 } : { x: 0, y: height, z: -distance };
  const forward: Vec = camera.view === 'face' ? { x: cp, y: -sp, z: 0 } : { x: 0, y: -sp, z: cp };
  const right: Vec = camera.view === 'face' ? { x: 0, y: 0, z: -1 } : { x: 1, y: 0, z: 0 };
  const up: Vec = camera.view === 'face' ? { x: sp, y: cp, z: 0 } : { x: 0, y: cp, z: sp };
  return { at, forward, right, up, fov };
}

function focalLength(fov: number, height: number): number {
  return height / 2 / Math.tan(((fov * Math.PI) / 180) / 2);
}

function projectRaw(sample: FlightSample, frame: Frame, width: number, height: number): { x: number; y: number } | null {
  const rel = sub({ x: sample.x, y: sample.y, z: sample.z }, frame.at);
  const z = dot(rel, frame.forward);
  if (z < 0.05) return null;
  const x = dot(rel, frame.right);
  const y = dot(rel, frame.up);
  const focal = focalLength(frame.fov, height);
  return {
    x: width / 2 + focal * (x / z),
    y: height / 2 - focal * (y / z),
  };
}

/**
 * Extra sideways pixels so a down-the-line fade reads as a bend.
 * The camera sits in the shot plane, and perspective squeezes the Magnus
 * residual onto the start line, so the stroke looks like a straight tilt.
 * This is only the part of the side movement that is off the straight line
 * between the start line and the landing. The landing pixel is unchanged,
 * and it stays the true angle. The scale is the geometric mean of the
 * tripod distance and the carry — camera distance and field of view still
 * set how big that bend is.
 */
function magnusBowPx(sample: FlightSample, heading: number, endResidual: number, carry: number, distance: number, focal: number): number {
  if (carry < 1 || distance < 0.3) return 0;
  const residual = sample.x - heading * sample.z;
  const linear = endResidual * (sample.z / carry);
  // The side residual lags a straight line out to the landing, so the stroke
  // leaves that line and comes back. A fade returns from the left; a draw
  // returns from the right. Endpoints stay on the real landing.
  const bow = residual - linear;
  const range = carry + distance;
  const perMeter = 1 / Math.sqrt(range * distance) - 1 / range;
  return bow * perMeter * focal;
}

/** Screen height of a ground point straight ahead, before the aim-line rotation. */
export function groundScreenY(camera: TracerCamera, ballY: number, carryMeters: number): number {
  const frame = cameraFrame(camera, ballY);
  const pixel = projectRaw({ t: 0, x: 0, y: 0, z: Math.max(5, carryMeters) }, frame, 1000, 1000);
  if (!pixel) return 0.42;
  return Math.min(0.92, Math.max(0.05, pixel.y / 1000));
}

function projectMapped(
  samples: FlightSample[],
  camera: TracerCamera,
  frame: Frame,
  ball: Pt,
  target: Pt,
  width: number,
  height: number,
): TracerPoint[] {
  if (samples.length < 2 || width < 2 || height < 2) return [];
  let heading = 0;
  for (const sample of samples) {
    if (sample.z > 8) {
      heading = sample.x / sample.z;
      break;
    }
  }
  const landing = samples[samples.length - 1];
  const carry = landing.z;
  const endResidual = landing.x - heading * carry;
  const focal = focalLength(frame.fov, height);
  const drawBow = camera.view !== 'face';
  const raw: TracerPoint[] = [];
  for (const sample of samples) {
    const pixel = projectRaw(sample, frame, width, height);
    if (!pixel) continue;
    if (drawBow) {
      pixel.x += magnusBowPx(sample, heading, endResidual, carry, camera.distance, focal);
    }
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

interface GroundView {
  pitch: number;
  fov: number;
}

/**
 * Camera pitch, then field of view, so the carry lands on the tapped screen
 * height. Pitch is enough when the landing needs to move up the frame. A
 * hillside asks for the opposite, and pitch bottoms out, so the field of view
 * then scales the ground. The sliders stay what Scott set; this is only the
 * picture. Sideways finish is left to launch and spin.
 */
function viewForGround(
  samples: FlightSample[],
  camera: TracerCamera,
  ball: Pt,
  target: Pt,
  width: number,
  height: number,
  groundY: number,
): GroundView {
  const targetY = Math.min(0.98, Math.max(0.02, groundY));
  const yAt = (phi: number, fov: number): number | null => {
    const tuned = { ...camera, fov };
    const path = projectMapped(samples, tuned, cameraFrame(tuned, ball.y, phi), ball, target, width, height);
    return path.length >= 2 ? path[path.length - 1].y : null;
  };
  const refine = (
    lo: number,
    hi: number,
    read: (value: number) => number | null,
    start: number,
  ): { value: number; err: number } => {
    const steps = 32;
    let best = start;
    let bestErr = Infinity;
    let prev: { value: number; y: number } | null = null;
    let bracket: [number, number] | null = null;
    for (let i = 0; i <= steps; i++) {
      const value = lo + ((hi - lo) * i) / steps;
      const y = read(value);
      if (y == null) {
        prev = null;
        continue;
      }
      const err = Math.abs(y - targetY);
      if (err < bestErr) {
        bestErr = err;
        best = value;
      }
      if (prev && (prev.y - targetY) * (y - targetY) <= 0) bracket = [prev.value, value];
      prev = { value, y };
    }
    if (bracket) {
      let [a, b] = bracket;
      let yA = read(a);
      for (let i = 0; i < 16 && yA != null; i++) {
        const mid = (a + b) / 2;
        const y = read(mid);
        if (y == null) break;
        const err = Math.abs(y - targetY);
        if (err < bestErr) {
          bestErr = err;
          best = mid;
        }
        if ((yA - targetY) * (y - targetY) <= 0) b = mid;
        else {
          a = mid;
          yA = y;
        }
      }
    }
    return { value: best, err: bestErr };
  };

  const pitched = refine(-1.05, 1.25, (phi) => yAt(phi, camera.fov), cameraPitch(camera, ball.y));
  if (pitched.err <= 0.008) return { pitch: pitched.value, fov: camera.fov };
  const opened = refine(15, 110, (fov) => yAt(pitched.value, fov), camera.fov);
  return { pitch: pitched.value, fov: opened.err < pitched.err ? opened.value : camera.fov };
}

/**
 * Project the flight. The aim tap is the intended line only: world +Z on the
 * ground, which sets which way the camera is turned. It is not the landing.
 * Launch direction and spin are already in the samples, so the ball can finish
 * left or right of that line. Side spin bends the stroke off the start line
 * instead of tilting a straight segment. Camera height, distance, and field
 * of view are what change the arc's size. A landing-ground tap solves pitch,
 * and field of view only if pitch cannot reach, so the carry meets that height.
 */
export function projectFlight(
  samples: FlightSample[],
  camera: TracerCamera,
  ball: Pt,
  target: Pt,
  width: number,
  height: number,
  ground?: Pt | null,
): TracerPoint[] {
  if (samples.length < 2 || width < 2 || height < 2) return [];
  if (!ground || !Number.isFinite(ground.y)) {
    return projectMapped(samples, camera, cameraFrame(camera, ball.y), ball, target, width, height);
  }
  const solved = viewForGround(samples, camera, ball, target, width, height, ground.y);
  const tuned = { ...camera, fov: solved.fov };
  return projectMapped(samples, tuned, cameraFrame(tuned, ball.y, solved.pitch), ball, target, width, height);
}

export function defaultTracer(): TracerCalibration {
  return {
    ball: null,
    target: null,
    aimSuggested: false,
    ground: null,
    impactTime: null,
    cameraHeight: 1.4,
    cameraDistance: 3.5,
    fov: 60,
    locked: false,
    showAim: false,
    showTracer: true,
  };
}
