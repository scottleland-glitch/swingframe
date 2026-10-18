import type { Pt } from '../types';
import { groundScreenY, type TracerCamera } from './project';

/** Toes and heels at address. Image coordinates, origin at the top left. */
export interface ToeLine {
  leftToe: Pt;
  rightToe: Pt;
  leftHeel: Pt;
  rightHeel: Pt;
}

export interface ParallelAim {
  point: Pt;
  toe: [Pt, Pt];
  parallel: [Pt, Pt];
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function clampPt(point: Pt): Pt {
  return { x: clamp(point.x, 0.02, 0.98), y: clamp(point.y, 0.02, 0.98) };
}

/**
 * Straight down the frame. The tripod already points at the target, so this
 * is the aim until the feet can move it. A landing-ground tap sets the depth.
 */
export function straightAheadAim(input: {
  ball: Pt | null;
  groundY: number | null;
  camera: TracerCamera;
  carryMeters: number;
}): Pt {
  let y: number;
  if (input.groundY != null && Number.isFinite(input.groundY)) y = input.groundY;
  else {
    y = groundScreenY(input.camera, input.ball?.y ?? 0.7, input.carryMeters);
    if (input.ball && y > input.ball.y - 0.08) y = input.ball.y - 0.16;
  }
  return { x: 0.5, y: clamp(y, 0.05, 0.95) };
}

/** Where two ground lines meet. Nearly parallel lines have no usable vanishing point. */
function vanishingPoint(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const scale = Math.hypot(abx, aby) * Math.hypot(cdx, cdy);
  const denom = abx * cdy - aby * cdx;
  if (scale < 1e-6 || Math.abs(denom) < scale * 0.04) return null;
  const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denom;
  const point = { x: a.x + t * abx, y: a.y + t * aby };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (Math.hypot(point.x, point.y) > 8) return null;
  return point;
}

/** A point on the line through `from` and `toward`, at a screen height. */
function pointAtDepth(from: Pt, toward: Pt, depthY: number): Pt | null {
  const dy = toward.y - from.y;
  const dx = toward.x - from.x;
  if (Math.hypot(dx, dy) < 1e-4) return null;
  if (Math.abs(dy) < 1e-3) return null;
  const t = (depthY - from.y) / dy;
  if (t <= 0.04 || t > 6) return null;
  const x = from.x + t * dx;
  if (x < -0.25 || x > 1.25) return null;
  const point = clampPt({ x, y: depthY });
  if (Math.hypot(point.x - from.x, point.y - from.y) < 0.04) return null;
  return point;
}

/**
 * The toe line and the heel line are parallel on the ground, so they meet at
 * one vanishing point. The aim line is the parallel through the ball, and the
 * reticle sits on it at the landing depth. If the two lines are already
 * parallel in the picture, the toe line's own direction is used.
 */
export function parallelAim(input: { ball: Pt; feet: ToeLine; depthY: number }): ParallelAim | null {
  const { ball, feet } = input;
  const depthY = clamp(input.depthY, 0.02, 0.98);
  const toeSpan = Math.hypot(feet.leftToe.x - feet.rightToe.x, feet.leftToe.y - feet.rightToe.y);
  const heelSpan = Math.hypot(feet.leftHeel.x - feet.rightHeel.x, feet.leftHeel.y - feet.rightHeel.y);
  if (toeSpan < 0.03 || heelSpan < 0.03) return null;

  const vanish = vanishingPoint(feet.leftToe, feet.rightToe, feet.leftHeel, feet.rightHeel);
  const toward = vanish ?? {
    x: ball.x + (feet.rightToe.x - feet.leftToe.x),
    y: ball.y + (feet.rightToe.y - feet.leftToe.y),
  };
  const point = pointAtDepth(ball, toward, depthY);
  if (!point) return null;
  const end = clampPt({
    x: ball.x + (point.x - ball.x) * 1.08,
    y: ball.y + (point.y - ball.y) * 1.08,
  });
  return {
    point,
    toe: [feet.leftToe, feet.rightToe],
    parallel: [ball, end],
  };
}
