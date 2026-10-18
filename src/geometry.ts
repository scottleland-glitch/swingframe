import type { Drawing, Pt } from './types';

export const HANDLE_PX = 24;
export const BODY_PX = 18;

export type HandleName = 'a' | 'b' | 'v' | 'c' | 'r' | 'nw' | 'ne' | 'sw' | 'se';

export type Hit = { id: string; part: 'body' | HandleName };

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function pxDist(a: Pt, b: Pt, w: number, h: number): number {
  return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
}

function toPx(p: Pt, w: number, h: number): Pt {
  return { x: p.x * w, y: p.y * h };
}

/** Unsigned angle between the vectors, in degrees, measured in pixel space. */
export function angleDegrees(a: Pt, v: Pt, b: Pt, w: number, h: number): number {
  const ax = (a.x - v.x) * w;
  const ay = (a.y - v.y) * h;
  const bx = (b.x - v.x) * w;
  const by = (b.y - v.y) * h;
  if (Math.hypot(ax, ay) < 1e-4 || Math.hypot(bx, by) < 1e-4) return 0;
  const dot = ax * bx + ay * by;
  const cross = ax * by - ay * bx;
  const deg = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
  return Number.isFinite(deg) ? deg : 0;
}

/** Canvas arc from the first ray toward the second, using the minor sweep. */
export function angleArc(
  a: Pt,
  v: Pt,
  b: Pt,
  w: number,
  h: number,
): { start: number; sweep: number } | null {
  const ax = (a.x - v.x) * w;
  const ay = (a.y - v.y) * h;
  const bx = (b.x - v.x) * w;
  const by = (b.y - v.y) * h;
  if (Math.hypot(ax, ay) < 1 || Math.hypot(bx, by) < 1) return null;
  const start = Math.atan2(ay, ax);
  const end = Math.atan2(by, bx);
  let sweep = end - start;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  return { start, sweep };
}

function within(v: number, max: number): boolean {
  return v >= -0.75 && v <= max + 0.75;
}

/** Extend a segment to the rectangle edges. Coordinates are pixels. */
export function extendLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  h: number,
): [Pt, Pt] | null {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.hypot(dx, dy) < 0.001) return null;
  const pts: Pt[] = [];
  if (Math.abs(dx) > 1e-8) {
    const yLeft = ay + ((0 - ax) / dx) * dy;
    if (within(yLeft, h)) pts.push({ x: 0, y: yLeft });
    const yRight = ay + ((w - ax) / dx) * dy;
    if (within(yRight, h)) pts.push({ x: w, y: yRight });
  }
  if (Math.abs(dy) > 1e-8) {
    const xTop = ax + ((0 - ay) / dy) * dx;
    if (within(xTop, w)) pts.push({ x: xTop, y: 0 });
    const xBot = ax + ((h - ay) / dy) * dx;
    if (within(xBot, w)) pts.push({ x: xBot, y: h });
  }
  if (pts.length < 2) return null;
  let best: [Pt, Pt] = [pts[0], pts[1]];
  let bestD = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d > bestD) {
        bestD = d;
        best = [pts[i], pts[j]];
      }
    }
  }
  return best;
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function near(px: number, py: number, qx: number, qy: number, dist = HANDLE_PX): boolean {
  return Math.hypot(px - qx, py - qy) <= dist;
}

function handlesOf(d: Drawing, w: number, h: number): { name: HandleName; x: number; y: number }[] {
  switch (d.type) {
    case 'line': {
      const a = toPx(d.a, w, h);
      const b = toPx(d.b, w, h);
      return [
        { name: 'a', x: a.x, y: a.y },
        { name: 'b', x: b.x, y: b.y },
      ];
    }
    case 'angle': {
      const a = toPx(d.a, w, h);
      const v = toPx(d.v, w, h);
      const b = toPx(d.b, w, h);
      return [
        { name: 'a', x: a.x, y: a.y },
        { name: 'v', x: v.x, y: v.y },
        { name: 'b', x: b.x, y: b.y },
      ];
    }
    case 'circle': {
      const c = toPx(d.c, w, h);
      const r = d.r * w;
      return [
        { name: 'c', x: c.x, y: c.y },
        { name: 'r', x: c.x + r, y: c.y },
      ];
    }
    case 'box': {
      const frame = boxFrame(d, w, h);
      const names: HandleName[] = ['nw', 'ne', 'sw', 'se'];
      return frame.corners.map((corner, i) => ({ name: names[i], x: corner.x, y: corner.y }));
    }
    default:
      return [];
  }
}

function bodyHit(d: Drawing, px: number, py: number, w: number, h: number): boolean {
  switch (d.type) {
    case 'line': {
      const a = toPx(d.a, w, h);
      const b = toPx(d.b, w, h);
      const ext = extendLine(a.x, a.y, b.x, b.y, w, h);
      if (ext && distToSeg(px, py, ext[0].x, ext[0].y, ext[1].x, ext[1].y) <= BODY_PX) return true;
      return distToSeg(px, py, a.x, a.y, b.x, b.y) <= BODY_PX;
    }
    case 'pen': {
      const pts = d.points.map((p) => toPx(p, w, h));
      if (pts.length === 1) return near(px, py, pts[0].x, pts[0].y, BODY_PX);
      for (let i = 1; i < pts.length; i++) {
        if (distToSeg(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= BODY_PX) return true;
      }
      return false;
    }
    case 'angle': {
      const a = toPx(d.a, w, h);
      const v = toPx(d.v, w, h);
      const b = toPx(d.b, w, h);
      return (
        distToSeg(px, py, a.x, a.y, v.x, v.y) <= BODY_PX ||
        distToSeg(px, py, v.x, v.y, b.x, b.y) <= BODY_PX
      );
    }
    case 'circle': {
      const c = toPx(d.c, w, h);
      const r = d.r * w;
      return Math.hypot(px - c.x, py - c.y) <= r + BODY_PX;
    }
    case 'box': {
      const frame = boxFrame(d, w, h);
      const dx = px - frame.cx;
      const dy = py - frame.cy;
      const cos = Math.cos(-frame.rot);
      const sin = Math.sin(-frame.rot);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return Math.abs(lx) <= frame.bw / 2 + BODY_PX && Math.abs(ly) <= frame.bh / 2 + BODY_PX;
    }
    case 'hline':
      return Math.abs(py - d.y * h) <= BODY_PX;
    case 'vline':
      return Math.abs(px - d.x * w) <= BODY_PX;
    default:
      return false;
  }
}

export function hitTest(
  drawings: Drawing[],
  p: Pt,
  w: number,
  h: number,
  selectedId: string | null,
): Hit | null {
  const px = p.x * w;
  const py = p.y * h;
  if (selectedId) {
    const sel = drawings.find((d) => d.id === selectedId);
    if (sel) {
      for (const handle of handlesOf(sel, w, h)) {
        if (near(px, py, handle.x, handle.y)) return { id: sel.id, part: handle.name };
      }
    }
  }
  for (let i = drawings.length - 1; i >= 0; i--) {
    if (bodyHit(drawings[i], px, py, w, h)) return { id: drawings[i].id, part: 'body' };
  }
  return null;
}

export function clampPt(p: Pt): Pt {
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

/** Each finger is one end of the plane line. */
export function lineFromFingers(a: Pt, b: Pt): { a: Pt; b: Pt } {
  return { a: clampPt(a), b: clampPt(b) };
}

/** Center is the midpoint. Radius is half the distance, as a fraction of width. */
export function circleFromFingers(a: Pt, b: Pt, w: number, h: number): { c: Pt; r: number } {
  const c = clampPt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const r = pxDist(a, b, w, h) / 2 / Math.max(w, 1);
  return { c, r: Math.max(0.004, r) };
}

/** The two fingers are opposite corners. */
export function boxFromFingers(a: Pt, b: Pt): { x: number; y: number; w: number; h: number } {
  const left = clamp(Math.min(a.x, b.x), 0, 1);
  const top = clamp(Math.min(a.y, b.y), 0, 1);
  const right = clamp(Math.max(a.x, b.x), 0, 1);
  const bottom = clamp(Math.max(a.y, b.y), 0, 1);
  return { x: left, y: top, w: Math.max(0.004, right - left), h: Math.max(0.004, bottom - top) };
}

/** The joint sits halfway between the fingers. Each finger is the end of an arm. */
export function angleFromFingers(a: Pt, b: Pt): { a: Pt; v: Pt; b: Pt } {
  const v = clampPt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return { a: clampPt(a), v, b: clampPt(b) };
}

function mapPoint(p: Pt, pivot: Pt, scale: number, rot: number, dx: number, dy: number, w: number, h: number): Pt {
  const px = (p.x - pivot.x) * w;
  const py = (p.y - pivot.y) * h;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const rx = (px * cos - py * sin) * scale;
  const ry = (px * sin + py * cos) * scale;
  return { x: pivot.x + dx + rx / Math.max(w, 1), y: pivot.y + dy + ry / Math.max(h, 1) };
}

/** Pinch, twist, and drag. Scale and rotation are around the pivot, then the pivot shifts by dx/dy. */
export function transformDrawing(
  d: Drawing,
  pivot: Pt,
  scale: number,
  rot: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
): Drawing {
  const safeScale = clamp(scale, 0.15, 8);
  const map = (p: Pt) => mapPoint(p, pivot, safeScale, rot, dx, dy, w, h);
  switch (d.type) {
    case 'line':
      return { ...d, a: map(d.a), b: map(d.b) };
    case 'pen':
      return { ...d, points: d.points.map(map) };
    case 'angle':
      return { ...d, a: map(d.a), v: map(d.v), b: map(d.b) };
    case 'circle':
      return { ...d, c: map(d.c), r: Math.max(0.004, d.r * safeScale) };
    case 'box': {
      const c = map({ x: d.x + d.w / 2, y: d.y + d.h / 2 });
      const nw = Math.max(0.004, d.w * safeScale);
      const nh = Math.max(0.004, d.h * safeScale);
      return { ...d, x: c.x - nw / 2, y: c.y - nh / 2, w: nw, h: nh, rot: (d.rot ?? 0) + rot };
    }
    case 'hline':
      return { ...d, y: clamp(d.y + dy, 0, 1) };
    case 'vline':
      return { ...d, x: clamp(d.x + dx, 0, 1) };
    default: {
      const never: never = d;
      return never;
    }
  }
}

export function boxFrame(d: Extract<Drawing, { type: 'box' }>, w: number, h: number) {
  const cx = (d.x + d.w / 2) * w;
  const cy = (d.y + d.h / 2) * h;
  const bw = d.w * w;
  const bh = d.h * h;
  const rot = d.rot ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const local: [number, number][] = [
    [-bw / 2, -bh / 2],
    [bw / 2, -bh / 2],
    [-bw / 2, bh / 2],
    [bw / 2, bh / 2],
  ];
  const corners = local.map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
  return { cx, cy, bw, bh, rot, corners };
}

export function translateDrawing(d: Drawing, dx: number, dy: number): Drawing {
  const add = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  switch (d.type) {
    case 'line':
      return { ...d, a: add(d.a), b: add(d.b) };
    case 'pen':
      return { ...d, points: d.points.map(add) };
    case 'angle':
      return { ...d, a: add(d.a), v: add(d.v), b: add(d.b) };
    case 'circle':
      return { ...d, c: add(d.c) };
    case 'box':
      return { ...d, x: d.x + dx, y: d.y + dy };
    case 'hline':
      return { ...d, y: clamp(d.y + dy, 0, 1) };
    case 'vline':
      return { ...d, x: clamp(d.x + dx, 0, 1) };
    default: {
      const never: never = d;
      return never;
    }
  }
}

function normBox(x1: number, y1: number, x2: number, y2: number) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function applyHandle(d: Drawing, handle: HandleName, p: Pt, w: number, h: number): Drawing {
  switch (d.type) {
    case 'line':
      if (handle === 'a') return { ...d, a: p };
      if (handle === 'b') return { ...d, b: p };
      return d;
    case 'angle':
      if (handle === 'a') return { ...d, a: p };
      if (handle === 'v') return { ...d, v: p };
      if (handle === 'b') return { ...d, b: p };
      return d;
    case 'circle': {
      if (handle === 'c') return { ...d, c: p };
      if (handle === 'r') {
        const rPx = Math.hypot((p.x - d.c.x) * w, (p.y - d.c.y) * h);
        return { ...d, r: Math.max(0.004, rPx / Math.max(w, 1)) };
      }
      return d;
    }
    case 'box': {
      if (d.rot) {
        const frame = boxFrame(d, w, h);
        const dx = p.x * w - frame.cx;
        const dy = p.y * h - frame.cy;
        const cos = Math.cos(-frame.rot);
        const sin = Math.sin(-frame.rot);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        const hw = Math.max(2, Math.abs(lx));
        const hh = Math.max(2, Math.abs(ly));
        const nw = Math.max(0.004, (hw * 2) / Math.max(w, 1));
        const nh = Math.max(0.004, (hh * 2) / Math.max(h, 1));
        const cx = d.x + d.w / 2;
        const cy = d.y + d.h / 2;
        return { ...d, x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
      }
      const x2 = d.x + d.w;
      const y2 = d.y + d.h;
      let left = d.x;
      let top = d.y;
      let right = x2;
      let bottom = y2;
      if (handle === 'nw' || handle === 'sw') left = p.x;
      if (handle === 'ne' || handle === 'se') right = p.x;
      if (handle === 'nw' || handle === 'ne') top = p.y;
      if (handle === 'sw' || handle === 'se') bottom = p.y;
      const box = normBox(left, top, right, bottom);
      return { ...d, ...box, w: Math.max(box.w, 0.004), h: Math.max(box.h, 0.004) };
    }
    default:
      return d;
  }
}

export function withColor(d: Drawing, color: string): Drawing {
  switch (d.type) {
    case 'line':
      return { ...d, color };
    case 'pen':
      return { ...d, color };
    case 'angle':
      return { ...d, color };
    case 'circle':
      return { ...d, color };
    case 'box':
      return { ...d, color };
    case 'hline':
      return { ...d, color };
    case 'vline':
      return { ...d, color };
    default: {
      const never: never = d;
      return never;
    }
  }
}
