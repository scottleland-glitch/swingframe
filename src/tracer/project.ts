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

/** Launch direction off the aim line, from the first step that has actually left the tee. */
function launchHeading(samples: FlightSample[]): number {
  for (const sample of samples) {
    if (sample.z > 0.05) return Math.atan2(sample.x, sample.z);
  }
  return 0;
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

interface AimTurn {
  cos: number;
  sin: number;
  ox: number;
  oy: number;
}

/**
 * Turn the picture so world +Z lies on the line from the ball to the aim point.
 * That line is the intended line. Nothing about the shot — launch, spin, or
 * where it lands — changes this turn.
 */
function aimTurn(frame: Frame, ball: Pt, target: Pt, width: number, height: number): AimTurn | null {
  const origin = projectRaw({ t: 0, x: 0, y: 0, z: 0 }, frame, width, height);
  if (!origin) return null;
  let aim: { x: number; y: number } | null = null;
  for (const z of [40, 100, 200]) {
    const pixel = projectRaw({ t: 0, x: 0, y: 0, z }, frame, width, height);
    if (!pixel) continue;
    if (Math.hypot(pixel.x - origin.x, pixel.y - origin.y) > 8) {
      aim = pixel;
      break;
    }
  }
  const projX = (aim?.x ?? origin.x) - origin.x;
  const projY = (aim?.y ?? origin.y) - origin.y;
  const wantX = target.x * width - ball.x * width;
  const wantY = target.y * height - ball.y * height;
  let cos = 1;
  let sin = 0;
  if (Math.hypot(projX, projY) > 4 && Math.hypot(wantX, wantY) > 4) {
    const turn = Math.atan2(wantY, wantX) - Math.atan2(projY, projX);
    cos = Math.cos(turn);
    sin = Math.sin(turn);
  }
  return { cos, sin, ox: origin.x, oy: origin.y };
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
  const turn = aimTurn(frame, ball, target, width, height);
  if (!turn) return [];
  const ballX = ball.x * width;
  const ballY = ball.y * height;
  const heading = launchHeading(samples);
  const headCos = Math.cos(heading);
  const headSin = Math.sin(heading);
  // Pixels of picture per meter off the launch line. The landing sits at its
  // real horizontal angle. Earlier points take the same scale, so the offset
  // follows the world curve instead of the airborne radius. That radius
  // shrinks on the way down and was pulling a fade back toward center.
  let curveScale = 0;
  if (camera.view === 'dtl') {
    const last = samples[samples.length - 1];
    const endPixel = projectRaw({ ...last, x: 0 }, frame, width, height);
    if (endPixel) {
      const endX = (endPixel.x - turn.ox) * turn.cos - (endPixel.y - turn.oy) * turn.sin;
      const endY = (endPixel.x - turn.ox) * turn.sin + (endPixel.y - turn.oy) * turn.cos;
      const radius = Math.hypot(endX * headCos - endY * headSin, endX * headSin + endY * headCos);
      const delta = Math.atan2(last.x, Math.max(last.z, 1e-6)) - heading;
      const endSide = last.x * headCos - last.z * headSin;
      if (radius > 1 && Math.abs(endSide) > 0.02 && Math.abs(delta) < 1.2) {
        curveScale = (radius * Math.tan(delta)) / endSide;
      }
    }
  }
  const path: TracerPoint[] = [];
  for (const sample of samples) {
    // Down the line, height is the ball kept over the aim line, then turned
    // onto the launch direction. Spin is the distance off that line. It is
    // not solved so the stroke can pass through the aim point or the horizon.
    // Face on keeps a plain projection of the real sample.
    const source = camera.view === 'dtl' ? { ...sample, x: 0 } : sample;
    const pixel = projectRaw(source, frame, width, height);
    if (!pixel) continue;
    const rawX = pixel.x - turn.ox;
    const rawY = pixel.y - turn.oy;
    const aimedX = rawX * turn.cos - rawY * turn.sin;
    const aimedY = rawX * turn.sin + rawY * turn.cos;
    let px = aimedX;
    let py = aimedY;
    if (camera.view === 'dtl') {
      px = aimedX * headCos - aimedY * headSin;
      py = aimedX * headSin + aimedY * headCos;
      const len = Math.hypot(px, py);
      const sideways = sample.x * headCos - sample.z * headSin;
      if (len > 1 && curveScale !== 0 && sideways !== 0) {
        const off = curveScale * sideways;
        const rx = -py / len;
        const ry = px / len;
        px += rx * off;
        py += ry * off;
      }
    }
    path.push({ x: (ballX + px) / width, y: (ballY + py) / height, t: sample.t });
  }
  return path.length >= 2 ? path : [];
}

interface GroundView {
  pitch: number;
  fov: number;
}

/**
 * Camera pitch, then field of view, so the ground straight ahead at the carry
 * distance sits on the tapped screen height. The tap's sideways position is
 * not used, and neither is the ball's actual sideways finish. Pitch is enough
 * when that ground point needs to move up the frame. A hillside asks for the
 * opposite, and pitch bottoms out, so the field of view then scales the ground.
 * The sliders stay what Scott set; this is only the picture.
 */
function viewForGround(
  carryZ: number,
  camera: TracerCamera,
  ball: Pt,
  target: Pt,
  width: number,
  height: number,
  groundY: number,
): GroundView {
  const targetY = Math.min(0.98, Math.max(0.02, groundY));
  const straight: FlightSample[] = [
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 1, x: 0, y: 0, z: Math.max(5, carryZ) },
  ];
  const yAt = (phi: number, fov: number): number | null => {
    const tuned = { ...camera, fov };
    const path = projectMapped(straight, tuned, cameraFrame(tuned, ball.y, phi), ball, target, width, height);
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
  if (pitched.err <= 0.004) return { pitch: pitched.value, fov: camera.fov };
  const opened = refine(15, 110, (fov) => yAt(pitched.value, fov), camera.fov);
  return { pitch: pitched.value, fov: opened.err < pitched.err ? opened.value : camera.fov };
}

/**
 * Project the flight. The aim tap is the line from the ball to the aim point,
 * and that is the only camera yaw. Launch direction is degrees off that line:
 * a 2° left launch leaves 2° left of it, whatever the spin axis is. Spin only
 * changes the angle after that, and that bend keeps growing through the
 * descent instead of hooking back toward the line. The landing is the last
 * sample. It is not pulled onto the aim point or the landing pin. A landing
 * tap solves pitch, and field of view only if pitch cannot reach, so the
 * ground straight ahead at the carry distance meets that height. A known
 * yardage flag passes its own distance instead of the carry. The pin's
 * sideways position is ignored.
 */
export function projectFlight(
  samples: FlightSample[],
  camera: TracerCamera,
  ball: Pt,
  target: Pt,
  width: number,
  height: number,
  ground?: Pt | null,
  depthMeters?: number | null,
): TracerPoint[] {
  if (samples.length < 2 || width < 2 || height < 2) return [];
  const carry = samples[samples.length - 1]?.z ?? 0;
  const depth = depthMeters != null && depthMeters > 1 ? depthMeters : carry;
  if (!ground || !Number.isFinite(ground.y) || !(depth > 1)) {
    return projectMapped(samples, camera, cameraFrame(camera, ball.y), ball, target, width, height);
  }
  const solved = viewForGround(depth, camera, ball, target, width, height, ground.y);
  const tuned = { ...camera, fov: solved.fov };
  return projectMapped(samples, tuned, cameraFrame(tuned, ball.y, solved.pitch), ball, target, width, height);
}

export function defaultTracer(): TracerCalibration {
  return {
    ball: null,
    target: null,
    aimSuggested: false,
    ground: null,
    referenceYards: null,
    impactTime: null,
    cameraHeight: 1.4,
    cameraDistance: 3.5,
    fov: 60,
    locked: false,
    showAim: false,
    showTracer: true,
    shape: null,
    manualStart: null,
    manualApex: null,
    manualFinish: null,
    setupDone: false,
  };
}
