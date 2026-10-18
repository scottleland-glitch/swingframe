import { describe, expect, it } from 'vitest';
import { parallelAim, straightAheadAim } from './aimSuggest';
import { posePaths } from './posePaths';
import { defaultTracer } from './project';

describe('toe-line aim', () => {
  const camera = { view: 'dtl' as const, height: 1.4, distance: 3.5, fov: 60 };

  it('puts the straight-ahead aim at frame center, on the landing ground when that tap exists', () => {
    const aimed = straightAheadAim({
      ball: { x: 0.42, y: 0.78 },
      groundY: 0.44,
      camera,
      carryMeters: 150,
    });
    expect(aimed.x).toBeCloseTo(0.5, 5);
    expect(aimed.y).toBeCloseTo(0.44, 5);

    const plain = straightAheadAim({ ball: { x: 0.42, y: 0.78 }, groundY: null, camera, carryMeters: 150 });
    expect(plain.x).toBeCloseTo(0.5, 5);
    expect(plain.y).toBeLessThan(0.78 - 0.08);
    expect(plain.y).toBeGreaterThan(0.05);
  });

  it('runs the parallel through the ball to the shared vanishing point, at the landing depth', () => {
    const vanish = { x: 0.5, y: 0.2 };
    const feet = {
      leftToe: { x: 0.2, y: 0.8 },
      rightToe: { x: 0.35, y: 0.5 },
      leftHeel: { x: 0.7, y: 0.8 },
      rightHeel: { x: 0.62, y: 0.56 },
    };
    const ball = { x: 0.62, y: 0.92 };
    const aim = parallelAim({ ball, feet, depthY: 0.4 });
    expect(aim).not.toBeNull();
    const t = (0.4 - ball.y) / (vanish.y - ball.y);
    const expectedX = ball.x + t * (vanish.x - ball.x);
    expect(aim!.point.y).toBeCloseTo(0.4, 5);
    expect(aim!.point.x).toBeCloseTo(expectedX, 2);
    const through = (aim!.point.y - ball.y) / (vanish.y - ball.y);
    expect(ball.x + through * (vanish.x - ball.x)).toBeCloseTo(aim!.point.x, 2);
    expect(aim!.toe).toEqual([feet.leftToe, feet.rightToe]);
  });

  it('uses the toe direction when the heel line is parallel in the picture', () => {
    const feet = {
      leftToe: { x: 0.2, y: 0.8 },
      rightToe: { x: 0.35, y: 0.5 },
      leftHeel: { x: 0.4, y: 0.85 },
      rightHeel: { x: 0.55, y: 0.55 },
    };
    const ball = { x: 0.6, y: 0.9 };
    const aim = parallelAim({ ball, feet, depthY: 0.45 });
    expect(aim).not.toBeNull();
    const dy = feet.rightToe.y - feet.leftToe.y;
    const dx = feet.rightToe.x - feet.leftToe.x;
    const t = (0.45 - ball.y) / dy;
    expect(aim!.point.y).toBeCloseTo(0.45, 5);
    expect(aim!.point.x).toBeCloseTo(ball.x + t * dx, 2);
  });

  it('rejects feet that are stacked on one point', () => {
    const feet = {
      leftToe: { x: 0.4, y: 0.7 },
      rightToe: { x: 0.41, y: 0.71 },
      leftHeel: { x: 0.5, y: 0.8 },
      rightHeel: { x: 0.7, y: 0.6 },
    };
    expect(parallelAim({ ball: { x: 0.55, y: 0.9 }, feet, depthY: 0.4 })).toBeNull();
  });

  it('serves the pose model from the app, not a CDN', () => {
    const paths = posePaths('/swingframe/');
    expect(paths.wasm).toBe('/swingframe/pose/wasm');
    expect(paths.model).toBe('/swingframe/pose/pose_landmarker_lite.task');
    expect(paths.model.startsWith('/swingframe/')).toBe(true);
    expect(defaultTracer().aimSuggested).toBe(false);
    expect(defaultTracer().ground).toBeNull();
  });
});
