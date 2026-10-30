import { angleArc, angleDegrees, boxFrame, extendLine, lineLean } from './geometry';
import type { Drawing, Pt } from './types';

function hexToRgba(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return `rgba(255,255,255,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function strokeInk(ctx: CanvasRenderingContext2D, color: string, width: number, dashed = false) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashed ? [7, 6] : []);
  ctx.strokeStyle = 'rgba(0,0,0,0.72)';
  ctx.lineWidth = width + 2.6;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function handleDot(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#111111';
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, radius + 1.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function paintAngleLabel(
  ctx: CanvasRenderingContext2D,
  a: Pt,
  v: Pt,
  b: Pt,
  color: string,
  w: number,
  h: number,
) {
  const arc = angleArc(a, v, b, w, h);
  if (!arc) return;
  const vx = v.x * w;
  const vy = v.y * h;
  ctx.beginPath();
  ctx.arc(vx, vy, 26, arc.start, arc.start + arc.sweep, arc.sweep < 0);
  strokeInk(ctx, color, 1.6);

  const deg = angleDegrees(a, v, b, w, h);
  const label = `${deg.toFixed(1)}°`;
  const bis = arc.start + arc.sweep / 2;
  let lx = vx + Math.cos(bis) * 44;
  let ly = vy + Math.sin(bis) * 44;
  ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const tw = ctx.measureText(label).width;
  lx = Math.min(w - tw / 2 - 8, Math.max(tw / 2 + 8, lx));
  ly = Math.min(h - 14, Math.max(14, ly));
  roundedRect(ctx, lx - tw / 2 - 7, ly - 11, tw + 14, 22, 7);
  ctx.fillStyle = 'rgba(8,12,10,0.82)';
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly);
}

let measureCtx: CanvasRenderingContext2D | null = null;
const LABEL_FONT = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Where a line's angle readout sits, as a box in pixels. */
function lineLabelLayout(
  d: Extract<Drawing, { type: 'line' }>,
  w: number,
  h: number,
  ctx?: CanvasRenderingContext2D,
): { label: string; cx: number; cy: number; tw: number } | null {
  const lean = lineLean(d.a, d.b, w, h);
  if (!lean) return null;
  const label = `${lean.deg.toFixed(1)}° vert`;
  let m = ctx;
  if (!m) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    m = measureCtx ?? undefined;
  }
  if (m) m.font = LABEL_FONT;
  const tw = m ? m.measureText(label).width : label.length * 7.5;
  const ax = d.a.x * w;
  const ay = d.a.y * h;
  const bx = d.b.x * w;
  const by = d.b.y * h;
  const len = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const side = nx >= 0 ? 1 : -1;
  let cx = (ax + bx) / 2 + side * nx * (tw / 2 + 18);
  let cy = (ay + by) / 2 + side * ny * 22;
  cx = Math.min(w - tw / 2 - 8, Math.max(tw / 2 + 8, cx));
  cy = Math.min(h - 14, Math.max(14, cy));
  return { label, cx, cy, tw };
}

function paintLineLean(ctx: CanvasRenderingContext2D, d: Extract<Drawing, { type: 'line' }>, w: number, h: number) {
  const box = lineLabelLayout(d, w, h, ctx);
  if (!box) return;
  const { label, cx: lx, cy: ly, tw } = box;
  ctx.font = LABEL_FONT;
  roundedRect(ctx, lx - tw / 2 - 7, ly - 11, tw + 14, 22, 7);
  ctx.fillStyle = 'rgba(8,12,10,0.82)';
  ctx.fill();
  ctx.fillStyle = d.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly);
}

function paintOne(ctx: CanvasRenderingContext2D, d: Drawing, w: number, h: number, selected: boolean) {
  const color = d.color;
  const width = selected ? 3 : 2.25;

  switch (d.type) {
    case 'line': {
      const ax = d.a.x * w;
      const ay = d.a.y * h;
      const bx = d.b.x * w;
      const by = d.b.y * h;
      const ext = extendLine(ax, ay, bx, by, w, h);
      if (ext) {
        ctx.beginPath();
        ctx.moveTo(ext[0].x, ext[0].y);
        ctx.lineTo(ext[1].x, ext[1].y);
        strokeInk(ctx, hexToRgba(color, 0.55), 1.25, true);
      }
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      strokeInk(ctx, color, width);
      if (selected) {
        handleDot(ctx, ax, ay);
        handleDot(ctx, bx, by);
      } else {
        dot(ctx, ax, ay, color, 4);
        dot(ctx, bx, by, color, 4);
      }
      paintLineLean(ctx, d, w, h);
      break;
    }
    case 'pen': {
      if (d.points.length === 0) break;
      ctx.beginPath();
      d.points.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      strokeInk(ctx, color, width);
      break;
    }
    case 'angle': {
      const ax = d.a.x * w;
      const ay = d.a.y * h;
      const vx = d.v.x * w;
      const vy = d.v.y * h;
      const bx = d.b.x * w;
      const by = d.b.y * h;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(vx, vy);
      ctx.lineTo(bx, by);
      strokeInk(ctx, color, width);
      if (selected) {
        handleDot(ctx, ax, ay);
        handleDot(ctx, vx, vy);
        handleDot(ctx, bx, by);
      } else {
        dot(ctx, ax, ay, color, 4);
        dot(ctx, vx, vy, color, 5);
        dot(ctx, bx, by, color, 4);
      }
      paintAngleLabel(ctx, d.a, d.v, d.b, color, w, h);
      break;
    }
    case 'circle': {
      const cx = d.c.x * w;
      const cy = d.c.y * h;
      const r = Math.max(1, d.r * w);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, 0.12);
      ctx.fill();
      strokeInk(ctx, color, width);
      if (selected) {
        handleDot(ctx, cx, cy);
        handleDot(ctx, cx + r, cy);
      } else {
        dot(ctx, cx, cy, color, 3.5);
      }
      break;
    }
    case 'box': {
      const frame = boxFrame(d, w, h);
      ctx.save();
      ctx.translate(frame.cx, frame.cy);
      ctx.rotate(frame.rot);
      ctx.beginPath();
      ctx.rect(-frame.bw / 2, -frame.bh / 2, frame.bw, frame.bh);
      ctx.fillStyle = hexToRgba(color, 0.1);
      ctx.fill();
      strokeInk(ctx, color, width);
      ctx.restore();
      if (selected) {
        for (const corner of frame.corners) handleDot(ctx, corner.x, corner.y);
      }
      break;
    }
    case 'hline': {
      const y = d.y * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      strokeInk(ctx, color, 1.6, true);
      break;
    }
    case 'vline': {
      const x = d.x * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      strokeInk(ctx, color, 1.6, true);
      break;
    }
    default: {
      const never: never = d;
      void never;
    }
  }

}

export function paint(
  ctx: CanvasRenderingContext2D,
  drawings: Drawing[],
  draft: Drawing | null,
  anglePts: Pt[],
  cursor: Pt | null,
  color: string,
  w: number,
  h: number,
  selectedId: string | null,
  clear = true,
) {
  if (clear) ctx.clearRect(0, 0, w, h);
  const selected = drawings.find((d) => d.id === selectedId) ?? null;
  for (const d of drawings) {
    if (d.id === selectedId) continue;
    paintOne(ctx, d, w, h, false);
  }
  if (selected) paintOne(ctx, selected, w, h, true);
  if (draft) paintOne(ctx, draft, w, h, false);

  if (anglePts.length === 0) return;
  const a = anglePts[0];
  if (anglePts.length === 1) {
    dot(ctx, a.x * w, a.y * h, color, 5);
    if (cursor) {
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(cursor.x * w, cursor.y * h);
      strokeInk(ctx, color, 2);
    }
    return;
  }
  const vertex = anglePts[1];
  if (cursor) {
    const preview: Drawing = {
      id: 'preview',
      type: 'angle',
      color,
      a,
      v: vertex,
      b: cursor,
    };
    paintOne(ctx, preview, w, h, false);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(a.x * w, a.y * h);
  ctx.lineTo(vertex.x * w, vertex.y * h);
  strokeInk(ctx, color, 2.25);
  dot(ctx, a.x * w, a.y * h, color, 4);
  dot(ctx, vertex.x * w, vertex.y * h, color, 5);
}
