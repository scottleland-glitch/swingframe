import type { Pt } from '../types';
import type { TracerPoint } from './project';

export interface TracerMarks {
  ball: Pt | null;
  target: Pt | null;
  ground?: Pt | null;
}

function slicePath(path: TracerPoint[], elapsed: number | null): { x: number; y: number }[] {
  if (path.length < 2) return [];
  if (elapsed == null) return path;
  if (elapsed <= 0) return [];
  if (elapsed + 1e-4 >= path[path.length - 1].t) return path;
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

/** Every sample is a vertex. Dense samples make this polyline read as a smooth curve. */
function strokeSmooth(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], width: number, height: number) {
  const px = (p: { x: number; y: number }) => p.x * width;
  const py = (p: { x: number; y: number }) => p.y * height;
  ctx.beginPath();
  ctx.moveTo(px(points[0]), py(points[0]));
  if (points.length < 3) {
    for (let i = 1; i < points.length; i++) ctx.lineTo(px(points[i]), py(points[i]));
    ctx.stroke();
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (px(points[i]) + px(points[i + 1])) / 2;
    const yc = (py(points[i]) + py(points[i + 1])) / 2;
    ctx.quadraticCurveTo(px(points[i]), py(points[i]), xc, yc);
  }
  const last = points[points.length - 1];
  ctx.lineTo(px(last), py(last));
  ctx.stroke();
}

/** Glowing broadcast line. `elapsed` null draws the whole flight (calibration preview). */
export function paintTracer(
  ctx: CanvasRenderingContext2D,
  path: TracerPoint[] | null,
  width: number,
  height: number,
  elapsed: number | null,
  marks: TracerMarks | null,
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
  const label = (point: Pt, text: string, color: string) => {
    const x = point.x * width;
    const y = point.y * height - 16;
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const box = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - box / 2, y - 16, box, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  if (marks.ball) {
    ring(marks.ball, '#ffe14a');
    label(marks.ball, 'Ball', '#ffe14a');
  }
  if (marks.target) {
    ring(marks.target, '#7ee0ff');
    label(marks.target, 'Aim', '#7ee0ff');
  }
  if (marks.ground) {
    const x = marks.ground.x * width;
    const y = marks.ground.y * height;
    ctx.beginPath();
    ctx.fillStyle = '#b6f5c8';
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    label(marks.ground, 'Ground', '#b6f5c8');
  }
  ctx.restore();
}
