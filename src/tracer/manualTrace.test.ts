import { describe, expect, it } from 'vitest';
import { geometricBow, manualHang, manualTrace, shapePoints } from './manualTrace';

function closest(path: { x: number; y: number }[], point: { x: number; y: number }): number {
  return Math.min(...path.map((sample) => Math.hypot(sample.x - point.x, sample.y - point.y)));
}

describe('manual trace', () => {
  const start = { x: 0.5, y: 0.74 };

  it('prefills a right-to-left draw, a left-to-right fade, and a straight shot', () => {
    const draw = shapePoints('draw', start);
    expect(draw.apex.x).toBeGreaterThan(start.x);
    expect(draw.finish.x).toBeLessThan(draw.apex.x);
    expect(draw.apex.y).toBeLessThan(draw.finish.y);
    expect(draw.finish.y).toBeLessThan(start.y);

    const fade = shapePoints('fade', start);
    expect(fade.apex.x).toBeLessThan(start.x);
    expect(fade.finish.x).toBeGreaterThan(fade.apex.x);

    const straight = shapePoints('straight', start);
    expect(straight.apex.x).toBeCloseTo(start.x, 5);
    expect(straight.finish.x).toBeCloseTo(start.x, 5);
  });

  it('passes through start, apex, and finish', () => {
    const apex = { x: 0.62, y: 0.36 };
    const finish = { x: 0.44, y: 0.52 };
    const path = manualTrace(start, apex, finish, 'draw');
    expect(closest(path, start)).toBeLessThan(1e-6);
    expect(closest(path, apex)).toBeLessThan(1e-6);
    expect(closest(path, finish)).toBeLessThan(1e-6);
    expect(path[0].t).toBe(0);
    expect(path[path.length - 1].t).toBeCloseTo(manualHang(start, apex), 5);
    const apexSample = path.reduce((best, sample) =>
      Math.hypot(sample.x - apex.x, sample.y - apex.y) < Math.hypot(best.x - apex.x, best.y - apex.y) ? sample : best,
    );
    expect(apexSample.t / path[path.length - 1].t).toBeCloseTo(0.4, 1);
  });

  it('follows a sideways drag, so a big fade bows more than a slight one', () => {
    const slightApex = { x: 0.44, y: 0.36 };
    const slightFinish = { x: 0.56, y: 0.5 };
    const bigApex = { x: 0.28, y: 0.36 };
    const bigFinish = { x: 0.7, y: 0.5 };
    const slight = manualTrace(start, slightApex, slightFinish, 'straight');
    const big = manualTrace(start, bigApex, bigFinish, 'draw');
    expect(closest(slight, slightApex)).toBeLessThan(1e-6);
    expect(closest(slight, slightFinish)).toBeLessThan(1e-6);
    expect(closest(big, bigApex)).toBeLessThan(1e-6);
    expect(closest(big, bigFinish)).toBeLessThan(1e-6);
    expect(geometricBow(start, bigApex, bigFinish)).toBeLessThan(geometricBow(start, slightApex, slightFinish));
    expect(Math.min(...big.map((sample) => sample.x))).toBeLessThan(Math.min(...slight.map((sample) => sample.x)) - 0.08);
  });

  it('uses the shape only when the three taps do not already bend', () => {
    const apex = { x: 0.5, y: 0.38 };
    const finish = { x: 0.5, y: 0.52 };
    const draw = manualTrace(start, apex, finish, 'draw');
    const fade = manualTrace(start, apex, finish, 'fade');
    const straight = manualTrace(start, apex, finish, 'straight');
    expect(closest(draw, apex)).toBeLessThan(1e-6);
    expect(closest(draw, finish)).toBeLessThan(1e-6);
    expect(Math.max(...draw.map((sample) => sample.x))).toBeGreaterThan(0.52);
    expect(Math.min(...fade.map((sample) => sample.x))).toBeLessThan(0.48);
    expect(Math.max(...straight.map((sample) => Math.abs(sample.x - 0.5)))).toBeLessThan(0.01);
  });

  it('drops faster near the finish than through the middle of the descent', () => {
    const path = manualTrace(start, { x: 0.56, y: 0.34 }, { x: 0.47, y: 0.5 }, 'draw');
    const n = path.length - 1;
    const late = path[n].y - path[Math.floor(n * 0.85)].y;
    const mid = path[Math.floor(n * 0.6)].y - path[Math.floor(n * 0.45)].y;
    expect(late).toBeGreaterThan(mid);
  });
});
