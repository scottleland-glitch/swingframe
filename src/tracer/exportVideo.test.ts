import { describe, expect, it } from 'vitest';
import { pointAboveFinger } from './aimPoint';
import { chooseRecorderMime, exportSize, exportSpan } from './exportVideo';

describe('aim reticle', () => {
  const rect = { left: 100, top: 200, right: 500, bottom: 900, width: 400, height: 700 };

  it('places the crosshair above the finger and keeps it on the video', () => {
    const placed = pointAboveFinger(300, 600, rect, false);
    expect(placed.clientX).toBe(300);
    expect(placed.clientY).toBe(600 - 72);
    expect(placed.point.x).toBeCloseTo((300 - 100) / 400);
    expect(placed.point.y).toBeCloseTo((600 - 72 - 200) / 700);
    expect(placed.point.y).toBeLessThan((600 - 200) / 700);
  });

  it('clamps a finger near the top edge instead of leaving the picture', () => {
    const placed = pointAboveFinger(120, 220, rect, false);
    expect(placed.clientY).toBe(rect.top);
    expect(placed.point.y).toBe(0);
  });

  it('flips the horizontal coordinate when the picture is mirrored', () => {
    const placed = pointAboveFinger(300, 600, rect, true);
    expect(placed.point.x).toBeCloseTo(1 - (300 - 100) / 400);
  });
});

describe('tracer export span', () => {
  it('runs from the start of the clip and holds the last frame until the ball lands', () => {
    expect(exportSpan(0, 8, 6, 7)).toEqual({ start: 0, end: 13 });
    expect(exportSpan(0, 10, 2, 3)).toEqual({ start: 0, end: 10 });
    expect(exportSpan(1, 4, null, 0)).toEqual({ start: 1, end: 4 });
  });

  it('caps a large frame and still reports when recording is unavailable', () => {
    expect(exportSize(3840, 2160)).toEqual({ w: 1920, h: 1080 });
    expect(exportSize(1080, 1920)).toEqual({ w: 1080, h: 1920 });
    expect(chooseRecorderMime() === null || typeof chooseRecorderMime() === 'string').toBe(true);
  });
});
