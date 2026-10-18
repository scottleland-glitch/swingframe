import { describe, expect, it } from 'vitest';
import { emptyShot } from './flight';
import { defaultTracer } from './project';
import { ballGuess, launchIsSet, setupStep } from './setup';

describe('tracer setup', () => {
  it('walks aim, then ball, then horizon, then impact, and edits a finished setup', () => {
    const base = defaultTracer();
    expect(setupStep(base)).toBe('aim');
    expect(setupStep({ ...base, target: { x: 0.5, y: 0.3 }, aimSuggested: true })).toBe('aim');
    const aimed = { ...base, target: { x: 0.5, y: 0.3 }, aimSuggested: false };
    expect(setupStep(aimed)).toBe('ball');
    const withBall = { ...aimed, ball: { x: 0.48, y: 0.74 } };
    expect(setupStep(withBall)).toBe('horizon');
    const withGround = { ...withBall, ground: { x: 0.5, y: 0.42 } };
    expect(setupStep(withGround)).toBe('impact');
    expect(setupStep({ ...withGround, impactTime: 1.2 })).toBe('edit');
    const guided = { ...withGround, mode: 'data' as const, impactTime: 1.2 };
    expect(setupStep(guided)).toBe('lock');
    expect(setupStep({ ...guided, setupDone: true })).toBe('edit');
  });

  it('walks a manual trace through start, apex, finish, impact, and lock', () => {
    const base = { ...defaultTracer(), mode: 'manual' as const, shape: 'fade' as const };
    expect(setupStep(base)).toBe('start');
    const started = { ...base, manualStart: { x: 0.5, y: 0.72 } };
    expect(setupStep(started)).toBe('apex');
    const peaked = { ...started, manualApex: { x: 0.4, y: 0.36 } };
    expect(setupStep(peaked)).toBe('finish');
    const finished = { ...peaked, manualFinish: { x: 0.56, y: 0.5 } };
    expect(setupStep(finished)).toBe('impact');
    const hit = { ...finished, impactTime: 0.8 };
    expect(setupStep(hit)).toBe('lock');
    expect(setupStep({ ...hit, setupDone: true, locked: true })).toBe('edit');
  });

  it('guesses the ball from the toes, and otherwise uses the lower center', () => {
    expect(ballGuess(null)).toEqual({ x: 0.5, y: 0.72 });
    const guess = ballGuess({
      leftToe: { x: 0.4, y: 0.8 },
      rightToe: { x: 0.5, y: 0.7 },
      leftHeel: { x: 0.42, y: 0.86 },
      rightHeel: { x: 0.55, y: 0.76 },
    });
    expect(guess.x).toBeCloseTo(0.45, 2);
    expect(guess.y).toBeCloseTo(0.71, 2);
  });

  it('treats any saved launch number as enough to skip the numbers sheet', () => {
    expect(launchIsSet(emptyShot())).toBe(false);
    expect(launchIsSet(null)).toBe(false);
    expect(launchIsSet({ ...emptyShot(), ballSpeed: 150 })).toBe(true);
    expect(launchIsSet({ ...emptyShot(), hla: -2 })).toBe(true);
  });
});
