import { describe, expect, it } from 'vitest';
import { emptyShot } from './flight';
import { defaultTracer } from './project';
import { ballGuess, flightMarkIndex, launchIsSet, previousStep, resetSetup, setupStep, showsPlacementReticle, usesAimLine } from './setup';

describe('tracer setup', () => {
  it('walks ball, horizon, impact, then two balls in the air, then lock', () => {
    const base = defaultTracer();
    expect(setupStep(base)).toBe('ball');
    expect(usesAimLine(base)).toBe(false);
    // An aim point that was only suggested never makes it an aim-line swing.
    expect(setupStep({ ...base, target: { x: 0.5, y: 0.3 }, aimSuggested: true })).toBe('ball');
    const withBall = { ...base, ball: { x: 0.48, y: 0.74 } };
    expect(setupStep(withBall)).toBe('horizon');
    const withGround = { ...withBall, ground: { x: 0.5, y: 0.42 } };
    expect(setupStep(withGround)).toBe('impact');
    const hit = { ...withGround, impactTime: 1.2 };
    expect(setupStep(hit)).toBe('flight1');
    const once = { ...hit, flightMarks: [{ t: 1.4, x: 0.5, y: 0.6 }] };
    expect(setupStep(once)).toBe('flight2');
    const twice = { ...once, flightMarks: [...once.flightMarks, { t: 1.7, x: 0.51, y: 0.5 }] };
    expect(setupStep(twice)).toBe('lock');
    expect(setupStep({ ...twice, setupDone: true, locked: true })).toBe('edit');
    expect(flightMarkIndex('flight1')).toBe(0);
    expect(flightMarkIndex('flight2')).toBe(1);
    expect(flightMarkIndex('lock')).toBeNull();
  });

  it('keeps an older aim-line swing on its old steps', () => {
    const base = defaultTracer();
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

  it('steps back to the previous marker and can start over at aim', () => {
    expect(previousStep('aim', 'data', true)).toBeNull();
    expect(previousStep('ball', 'data', true)).toBe('aim');
    expect(previousStep('ball', 'data')).toBeNull();
    expect(previousStep('horizon', 'data')).toBe('ball');
    expect(previousStep('impact', 'data')).toBe('horizon');
    expect(previousStep('flight1', 'data')).toBe('impact');
    expect(previousStep('flight2', 'data')).toBe('flight1');
    expect(previousStep('lock', 'data')).toBe('flight2');
    expect(previousStep('lock', 'data', true)).toBe('impact');
    expect(previousStep('edit', 'data')).toBe('flight2');
    expect(previousStep('edit', 'data', true)).toBe('horizon');
    expect(previousStep('start', 'manual')).toBe('ball');
    expect(previousStep('apex', 'manual')).toBe('start');
    expect(previousStep('finish', 'manual')).toBe('apex');
    expect(previousStep('impact', 'manual')).toBe('finish');
    expect(previousStep('edit', 'manual')).toBe('finish');
    const cleared = resetSetup({
      ...defaultTracer(),
      mode: 'manual',
      shape: 'draw',
      ball: { x: 0.4, y: 0.7 },
      target: { x: 0.5, y: 0.3 },
      ground: { x: 0.5, y: 0.4 },
      manualStart: { x: 0.5, y: 0.7 },
      manualApex: { x: 0.6, y: 0.3 },
      manualFinish: { x: 0.45, y: 0.5 },
      impactTime: 1.2,
      flightMarks: [{ t: 1.4, x: 0.5, y: 0.6 }],
      setupDone: true,
      locked: true,
    });
    expect(cleared.flightMarks).toBeNull();
    expect(cleared.ball).toBeNull();
    expect(cleared.target).toBeNull();
    expect(cleared.ground).toBeNull();
    expect(cleared.manualStart).toBeNull();
    expect(cleared.manualApex).toBeNull();
    expect(cleared.manualFinish).toBeNull();
    expect(cleared.impactTime).toBeNull();
    expect(cleared.mode).toBeUndefined();
    expect(cleared.locked).toBe(false);
    expect(setupStep(cleared)).toBe('ball');
  });

  it('shows only the circle for the step being placed', () => {
    expect(showsPlacementReticle('aim')).toBe(true);
    expect(showsPlacementReticle('ball')).toBe(true);
    expect(showsPlacementReticle('horizon')).toBe(true);
    expect(showsPlacementReticle('start')).toBe(true);
    expect(showsPlacementReticle('apex')).toBe(true);
    expect(showsPlacementReticle('finish')).toBe(true);
    expect(showsPlacementReticle('flight1')).toBe(true);
    expect(showsPlacementReticle('flight2')).toBe(true);
    expect(showsPlacementReticle('impact')).toBe(false);
    expect(showsPlacementReticle('lock')).toBe(false);
    expect(showsPlacementReticle('edit')).toBe(false);
  });

  it('treats any saved launch number as enough to skip the numbers sheet', () => {
    expect(launchIsSet(emptyShot())).toBe(false);
    expect(launchIsSet(null)).toBe(false);
    expect(launchIsSet({ ...emptyShot(), ballSpeed: 150 })).toBe(true);
    expect(launchIsSet({ ...emptyShot(), hla: -2 })).toBe(true);
  });
});
