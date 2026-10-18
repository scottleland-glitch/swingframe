import type { Pt } from '../types';
import type { TracerPoint } from './project';

function slicePath(path: TracerPoint[], elapsed: number | null): { x: number; y: number }[] {
  if (path.length < 2) return [];
  if (elapsed == null) return path;
  if (elapsed <= 0) return [];
  const visible: { x: number; y: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    if (point.t <= elapsed) {
      visible.push(point);
      continue;
    }
    const prev = path[i - 1];
    if (!prev) break;
    const span = point.t - prev.t || 1;
    const frac = Math.max(0, Math.min(1, (elapsed - prev.t) / span));
    visible.push({
      x: prev.x + (point.x - prev.x) * frac,
      y: prev.y + (point.y - prev.y) * frac,
    });
    break;
  }
  return visible;
}

function strokeSmooth(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * width, points[i].y * height);
  }
  ctx.stroke();
}

/** Glowing broadcast line. `elapsed` null draws the whole flight (calibration preview). */
export function paintTracer(
  ctx: CanvasRenderingContext2D,
  path: TracerPoint[] | null,
  width: number,
  height: number,
  elapsed: number | null,
  marks: { ball: Pt | null; target: Pt | null } | null,
) {
  const points = path ? slicePath(path, elapsed) : [];
  if (points.length >= 2) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(140, 220, 255, 0.95)';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = 'rgba(190, 235, 255, 0.35)';
    ctx.lineWidth = 12;
    strokeSmooth(ctx, points, width, height);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 5;
    strokeSmooth(ctx, points, width, height);
    ctx.strokeStyle = '#f7fbff';
    ctx.lineWidth = 2.2;
    strokeSmooth(ctx, points, width, height);
    const head = points[points.length - 1];
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(head.x * width, head.y * height, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!marks) return;
  ctx.save();
  if (marks.ball && marks.target) {
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marks.ball.x * width, marks.ball.y * height);
    ctx.lineTo(marks.target.x * width, marks.target.y * height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const ring = (point: Pt, color: string) => {
    const x = point.x * width;
    const y = point.y * height;
    ctx.beginPath();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 4;
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  };
  if (marks.ball) ring(marks.ball, '#ffe14a');
  if (marks.target) ring(marks.target, '#7ee0ff');
  ctx.restore();
}
