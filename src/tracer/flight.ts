import type { ShotData, ShotField } from '../types';

const BALL_MASS = 0.04593;
const BALL_RADIUS = 0.02135;
const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;
const AIR_DENSITY = 1.225;
const GRAVITY = 9.80665;
const MPH_TO_MPS = 0.44704;
const M_TO_YARDS = 1.0936133;
const M_TO_FEET = 3.2808399;

/**
 * Constant-coefficient drag plus Magnus lift.
 * Tuned so a 167 mph, 12° launch, 2600 rpm, straight shot carries about 282 yards
 * and apexes about 110 feet. This is not Foresight's ball model.
 */
const CD_BASE = 0.21;
const CD_SPIN = 0.2;
const CL_PER_S = 1.6;
const CL_MAX = 0.25;
const STEP = 0.005;

const MODEL_FIELDS: ShotField[] = ['spinAxis', 'sideSpin', 'carry', 'apex', 'curve'];

export interface FlightSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface FlightResult {
  carryYd: number;
  apexFt: number;
  curveYd: number;
  flightTime: number;
  samples: FlightSample[];
}

type V6 = [number, number, number, number, number, number];

export function emptyShot(): ShotData {
  return {
    ballSpeed: null,
    vla: null,
    hla: null,
    spin: null,
    spinAxis: null,
    sideSpin: null,
    carry: null,
    apex: null,
    curve: null,
    sources: {},
  };
}

function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function add(a: V6, b: V6, scale = 1): V6 {
  return [
    a[0] + scale * b[0],
    a[1] + scale * b[1],
    a[2] + scale * b[2],
    a[3] + scale * b[3],
    a[4] + scale * b[4],
    a[5] + scale * b[5],
  ];
}

function accel(s: V6, wx: number, wy: number, wz: number): V6 {
  const v = Math.hypot(s[3], s[4], s[5]);
  const w = Math.hypot(wx, wy, wz);
  let ax = 0;
  let ay = -GRAVITY;
  let az = 0;
  if (v > 0.5) {
    const spinRatio = (BALL_RADIUS * w) / v;
    const cd = CD_BASE + CD_SPIN * spinRatio;
    const cl = Math.min(CL_MAX, CL_PER_S * spinRatio);
    const drag = (0.5 * AIR_DENSITY * BALL_AREA * cd * v) / BALL_MASS;
    ax -= drag * s[3];
    ay -= drag * s[4];
    az -= drag * s[5];
    if (w > 1) {
      const cx = wy * s[5] - wz * s[4];
      const cy = wz * s[3] - wx * s[5];
      const cz = wx * s[4] - wy * s[3];
      const cm = Math.hypot(cx, cy, cz) || 1;
      const lift = (0.5 * AIR_DENSITY * BALL_AREA * cl * v * v) / BALL_MASS;
      ax += (lift * cx) / cm;
      ay += (lift * cy) / cm;
      az += (lift * cz) / cm;
    }
  }
  return [s[3], s[4], s[5], ax, ay, az];
}

function axisDegrees(shot: ShotData): number {
  if (shot.spinAxis != null) return shot.spinAxis;
  if (shot.spin != null && shot.sideSpin != null && Math.abs(shot.spin) > 1) {
    const ratio = Math.max(-1, Math.min(1, shot.sideSpin / shot.spin));
    return (Math.asin(ratio) * 180) / Math.PI;
  }
  return 0;
}

/** Integrate until the ball returns to the ground. Null when speed, launch, or spin is missing. */
export function simulateShot(shot: ShotData): FlightResult | null {
  if (shot.ballSpeed == null || shot.vla == null || shot.spin == null) return null;
  if (!(shot.ballSpeed > 0) || !Number.isFinite(shot.vla) || !Number.isFinite(shot.spin)) return null;

  const speed = shot.ballSpeed * MPH_TO_MPS;
  const vla = (shot.vla * Math.PI) / 180;
  const hla = ((shot.hla ?? 0) * Math.PI) / 180;
  const axis = (axisDegrees(shot) * Math.PI) / 180;
  const omega = (Math.max(0, shot.spin) * 2 * Math.PI) / 60;
  const wx = -omega * Math.cos(axis);
  const wy = omega * Math.sin(axis);
  const wz = 0;

  let state: V6 = [
    0,
    0,
    0,
    speed * Math.cos(vla) * Math.sin(hla),
    speed * Math.sin(vla),
    speed * Math.cos(vla) * Math.cos(hla),
  ];
  const samples: FlightSample[] = [{ t: 0, x: 0, y: 0, z: 0 }];
  let apex = 0;
  let t = 0;
  let since = 0;

  for (let i = 0; i < 4000; i++) {
    const a1 = accel(state, wx, wy, wz);
    const a2 = accel(add(state, a1, STEP / 2), wx, wy, wz);
    const a3 = accel(add(state, a2, STEP / 2), wx, wy, wz);
    const a4 = accel(add(state, a3, STEP), wx, wy, wz);
    const delta: V6 = [
      a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0],
      a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1],
      a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2],
      a1[3] + 2 * a2[3] + 2 * a3[3] + a4[3],
      a1[4] + 2 * a2[4] + 2 * a3[4] + a4[4],
      a1[5] + 2 * a2[5] + 2 * a3[5] + a4[5],
    ];
    const prev = state;
    state = add(state, delta, STEP / 6);
    t += STEP;
    since += STEP;
    if (state[1] > apex) apex = state[1];
    if (t > 0.05 && state[1] <= 0 && state[4] < 0) {
      const denom = prev[1] - state[1] || 1;
      const frac = prev[1] / denom;
      const x = prev[0] + (state[0] - prev[0]) * frac;
      const z = prev[2] + (state[2] - prev[2]) * frac;
      samples.push({ t, x, y: 0, z });
      return {
        carryYd: Math.hypot(x, z) * M_TO_YARDS,
        apexFt: apex * M_TO_FEET,
        curveYd: x * M_TO_YARDS,
        flightTime: t,
        samples,
      };
    }
    if (since >= 0.02) {
      samples.push({ t, x: state[0], y: state[1], z: state[2] });
      since = 0;
    }
    if (t > 12) break;
  }
  return null;
}

function clearModel(shot: ShotData, keep: ShotField | null) {
  for (const field of MODEL_FIELDS) {
    if (field === keep) continue;
    if (shot.sources[field] === 'model') {
      shot[field] = null;
      delete shot.sources[field];
    }
  }
}

/** Fill blank carry, apex, and curve. Measured and typed numbers stay as they are. */
export function completeShot(input: ShotData): ShotData {
  const shot: ShotData = { ...input, sources: { ...input.sources } };
  if (shot.spinAxis == null && shot.spin != null && shot.sideSpin != null && Math.abs(shot.spin) > 1) {
    const ratio = Math.max(-1, Math.min(1, shot.sideSpin / shot.spin));
    shot.spinAxis = roundTo((Math.asin(ratio) * 180) / Math.PI, 1);
    shot.sources.spinAxis = 'model';
  }
  if (shot.sideSpin == null && shot.spin != null && shot.spinAxis != null) {
    shot.sideSpin = roundTo(shot.spin * Math.sin((shot.spinAxis * Math.PI) / 180), 0);
    shot.sources.sideSpin = 'model';
  }
  const flight = simulateShot(shot);
  if (!flight) return shot;
  if (shot.carry == null) {
    shot.carry = roundTo(flight.carryYd, 1);
    shot.sources.carry = 'model';
  }
  if (shot.apex == null) {
    shot.apex = roundTo(flight.apexFt, 1);
    shot.sources.apex = 'model';
  }
  if (shot.curve == null) {
    shot.curve = roundTo(flight.curveYd, 1);
    shot.sources.curve = 'model';
  }
  return shot;
}

export function editShot(shot: ShotData, field: ShotField, value: number | null): ShotData {
  const next: ShotData = { ...shot, sources: { ...shot.sources }, [field]: value };
  if (value == null) delete next.sources[field];
  else next.sources[field] = 'typed';
  clearModel(next, field);
  return completeShot(next);
}

export function mergeScreen(prev: ShotData, parsed: ShotData): ShotData {
  const next: ShotData = { ...prev, sources: { ...prev.sources } };
  (Object.keys(parsed.sources) as ShotField[]).forEach((field) => {
    if (parsed.sources[field] === 'screen' && parsed[field] != null) {
      next[field] = parsed[field];
      next.sources[field] = 'screen';
    }
  });
  clearModel(next, null);
  return completeShot(next);
}
