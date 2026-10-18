import type { Pt, ShotShape } from '../types';
import type { TracerPoint } from './project';

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * First positions for apex and finish. Draw bows to the right and finishes
 * left of that bow. Fade is the mirror. Straight stays on the start line.
 * Dragging the circles after this replaces the bend.
 */
export function shapePoints(shape: ShotShape, start: Pt): { apex: Pt; finish: Pt } {
  const side = shape === 'draw' ? 1 : shape === 'fade' ? -1 : 0;
  const apexY = clamp(start.y - 0.34, 0.08, 0.62);
  const finishY = clamp(start.y - 0.18, apexY + 0.06, 0.82);
  return {
    apex: { x: clamp(start.x + side * 0.1, 0.06, 0.94), y: apexY },
    finish: { x: clamp(start.x - side * 0.05, 0.06, 0.94), y: finishY },
  };
}

/** Longer hang when the apex sits higher in the frame. A typical rise is about 6 seconds. */
export function manualHang(start: Pt, apex: Pt): number {
  const rise = Math.max(0, start.y - apex.y);
  return Math.min(8, Math.max(4, 4.2 + rise * 6));
}

/** Signed screen-x of the apex off the start-finish line. Positive is to the right. */
export function geometricBow(start: Pt, apex: Pt, finish: Pt): number {
  const dx = finish.x - start.x;
  const dy = finish.y - start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return apex.x - start.x;
  const t = ((apex.x - start.x) * dx + (apex.y - start.y) * dy) / len2;
  return apex.x - (start.x + t * dx);
}

function hermite(p0: number, p1: number, m0: number, m1: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

/** Reach the apex early, then accelerate into a steeper drop. */
function spatialProgress(timeFrac: number): number {
  const risePortion = 0.4;
  if (timeFrac <= 0) return 0;
  if (timeFrac >= 1) return 1;
  if (timeFrac <= risePortion) return 0.5 * (timeFrac / risePortion) ** 0.7;
  const u = (timeFrac - risePortion) / (1 - risePortion);
  return 0.5 + 0.5 * u ** 1.6;
}

/**
 * Screen path through start, apex, and finish. Those three taps set the bow.
 * Shape only adds a small sideways push between the taps when they are nearly in a line.
 */
export function manualTrace(start: Pt, apex: Pt, finish: Pt, shape: ShotShape = 'straight'): TracerPoint[] {
  const bow = geometricBow(start, apex, finish);
  const shapePush = shape === 'draw' ? 0.045 : shape === 'fade' ? -0.045 : 0;
  const ambiguity = Math.max(0, 1 - Math.abs(bow) / 0.05);
  const push = shapePush * ambiguity;

  const mSx = (apex.x - start.x) * 0.7;
  const mSy = (apex.y - start.y) * 1.05;
  const mAx = (finish.x - apex.x) * 0.55;
  const mAy = 0;
  const mFx = (finish.x - apex.x) * 0.22;
  const mFy = (finish.y - apex.y) * 1.35;

  const at = (s: number): Pt => {
    if (s <= 0) return start;
    if (s >= 1) return finish;
    const u = s <= 0.5 ? s / 0.5 : (s - 0.5) / 0.5;
    const x =
      s <= 0.5
        ? hermite(start.x, apex.x, mSx, mAx, u)
        : hermite(apex.x, finish.x, mAx, mFx, u);
    const y =
      s <= 0.5
        ? hermite(start.y, apex.y, mSy, mAy, u)
        : hermite(apex.y, finish.y, mAy, mFy, u);
    return { x: x + push * Math.sin(Math.PI * u), y };
  };

  const hang = manualHang(start, apex);
  const steps = 48;
  const apexIndex = Math.round(0.4 * steps);
  const points: TracerPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const timeFrac = i / steps;
    const point = i === 0 ? start : i === steps ? finish : i === apexIndex ? apex : at(spatialProgress(timeFrac));
    points.push({ x: point.x, y: point.y, t: timeFrac * hang });
  }
  return points;
}
