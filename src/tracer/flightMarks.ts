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
 * The aim direction that puts the modeled flight closest to the marked ball.
 * Launch numbers still set the height and the bend. The marks only turn the line, so it leaves
 * along the ball's real start line instead of a guessed aim point. `seconds` is real flight time.
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
  const { samples, camera, ball, ground, width, height } = input;
  const marks = input.marks.filter((mark) => mark.seconds > 0);
  if (samples.length < 2 || marks.length === 0 || width < 2 || height < 2) return null;
  // Only the moments that were marked, plus the landing so the horizon solve sees the real carry.
  const at = marks.map((mark) => sampleAt(samples, mark.seconds));
  const sub: FlightSample[] = [samples[0], ...at, samples[samples.length - 1]];
  const cost = (angle: number): number => {
    const path = projectFlight(sub, camera, ball, aimAt(ball, angle, width, height), width, height, ground);
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
  const steps = 90;
  const span = (Math.PI * 2) / steps;
  let best = -Math.PI / 2;
  let bestCost = Infinity;
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI + i * span;
    const value = cost(angle);
    if (value < bestCost) {
      bestCost = value;
      best = angle;
    }
  }
  if (!Number.isFinite(bestCost)) return null;
  // Golden-section search inside the best slice and its neighbours.
  let lo = best - span;
  let hi = best + span;
  const golden = (Math.sqrt(5) - 1) / 2;
  let a = hi - golden * (hi - lo);
  let b = lo + golden * (hi - lo);
  let costA = cost(a);
  let costB = cost(b);
  for (let i = 0; i < 28; i++) {
    if (costA <= costB) {
      hi = b;
      b = a;
      costB = costA;
      a = hi - golden * (hi - lo);
      costA = cost(a);
    } else {
      lo = a;
      a = b;
      costA = costB;
      b = lo + golden * (hi - lo);
      costB = cost(b);
    }
  }
  const refined = costA <= costB ? a : b;
  const refinedCost = Math.min(costA, costB);
  return aimAt(ball, refinedCost <= bestCost ? refined : best, width, height);
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
