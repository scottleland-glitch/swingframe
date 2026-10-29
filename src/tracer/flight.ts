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
 * Drag grows with spin and lift saturates, with a fairly quick spin decay. Fit to Trackman-style tour averages:
 * a 167 mph, 11°, 2700 rpm driver carries about 275 yards, peaks near 105 feet and lands near 40°, with the
 * apex about two thirds of the way down range. A 7-iron carries about 170 and a pitching wedge about 130 and
 * lands steeper, so the wedge is closer to symmetric. Ten degrees of spin axis curves the driver about 22
 * yards, a 7-iron about 14, and a wedge about 8. This is not Foresight's ball model.
 */
const CD_BASE = 0.1974;
const CD_SPIN = 0.4054;
const CL_PER_S = 1.968;
const CL_MAX = 0.3128;
/**
 * Extra sideways lift while the lift coefficient is still climbing with spin.
 * Driver spin sits on that slope, and a pure split of the Magnus force then
 * curves only about 16 yards at 10° of axis. Trackman-style numbers are about
 * 2 to 2.5 yards per degree at driver distance. Irons and wedges are already
 * at the lift cap, so the factor fades to 1 and their curve is unchanged.
 */
const SIDE_EXTRA = 0.34;
const STEP = 0.005;
/** Spin eases off over the flight so hang time stays in a real range. */
const SPIN_TAU = 6.4;

/**
 * Calculated results only. Launch direction and spin axis are filled from club path and face angle
 * (a center strike), and only while the golfer has not typed or read them.
 */
const MODEL_FIELDS: ShotField[] = ['carry', 'apex', 'curve', 'hla', 'spinAxis'];

/**
 * D-plane for a center strike, so there is no gear effect. Path and face are degrees from the aim line,
 * negative left and positive right. The ball starts mostly where the face points, a little along the path,
 * and the spin axis tilts by the face-to-path difference over the dynamic loft.
 */
export function dPlane(path: number, face: number, vla: number): { hla: number; spinAxis: number } {
  const faceWeight = Math.min(0.85, Math.max(0.72, 0.85 - 0.0058 * Math.max(0, vla - 12)));
  const hla = faceWeight * face + (1 - faceWeight) * path;
  const loft = Math.max(4, vla / 0.78) * (Math.PI / 180);
  const faceToPath = ((face - path) * Math.PI) / 180;
  const spinAxis = (Math.atan(Math.sin(faceToPath) / Math.tan(loft)) * 180) / Math.PI;
  return { hla: roundTo(hla, 1), spinAxis: roundTo(spinAxis, 1) };
}

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
    clubPath: null,
    faceToTarget: null,
    faceToPath: null,
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
      const rawCl = CL_PER_S * spinRatio;
      const cl = Math.min(CL_MAX, rawCl);
      const side = 1 + SIDE_EXTRA * Math.max(0, 1 - rawCl / CL_MAX);
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
        ax += (side * lift * cx) / cm;
        ay += (lift * cy) / cm;
        az += (lift * cz) / cm;
      }
  }
  return [s[3], s[4], s[5], ax, ay, az];
}

function axisDegrees(shot: ShotData): number {
  return shot.spinAxis ?? 0;
}

/**
 * World position at `elapsed` seconds. At the end of the flight this is the ground crossing, height 0.
 * The club name is not an input. Only ball speed, launch angle, spin, spin axis, and launch direction are.
 */
export function sampleAt(samples: FlightSample[], elapsed: number): FlightSample {
  if (samples.length === 0) return { t: 0, x: 0, y: 0, z: 0 };
  const last = samples[samples.length - 1];
  if (!(elapsed > 0)) return samples[0];
  if (elapsed >= last.t) return last;
  for (let i = 1; i < samples.length; i++) {
    const point = samples[i];
    if (point.t < elapsed) continue;
    const prev = samples[i - 1];
    const span = point.t - prev.t || 1;
    const frac = Math.min(1, Math.max(0, (elapsed - prev.t) / span));
    return {
      t: elapsed,
      x: prev.x + (point.x - prev.x) * frac,
      y: prev.y + (point.y - prev.y) * frac,
      z: prev.z + (point.z - prev.z) * frac,
    };
  }
  return last;
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
  // The spin axis is tilted from level, measured across the launch direction. Backspin is level and square to
  // the start line, so it turns with the launch direction. A fixed world axis leaks gyro spin into every shot
  // that does not start dead on the aim line, and that pushes the ball sideways with no spin axis at all.
  let wx = -omega * Math.cos(axis) * Math.cos(hla);
  let wy = omega * Math.sin(axis);
  let wz = omega * Math.cos(axis) * Math.sin(hla);
  const spinDecay = Math.exp(-STEP / SPIN_TAU);

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
      const drop = prev[1] - state[1];
      const frac = drop !== 0 ? Math.min(1, Math.max(0, prev[1] / drop)) : 1;
      // The step has already gone underground. The landing is the crossing inside this step, at height 0.
      const tLand = t - STEP + frac * STEP;
      const x = prev[0] + (state[0] - prev[0]) * frac;
      const z = prev[2] + (state[2] - prev[2]) * frac;
      samples.push({ t: tLand, x, y: 0, z });
      return {
        carryYd: Math.hypot(x, z) * M_TO_YARDS,
        apexFt: apex * M_TO_FEET,
        curveYd: x * M_TO_YARDS,
        flightTime: tLand,
        samples,
      };
    }
    if (since >= 0.02) {
      samples.push({ t, x: state[0], y: state[1], z: state[2] });
      since = 0;
    }
    wx *= spinDecay;
    wy *= spinDecay;
    wz *= spinDecay;
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

/**
 * Fill blank carry, apex, and curve from the flight.
 * The flight itself uses only ball speed, launch angle, total spin, spin axis, and launch direction.
 * A stored launch direction or spin axis is kept, including on older swings. Club path, face angles, and side spin are ignored.
 */
export function completeShot(input: ShotData): ShotData {
  const shot: ShotData = { ...input, sources: { ...input.sources } };
  if (shot.clubPath != null && shot.faceToTarget != null && shot.vla != null) {
    const plane = dPlane(shot.clubPath, shot.faceToTarget, shot.vla);
    if (shot.hla == null) {
      shot.hla = plane.hla;
      shot.sources.hla = 'model';
    }
    if (shot.spinAxis == null) {
      shot.spinAxis = plane.spinAxis;
      shot.sources.spinAxis = 'model';
    }
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
