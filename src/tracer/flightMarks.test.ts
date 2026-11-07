import { describe, expect, it } from 'vitest';
import { emptyShot, sampleAt, simulateShot } from './flight';
import { fitAimToMarks, fitMarks, marksAfterImpact, pathPointAt, retimeFlight, warpToMarks } from './flightMarks';
import { projectFlight, type TracerCamera } from './project';
import type { Pt } from '../types';

const W = 1080;
const H = 1920;
const camera: TracerCamera = { view: 'dtl', height: 1.4, distance: 3.5, fov: 60 };
const ball: Pt = { x: 0.5, y: 0.74 };
const ground: Pt = { x: 0.5, y: 0.42 };

function flight(hla: number, spinAxis: number) {
  const result = simulateShot({ ...emptyShot(), ballSpeed: 118, vla: 19, spin: 7000, spinAxis, hla });
  if (!result) throw new Error('no flight');
  return result;
}

function screenAt(samples: ReturnType<typeof flight>['samples'], target: Pt, seconds: number): Pt {
  const path = projectFlight(samples, camera, ball, target, W, H, ground);
  const at = pathPointAt(path, seconds);
  return { x: at.x, y: at.y };
}

describe('ball marks in flight', () => {
  it('keeps only marks after impact, in order', () => {
    const marks = marksAfterImpact(
      [
        { t: 2.0, x: 0.5, y: 0.4 },
        { t: 0.9, x: 0.5, y: 0.7 },
        { t: 1.5, x: 0.5, y: 0.5 },
      ],
      1.0,
    );
    expect(marks).toHaveLength(2);
    expect(marks[0].elapsed).toBeCloseTo(0.5, 6);
    expect(marks[1].elapsed).toBeCloseTo(1.0, 6);
    expect(marksAfterImpact(null, 1)).toHaveLength(0);
    expect(marksAfterImpact([{ t: 2, x: 0.5, y: 0.5 }], null)).toHaveLength(0);
  });

  it('finds the start line from the marks when the model matches the ball', () => {
    const shot = flight(0, 0);
    // The real shot left 6 screen-degrees right of straight up the frame.
    const angle = -Math.PI / 2 + (6 * Math.PI) / 180;
    const truth: Pt = { x: ball.x + (Math.cos(angle) * 0.3 * H) / W, y: ball.y + Math.sin(angle) * 0.3 };
    const marks = [0.25, 0.6].map((seconds) => ({ point: screenAt(shot.samples, truth, seconds), seconds }));
    const fitted = fitAimToMarks({ samples: shot.samples, camera, ball, ground, width: W, height: H, marks });
    expect(fitted).not.toBeNull();
    for (const mark of marks) {
      const at = screenAt(shot.samples, fitted as Pt, mark.seconds);
      expect(Math.hypot((at.x - mark.point.x) * W, (at.y - mark.point.y) * H)).toBeLessThan(1.5);
    }
  });

  it('passes exactly through each mark even when the numbers are off, and keeps the landing', () => {
    const real = flight(4, 6);
    const model = flight(0, 0);
    const straight: Pt = { x: 0.5, y: 0.3 };
    const marks = [0.3, 0.8].map((seconds) => ({ point: screenAt(real.samples, straight, seconds), seconds }));
    const target = fitAimToMarks({ samples: model.samples, camera, ball, ground, width: W, height: H, marks }) as Pt;
    const path = projectFlight(model.samples, camera, ball, target, W, H, ground);
    const warped = warpToMarks(
      path,
      marks.map((mark) => ({ point: mark.point, t: mark.seconds })),
    );
    for (const mark of marks) {
      const at = pathPointAt(warped, mark.seconds);
      expect(Math.hypot((at.x - mark.point.x) * W, (at.y - mark.point.y) * H)).toBeLessThan(0.5);
    }
    // Starts on the ball and still lands where the flight model lands.
    expect(warped[0].x).toBeCloseTo(ball.x, 6);
    expect(warped[0].y).toBeCloseTo(ball.y, 6);
    const end = warped[warped.length - 1];
    const plainEnd = path[path.length - 1];
    expect(end.x).toBeCloseTo(plainEnd.x, 6);
    expect(end.y).toBeCloseTo(plainEnd.y, 6);
    // Time only moves forward along the line.
    for (let i = 1; i < warped.length; i++) expect(warped[i].t).toBeGreaterThanOrEqual(warped[i - 1].t);
  });

  it('leaves the line alone with no usable marks', () => {
    const model = flight(0, 0);
    const path = projectFlight(model.samples, camera, ball, { x: 0.5, y: 0.3 }, W, H, ground);
    expect(warpToMarks(path, [])).toBe(path);
    const end = path[path.length - 1].t;
    expect(warpToMarks(path, [{ point: { x: 0.1, y: 0.1 }, t: end + 1 }])).toBe(path);
    expect(sampleAt(model.samples, 0).z).toBe(0);
  });

  it('fits a face-on camera too', () => {
    const face: TracerCamera = { ...camera, view: 'face' };
    const shot = flight(0, 0);
    const truth: Pt = { x: 0.9, y: 0.5 };
    const path = projectFlight(shot.samples, face, ball, truth, W, H, ground);
    // Face on, the ball crosses the frame in a few frames, so the marks come early.
    const marks = [0.02, 0.045].map((seconds) => {
      const at = pathPointAt(path, seconds);
      return { point: { x: at.x, y: at.y }, seconds };
    });
    const fitted = fitAimToMarks({ samples: shot.samples, camera: face, ball, ground, width: W, height: H, marks }) as Pt;
    const again = projectFlight(shot.samples, face, ball, fitted, W, H, ground);
    for (const mark of marks) {
      const at = pathPointAt(again, mark.seconds);
      expect(Math.hypot((at.x - mark.point.x) * W, (at.y - mark.point.y) * H)).toBeLessThan(2);
    }
  });

  it('finds the clip speed from the marks, so a slow-motion clip set to 1x does not zigzag', () => {
    const shot = flight(0, 0);
    const side: Pt = { x: 0.8, y: 0.66 };
    const real = projectFlight(shot.samples, camera, side, { x: 0.75, y: 0.3 }, W, H, ground);
    const slow = 8;
    const marks = [0.1, 0.25].map((elapsed) => {
      const at = pathPointAt(real, elapsed / slow);
      return { point: { x: at.x, y: at.y }, elapsed };
    });
    const fit = fitMarks({ samples: shot.samples, camera, ball: side, ground, width: W, height: H, marks, scale: 1 });
    expect(fit).not.toBeNull();
    expect(fit?.scale ?? 0).toBeGreaterThan(7);
    expect(fit?.scale ?? 0).toBeLessThan(9);
    const scale = fit?.scale ?? 1;
    const path = projectFlight(shot.samples, camera, side, (fit as { target: Pt }).target, W, H, ground).map((p) => ({ ...p, t: p.t * scale }));
    const warped = warpToMarks(path, marks.map((mark) => ({ point: mark.point, t: mark.elapsed })));
    for (const mark of marks) {
      const at = pathPointAt(warped, mark.elapsed);
      expect(Math.hypot((at.x - mark.point.x) * W, (at.y - mark.point.y) * H)).toBeLessThan(0.5);
    }
    // Up once, then down once: no zigzag.
    let turns = 0;
    let prev = 0;
    for (let i = 1; i < warped.length; i++) {
      const dir = Math.sign(Math.round((warped[i].y - warped[i - 1].y) * H));
      if (dir && prev && dir !== prev) turns++;
      if (dir) prev = dir;
    }
    expect(turns).toBeLessThanOrEqual(1);
  });

  it('lands by the end of a slow-motion clip that ends mid-flight', () => {
    const shot = flight(0, 0);
    const real = projectFlight(shot.samples, camera, ball, { x: 0.5, y: 0.3 }, W, H, ground);
    const hang = real[real.length - 1].t;
    // 8x slow motion, 12 seconds of video left after impact: the real flight would need about 48.
    const timed = retimeFlight(real, 8, 0.4, 12);
    expect(timed[timed.length - 1].t).toBeCloseTo(12, 6);
    // Up to the last mark it keeps the real pace, so the line stays on the marked ball.
    expect(pathPointAt(timed, 0.4).y).toBeCloseTo(pathPointAt(real, 0.05).y, 6);
    for (let i = 1; i < timed.length; i++) expect(timed[i].t).toBeGreaterThan(timed[i - 1].t);
    // A clip long enough for the whole flight keeps the real pace all the way.
    const roomy = retimeFlight(real, 1, 0.2, 30);
    expect(roomy[roomy.length - 1].t).toBeCloseTo(hang, 6);
  });
});
