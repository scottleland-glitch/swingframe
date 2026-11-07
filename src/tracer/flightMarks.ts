import type { FlightMark, Pt } from '../types';
import { sampleAt, type FlightSample } from './flight';
import { projectFlight, type TracerCamera, type TracerPoint } from './project';

/** How many ball positions are marked in the air after impact. The ball at address is the first of three. */
export const FLIGHT_MARK_COUNT = 2;

export interface MarkAfterImpact {
  point: Pt;
  /** Seconds of video after impact. */
  elapsed: number;
}

/** Marks that come after impact, oldest first. A mark on or before impact says nothing about the flight. */
export function marksAfterImpact(marks: FlightMark[] | null | undefined, impact: number | null): MarkAfterImpact[] {
  if (!marks || impact == null || !Number.isFinite(impact)) return [];
  return marks
    .filter((mark) => Number.isFinite(mark.t) && Number.isFinite(mark.x) && Number.isFinite(mark.y) && mark.t - impact > 1e-3)
    .map((mark) => ({ point: { x: mark.x, y: mark.y }, elapsed: mark.t - impact }))
    .sort((a, b) => a.elapsed - b.elapsed);
}

/** A point on the line from the ball, a fixed distance away, at this screen angle. Only its direction matters. */
function aimAt(ball: Pt, angle: number, width: number, height: number): Pt {
  const reach = 0.3 * height;
  return { x: ball.x + (Math.cos(angle) * reach) / width, y: ball.y + (Math.sin(angle) * reach) / height };
}

/**
 * The aim direction that puts the modeled flight closest to the marked ball, at a fixed clock.
 * `seconds` is real flight time.
 */
export function fitAimToMarks(input: {
  samples: FlightSample[];
  camera: TracerCamera;
  ball: Pt;
  ground: Pt | null | undefined;
  width: number;
  height: number;
  marks: { point: Pt; seconds: number }[];
}): Pt | null {
  const fit = fitMarks({ ...input, marks: input.marks.map((mark) => ({ point: mark.point, elapsed: mark.seconds })), scale: 1, fixedScale: true });
  return fit ? fit.target : null;
}

function golden(lo: number, hi: number, cost: (x: number) => number, steps: number): { x: number; cost: number } {
  const g = (Math.sqrt(5) - 1) / 2;
  let a = hi - g * (hi - lo);
  let b = lo + g * (hi - lo);
  let ca = cost(a);
  let cb = cost(b);
  for (let i = 0; i < steps; i++) {
    if (ca <= cb) {
      hi = b;
      b = a;
      cb = ca;
      a = hi - g * (hi - lo);
      ca = cost(a);
    } else {
      lo = a;
      a = b;
      ca = cb;
      b = lo + g * (hi - lo);
      cb = cost(b);
    }
  }
  return ca <= cb ? { x: a, cost: ca } : { x: b, cost: cb };
}

/** Video seconds per real second the clip may run at: a little fast up to very slow motion. */
const SCALE_MIN = 0.5;
const SCALE_MAX = 40;

/**
 * The aim direction and the clip's speed that put the modeled flight on the marked ball.
 * `elapsed` is seconds of video after impact. `scale` is the clip's slow-motion setting, the starting guess.
 * The marks show both where the ball went and how fast it moved in this video, so a slow-motion clip
 * set to 1x, or the other way round, no longer leaves the line ahead of or behind the ball.
 * Launch numbers still set the height and the bend. The marks only turn the line and set its pace.
 */
export function fitMarks(input: {
  samples: FlightSample[];
  camera: TracerCamera;
  ball: Pt;
  ground: Pt | null | undefined;
  width: number;
  height: number;
  marks: { point: Pt; elapsed: number }[];
  scale: number;
  fixedScale?: boolean;
}): { target: Pt; scale: number } | null {
  const { samples, camera, ball, ground, width, height } = input;
  const marks = input.marks.filter((mark) => mark.elapsed > 0);
  if (samples.length < 2 || marks.length === 0 || width < 2 || height < 2) return null;
  const last = samples[samples.length - 1];
  const cost = (angle: number, scale: number): number => {
    // Only the moments that were marked, plus the landing so the horizon solve sees the real carry.
    const at = marks.map((mark) => sampleAt(samples, mark.elapsed / scale));
    // A mark the model says comes after landing cannot be matched at this pace.
    if (at.some((sample) => sample.t >= last.t - 1e-9)) return Infinity;
    const path = projectFlight([samples[0], ...at, last], camera, ball, aimAt(ball, angle, width, height), width, height, ground);
    if (path.length < 2) return Infinity;
    let sum = 0;
    for (let i = 0; i < marks.length; i++) {
      const point = path.find((p) => Math.abs(p.t - at[i].t) < 1e-9);
      if (!point) return Infinity;
      const dx = (point.x - marks[i].point.x) * width;
      const dy = (point.y - marks[i].point.y) * height;
      sum += dx * dx + dy * dy;
    }
    return sum;
  };
  const span = (Math.PI * 2) / 90;
  const bestAngle = (scale: number, around: number | null): { x: number; cost: number } => {
    let best = around ?? -Math.PI / 2;
    let bestCost = around == null ? Infinity : cost(around, scale);
    if (around == null) {
      for (let i = 0; i < 90; i++) {
        const angle = -Math.PI + i * span;
        const value = cost(angle, scale);
        if (value < bestCost) {
          bestCost = value;
          best = angle;
        }
      }
    }
    if (!Number.isFinite(bestCost)) return { x: best, cost: bestCost };
    const reach = around == null ? span : span * 4;
    const refined = golden(best - reach, best + reach, (angle) => cost(angle, scale), 24);
    return refined.cost <= bestCost ? refined : { x: best, cost: bestCost };
  };
  const start = Math.min(SCALE_MAX, Math.max(SCALE_MIN, input.scale > 0 ? input.scale : 1));
  let scale = start;
  let angle = bestAngle(scale, null);
  if (!input.fixedScale) {
    // The pace: every setting from a little fast to very slow, then refine. Most of the screen
    // position comes from the pace, the side-to-side from the aim, so a couple of rounds settle both.
    const logLo = Math.log(SCALE_MIN);
    const logHi = Math.log(SCALE_MAX);
    const paceCost = (log: number) => cost(angle.x, Math.exp(log));
    for (let round = 0; round < 3; round++) {
      let bestLog = Math.log(scale);
      let bestCost = paceCost(bestLog);
      const steps = 48;
      const width = (logHi - logLo) / steps;
      for (let i = 0; i <= steps; i++) {
        const log = logLo + i * width;
        const value = paceCost(log);
        if (value < bestCost) {
          bestCost = value;
          bestLog = log;
        }
      }
      const refined = golden(bestLog - width, bestLog + width, paceCost, 20);
      scale = Math.exp(refined.cost <= bestCost ? refined.x : bestLog);
      angle = bestAngle(scale, round === 0 ? null : angle.x);
    }
  }
  if (!Number.isFinite(angle.cost)) return null;
  return { target: aimAt(ball, angle.x, width, height), scale };
}

/** Monotone cubic through the knots (Fritsch-Carlson), so a correction never overshoots between marks. */
function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const u = (x - xs[i]) / h[i];
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[i] +
      (u3 - 2 * u2 + u) * h[i] * m[i] +
      (-2 * u3 + 3 * u2) * ys[i + 1] +
      (u3 - u2) * h[i] * m[i + 1]
    );
  };
}

/** The drawn line at `t`, between samples. */
export function pathPointAt(path: TracerPoint[], t: number): TracerPoint {
  if (t <= path[0].t) return path[0];
  const last = path[path.length - 1];
  if (t >= last.t) return last;
  for (let i = 1; i < path.length; i++) {
    const point = path[i];
    if (point.t < t) continue;
    const prev = path[i - 1];
    const span = point.t - prev.t || 1;
    const frac = Math.min(1, Math.max(0, (t - prev.t) / span));
    return { x: prev.x + (point.x - prev.x) * frac, y: prev.y + (point.y - prev.y) * frac, t };
  }
  return last;
}

/**
 * Bend the drawn line so it passes through each marked ball at the moment it was marked.
 * `t` on the marks is the same clock as the path. The correction is zero at the ball and grows
 * smoothly to each mark, then eases back to zero at the landing, so the horizon still holds.
 * A mark at or after the landing is left out.
 */
export function warpToMarks(path: TracerPoint[], marks: { point: Pt; t: number }[]): TracerPoint[] {
  if (path.length < 2 || marks.length === 0) return path;
  const end = path[path.length - 1].t;
  const knots: { t: number; dx: number; dy: number }[] = [{ t: path[0].t, dx: 0, dy: 0 }];
  for (const mark of [...marks].sort((a, b) => a.t - b.t)) {
    if (mark.t <= knots[knots.length - 1].t + 1e-4 || mark.t >= end - 1e-4) continue;
    const on = pathPointAt(path, mark.t);
    knots.push({ t: mark.t, dx: mark.point.x - on.x, dy: mark.point.y - on.y });
  }
  if (knots.length < 2) return path;
  knots.push({ t: end, dx: 0, dy: 0 });
  // Put a sample exactly on each mark so the line meets the ball there, not just near it.
  const times = knots.slice(1, -1).map((knot) => knot.t);
  const dense: TracerPoint[] = [];
  let next = 0;
  for (const point of path) {
    while (next < times.length && times[next] < point.t - 1e-9) {
      dense.push(pathPointAt(path, times[next]));
      next++;
    }
    if (next < times.length && Math.abs(times[next] - point.t) <= 1e-9) next++;
    dense.push(point);
  }
  const ts = knots.map((knot) => knot.t);
  const fx = pchip(ts, knots.map((knot) => knot.dx));
  const fy = pchip(ts, knots.map((knot) => knot.dy));
  return dense.map((point) => ({ x: point.x + fx(point.t), y: point.y + fy(point.t), t: point.t }));
}
