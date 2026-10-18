import { describe, expect, it } from 'vitest';
import type { Drawing } from './types';
import {
  angleDegrees,
  angleFromFingers,
  applyHandle,
  boxFromFingers,
  circleFromFingers,
  extendLine,
  hitTest,
  lineFromFingers,
  transformDrawing,
  translateDrawing,
} from './geometry';

describe('angleDegrees', () => {
  it('measures a right angle, a straight line, and a folded line', () => {
    const v = { x: 0, y: 0 };
    expect(angleDegrees({ x: 1, y: 0 }, v, { x: 0, y: 1 }, 1, 1)).toBeCloseTo(90, 5);
    expect(angleDegrees({ x: 1, y: 0 }, v, { x: -1, y: 0 }, 1, 1)).toBeCloseTo(180, 5);
    expect(angleDegrees({ x: 1, y: 0 }, v, { x: 1, y: 0 }, 1, 1)).toBeCloseTo(0, 5);
  });

  it('uses pixel space so a wide video does not skew the reading', () => {
    const v = { x: 0.5, y: 0.5 };
    const horizontal = { x: 0.5 + 10 / 200, y: 0.5 };
    const diagonal = { x: 0.5 + 10 / 200, y: 0.5 + 10 / 100 };
    expect(angleDegrees(horizontal, v, diagonal, 200, 100)).toBeCloseTo(45, 4);
  });

  it('returns 0 when a ray has no length', () => {
    expect(angleDegrees({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 100, 100)).toBe(0);
  });
});

describe('extendLine', () => {
  it('stretches a horizontal segment to both edges', () => {
    const line = extendLine(10, 25, 40, 25, 100, 50);
    expect(line).not.toBeNull();
    const xs = line!.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 4);
    expect(xs[1]).toBeCloseTo(100, 4);
    expect(line![0].y).toBeCloseTo(25, 4);
    expect(line![1].y).toBeCloseTo(25, 4);
  });
});

describe('hitTest and edits', () => {
  const line: Drawing = {
    id: 'l1',
    type: 'line',
    color: '#fff',
    a: { x: 0.1, y: 0.5 },
    b: { x: 0.8, y: 0.5 },
  };
  const level: Drawing = { id: 'h1', type: 'hline', color: '#fff', y: 0.25 };

  it('hits a level line and ignores a far tap', () => {
    expect(hitTest([level], { x: 0.5, y: 0.25 }, 100, 100, null)?.id).toBe('h1');
    expect(hitTest([level], { x: 0.5, y: 0.9 }, 100, 100, null)).toBeNull();
  });

  it('prefers a selected handle over the line body', () => {
    const hit = hitTest([line], { x: 0.1, y: 0.5 }, 200, 100, 'l1');
    expect(hit).toEqual({ id: 'l1', part: 'a' });
  });

  it('moves a line and a level line', () => {
    const moved = translateDrawing(line, 0.1, -0.2);
    expect(moved).toMatchObject({ a: { x: 0.2, y: 0.3 }, b: { x: 0.9, y: 0.3 } });
    const shifted = translateDrawing(level, 0.4, 0.1);
    expect(shifted).toMatchObject({ y: 0.35 });
  });

  it('drags a line end and a box corner', () => {
    const next = applyHandle(line, 'b', { x: 0.4, y: 0.2 }, 100, 100);
    expect(next).toMatchObject({ b: { x: 0.4, y: 0.2 } });
    const box: Drawing = { id: 'box', type: 'box', color: '#fff', x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const resized = applyHandle(box, 'se', { x: 0.8, y: 0.7 }, 100, 100);
    expect(resized.type).toBe('box');
    if (resized.type !== 'box') return;
    expect(resized.x).toBeCloseTo(0.2);
    expect(resized.y).toBeCloseTo(0.2);
    expect(resized.w).toBeCloseTo(0.6);
    expect(resized.h).toBeCloseTo(0.5);
  });
});

describe('two-finger placement', () => {
  it('puts each finger on a line end', () => {
    expect(lineFromFingers({ x: 0.2, y: 0.8 }, { x: 0.7, y: 0.3 })).toEqual({
      a: { x: 0.2, y: 0.8 },
      b: { x: 0.7, y: 0.3 },
    });
  });

  it('sizes a circle and a box from the two fingers', () => {
    const circle = circleFromFingers({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }, 100, 100);
    expect(circle.c).toEqual({ x: 0.4, y: 0.5 });
    expect(circle.r).toBeCloseTo(0.2);
    const box = boxFromFingers({ x: 0.7, y: 0.2 }, { x: 0.2, y: 0.6 });
    expect(box.x).toBeCloseTo(0.2);
    expect(box.y).toBeCloseTo(0.2);
    expect(box.w).toBeCloseTo(0.5);
    expect(box.h).toBeCloseTo(0.4);
  });

  it('puts the angle joint between the fingers', () => {
    expect(angleFromFingers({ x: 0, y: 0.2 }, { x: 0.4, y: 0.8 })).toEqual({
      a: { x: 0, y: 0.2 },
      v: { x: 0.2, y: 0.5 },
      b: { x: 0.4, y: 0.8 },
    });
  });

  it('turns a line a quarter turn around the pivot', () => {
    const line: Drawing = {
      id: 'l',
      type: 'line',
      color: '#fff',
      a: { x: 0.4, y: 0.5 },
      b: { x: 0.6, y: 0.5 },
    };
    const turned = transformDrawing(line, { x: 0.5, y: 0.5 }, 1, Math.PI / 2, 0, 0, 100, 100);
    if (turned.type !== 'line') throw new Error('expected a line');
    expect(turned.a.x).toBeCloseTo(0.5);
    expect(turned.a.y).toBeCloseTo(0.4);
    expect(turned.b.x).toBeCloseTo(0.5);
    expect(turned.b.y).toBeCloseTo(0.6);
  });
});
