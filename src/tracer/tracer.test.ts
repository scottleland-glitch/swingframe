import { describe, expect, it } from 'vitest';
import { chooseUndo, tracerIsSet } from './active';
import { completeShot, editShot, emptyShot, mergeScreen, simulateShot } from './flight';
import { detectImpact } from './impact';
import { tesseractPaths } from './ocrPaths';
import { parseForesightText } from './parseShot';
import { defaultTracer, projectFlight, type TracerPoint } from './project';
import { withSide } from './sign';
import { tracerPlayhead } from './timing';
import type { Pt } from '../types';

function driver(spinAxis = 0, hla = 0, spin = 2600, vla = 12) {
  return simulateShot({
    ...emptyShot(),
    ballSpeed: 167,
    vla,
    hla,
    spin,
    spinAxis,
  });
}

describe('ball flight', () => {
  it('lands a tour driver in a believable window', () => {
    const flight = driver();
    expect(flight).not.toBeNull();
    expect(flight!.carryYd).toBeGreaterThan(275);
    expect(flight!.carryYd).toBeLessThan(290);
    expect(flight!.apexFt).toBeGreaterThan(100);
    expect(flight!.apexFt).toBeLessThan(120);
    expect(flight!.samples.at(-1)?.y).toBe(0);
    expect(flight!.flightTime).toBeGreaterThan(6);
    expect(flight!.flightTime).toBeLessThan(7.2);
  });

  it('keeps a wedge in the air for about five or six seconds', () => {
    const wedge = simulateShot({ ...emptyShot(), ballSpeed: 100, vla: 30, hla: 0, spin: 9000, spinAxis: 0 });
    expect(wedge).not.toBeNull();
    expect(wedge!.samples.at(-1)?.y).toBe(0);
    expect(wedge!.flightTime).toBeGreaterThan(5);
    expect(wedge!.flightTime).toBeLessThan(6.3);
  });

  it('raises the apex with launch and with backspin, and curves to the right for a fade', () => {
    const low = driver(0, 0, 2600, 10);
    const high = driver(0, 0, 2600, 16);
    const lessSpin = driver(0, 0, 1800, 12);
    const moreSpin = driver(0, 0, 4500, 12);
    expect(high!.apexFt).toBeGreaterThan(low!.apexFt);
    expect(moreSpin!.apexFt).toBeGreaterThan(lessSpin!.apexFt);
    const fade = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 14, hla: 0, spin: 6000, spinAxis: 8 });
    const draw = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 14, hla: 0, spin: 6000, spinAxis: -8 });
    expect(fade!.curveYd).toBeGreaterThan(2);
    expect(draw!.curveYd).toBeLessThan(-2);
    const pushed = driver(0, 3, 3000, 12);
    expect(pushed!.curveYd).toBeGreaterThan(0);
  });

  it('keeps measured carry and fills only the blanks', () => {
    const shot = completeShot({
      ...emptyShot(),
      ballSpeed: 167,
      vla: 12,
      spin: 2600,
      carry: 250,
      sources: { ballSpeed: 'typed', vla: 'typed', spin: 'typed', carry: 'typed' },
    });
    expect(shot.carry).toBe(250);
    expect(shot.sources.carry).toBe('typed');
    expect(shot.apex).not.toBeNull();
    expect(shot.sources.apex).toBe('model');
    expect(shot.curve).not.toBeNull();
    expect(simulateShot(emptyShot())).toBeNull();
  });

  it('recomputes a calculated apex after the speed changes, and leaves a typed apex alone', () => {
    const filled = completeShot({ ...emptyShot(), ballSpeed: 150, vla: 14, spin: 7000, sources: { ballSpeed: 'typed', vla: 'typed', spin: 'typed' } });
    const faster = editShot(filled, 'ballSpeed', 165);
    expect(faster.sources.apex).toBe('model');
    expect(faster.apex).not.toBe(filled.apex);
    const typed = editShot(filled, 'apex', 88);
    const again = editShot(typed, 'ballSpeed', 165);
    expect(again.apex).toBe(88);
    expect(again.sources.apex).toBe('typed');
  });

  it('flies from the five inputs and keeps a stored launch direction and spin axis', () => {
    const stored = completeShot({
      ...emptyShot(),
      ballSpeed: 150,
      vla: 14,
      spin: 6000,
      hla: -3,
      spinAxis: 4,
      faceToTarget: 5,
      faceToPath: -8,
      sideSpin: 400,
      clubPath: 2,
      carry: 250,
      sources: {
        ballSpeed: 'typed',
        vla: 'typed',
        spin: 'typed',
        hla: 'screen',
        spinAxis: 'screen',
        faceToTarget: 'screen',
        faceToPath: 'screen',
        sideSpin: 'screen',
        clubPath: 'screen',
        carry: 'typed',
      },
    });
    expect(stored.hla).toBe(-3);
    expect(stored.spinAxis).toBe(4);
    expect(stored.carry).toBe(250);
    const clean = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 14, spin: 6000, hla: -3, spinAxis: 4 });
    const withExtras = simulateShot(stored);
    expect(withExtras!.curveYd).toBeCloseTo(clean!.curveYd, 5);
    expect(withExtras!.carryYd).toBeCloseTo(clean!.carryYd, 5);

    const ignored = completeShot({
      ...emptyShot(),
      ballSpeed: 150,
      vla: 14,
      spin: 6000,
      faceToTarget: -2.5,
      faceToPath: -8,
      sideSpin: 400,
      sources: {
        ballSpeed: 'typed',
        vla: 'typed',
        spin: 'typed',
        faceToTarget: 'typed',
        faceToPath: 'typed',
        sideSpin: 'typed',
      },
    });
    expect(ignored.hla).toBeNull();
    expect(ignored.spinAxis).toBeNull();
    expect(ignored.sideSpin).toBe(400);
    const straight = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 14, spin: 6000 });
    expect(simulateShot(ignored)!.curveYd).toBeCloseTo(straight!.curveYd, 5);

    const kept = editShot(stored, 'ballSpeed', 155);
    expect(kept.hla).toBe(-3);
    expect(kept.spinAxis).toBe(4);
    expect(kept.faceToTarget).toBe(5);

    const rough = completeShot({
      ...emptyShot(),
      faceToPath: 3,
      carry: 225,
      sources: { faceToPath: 'typed', carry: 'typed' },
    });
    expect(rough.hla).toBeNull();
    expect(rough.spinAxis).toBeNull();
    expect(rough.curve).toBeNull();
  });
});

describe('foresight text', () => {
  it('reads a shot screen, including a value on the next line and an R suffix', () => {
    const shot = parseForesightText(`
      Ball Speed
      167.2 mph
      Launch Angle
      12.3
      Launch Direction
      2.1 R
      Spin Rate
      2,650 rpm
      Spin Axis
      4.2 R
      Carry
      276 yds
    `);
    expect(shot.ballSpeed).toBeCloseTo(167.2);
    expect(shot.vla).toBeCloseTo(12.3);
    expect(shot.hla).toBeCloseTo(2.1);
    expect(shot.spin).toBeCloseTo(2650);
    expect(shot.spinAxis).toBeCloseTo(4.2);
    expect(shot.carry).toBeNull();
    expect(shot.apex).toBeNull();
    expect(shot.curve).toBeNull();
    expect(shot.sources.carry).toBeUndefined();
    expect(shot.sources.ballSpeed).toBe('screen');
    expect(shot.sources.hla).toBe('screen');
  });

  it('handles L suffixes, OCR noise, and a missing carry', () => {
    const shot = parseForesightText(`
      Ball Speed l67.8
      VLA 11.2
      HLA 1.4 L
      Total Spin 2480
      Side Spin 320
      Apex 96 ft
      Club Speed 112
      Smash Factor 1.48
      Attack Angle -2.4
    `);
    expect(shot.ballSpeed).toBeCloseTo(167.8);
    expect(shot.vla).toBeCloseTo(11.2);
    expect(shot.hla).toBeCloseTo(-1.4);
    expect(shot.spin).toBe(2480);
    expect(shot.sideSpin).toBeNull();
    expect(shot.apex).toBeNull();
    expect(shot.spinAxis).toBeNull();
    expect(shot.carry).toBeNull();
    const filled = mergeScreen(emptyShot(), shot);
    expect(filled.carry).not.toBeNull();
    expect(filled.sources.carry).toBe('model');
    expect(filled.sources.ballSpeed).toBe('screen');
    expect(filled.hla).toBeCloseTo(-1.4);
    expect(filled.spinAxis).toBeNull();
  });

  it('uses back spin as total spin and does not invent a spin axis', () => {
    const shot = parseForesightText('Back Spin 5200\nSide Spin 400 L\nCurve 6.5 L');
    expect(shot.spin).toBe(5200);
    expect(shot.spinAxis).toBeNull();
    expect(shot.sideSpin).toBeNull();
    expect(shot.curve).toBeNull();
  });

  it('fills only the five flight inputs from a screen that also shows club data', () => {
    const shot = parseForesightText(`
      Ball Speed 152.4
      Launch Angle 13.1
      Launch Direction 1.2 L
      Total Spin 6420
      Spin Axis 3.5 R
      Club Path 3.4 R
      Face to Target 0.8 R
      Face to Path 4.2 L
      Side Spin 390
      Carry 241
      Apex 88
      Curve 6.5 L
      Attack Angle -2.4
    `);
    expect(shot.ballSpeed).toBeCloseTo(152.4);
    expect(shot.vla).toBeCloseTo(13.1);
    expect(shot.hla).toBeCloseTo(-1.2);
    expect(shot.spin).toBe(6420);
    expect(shot.spinAxis).toBeCloseTo(3.5);
    expect(shot.clubPath).toBeNull();
    expect(shot.faceToTarget).toBeNull();
    expect(shot.faceToPath).toBeNull();
    expect(shot.sideSpin).toBeNull();
    expect(shot.carry).toBeNull();
    expect(shot.apex).toBeNull();
    expect(shot.curve).toBeNull();
  });
});

function lineDeviation(path: TracerPoint[], width: number, height: number): number {
  const xs = path.map((point) => point.x * width);
  const ys = path.map((point) => point.y * height);
  const n = path.length;
  const mx = xs.reduce((sum, value) => sum + value, 0) / n;
  const my = ys.reduce((sum, value) => sum + value, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const dev = Math.abs(-(xs[i] - mx) * Math.sin(ang) + (ys[i] - my) * Math.cos(ang));
    if (dev > max) max = dev;
  }
  return max;
}

function imageRays(path: TracerPoint[], ball: Pt, target: Pt, width: number, height: number) {
  const bx = ball.x * width;
  const by = ball.y * height;
  const tx = target.x * width - bx;
  const ty = target.y * height - by;
  const span = Math.hypot(tx, ty) || 1;
  const ux = tx / span;
  const uy = ty / span;
  const px = -uy;
  const py = ux;
  return path.map((point) => {
    const dx = point.x * width - bx;
    const dy = point.y * height - by;
    return { along: dx * ux + dy * uy, across: dx * px + dy * py, t: point.t };
  });
}

describe('camera projection', () => {
  const samples = driver()!.samples;
  const defaults = defaultTracer();
  const camera = { view: 'dtl' as const, height: defaults.cameraHeight, distance: defaults.cameraDistance, fov: defaults.fov };
  const ball = { x: 0.48, y: 0.74 };
  const target = { x: 0.53, y: 0.36 };
  const width = 720;
  const height = 1280;

  it('uses a generic tripod, not a fitted scene', () => {
    expect(defaults.cameraHeight).toBeGreaterThan(1.2);
    expect(defaults.cameraHeight).toBeLessThan(1.5);
    expect(defaults.cameraDistance).toBeGreaterThan(2.5);
    expect(defaults.cameraDistance).toBeLessThan(5);
  });

  it('lands on the ground along the target line and comes back down to that point', () => {
    const path = projectFlight(samples, camera, ball, target, width, height);
    expect(path[0].x).toBeCloseTo(ball.x, 4);
    expect(path[0].y).toBeCloseTo(ball.y, 4);
    expect(path.at(-1)?.t).toBeCloseTo(samples.at(-1)!.t, 2);
    expect(samples.at(-1)?.y).toBe(0);
    const rays = imageRays(path, ball, target, width, height);
    const landing = rays.at(-1)!;
    expect(Math.abs(landing.across)).toBeLessThan(1.5);
    expect(landing.along).toBeGreaterThan(30);
    const peak = Math.max(...rays.map((ray) => ray.along));
    expect(peak).toBeGreaterThan(landing.along + 20);
    const fade = driver(8)!;
    const fadeRays = imageRays(projectFlight(fade.samples, camera, ball, target, width, height), ball, target, width, height);
    const fadeLanding = fadeRays.at(-1)!;
    expect(fadeLanding.across).toBeGreaterThan(6);
    expect(Math.max(...fadeRays.map((ray) => ray.along))).toBeGreaterThan(fadeLanding.along + 15);
    const straightPeak = Math.max(...rays.map((ray) => ray.along));
    const fadePeak = Math.max(...fadeRays.map((ray) => ray.along));
    expect(fadePeak).toBeGreaterThan(straightPeak * 0.75);
  });

  it('starts a push-draw right of the aim line and lands it left, without pulling a straight shot off the line', () => {
    const straight = driver(0, 0)!;
    const draw = driver(-8, 1)!;
    expect(straight.curveYd).toBeGreaterThan(-1);
    expect(straight.curveYd).toBeLessThan(1);
    expect(draw.curveYd).toBeLessThan(-2);
    const straightRays = imageRays(projectFlight(straight.samples, camera, ball, target, width, height), ball, target, width, height);
    const drawRays = imageRays(projectFlight(draw.samples, camera, ball, target, width, height), ball, target, width, height);
    expect(Math.abs(straightRays.at(-1)!.across)).toBeLessThan(1.5);
    const started = drawRays.find((ray) => ray.t >= 0.2)!;
    expect(started.across).toBeGreaterThan(0.5);
    expect(drawRays.at(-1)!.across).toBeLessThan(-4);
    const straightPeak = Math.max(...straightRays.map((ray) => ray.along));
    const drawPeak = Math.max(...drawRays.map((ray) => ray.along));
    expect(drawPeak).toBeGreaterThan(straightPeak * 0.75);
    expect(Math.abs(draw.apexFt - straight.apexFt)).toBeLessThan(15);
  });

  it('foreshortens the ground and still descends from another ball position and face on', () => {
    const ground = projectFlight(
      [
        { t: 0, x: 0, y: 0, z: 0 },
        { t: 1, x: 0, y: 0, z: 80 },
        { t: 2, x: 0, y: 0, z: 160 },
      ],
      camera,
      ball,
      target,
      width,
      height,
    );
    const near = Math.hypot((ground[1].x - ground[0].x) * width, (ground[1].y - ground[0].y) * height);
    const far = Math.hypot((ground[2].x - ground[1].x) * width, (ground[2].y - ground[1].y) * height);
    expect(far).toBeLessThan(near * 0.75);

    const otherBall = { x: 0.4, y: 0.62 };
    const otherTarget = { x: 0.62, y: 0.28 };
    const other = imageRays(projectFlight(samples, camera, otherBall, otherTarget, width, height), otherBall, otherTarget, width, height);
    const otherLanding = other.at(-1)!;
    expect(Math.abs(otherLanding.across)).toBeLessThan(1.5);
    expect(Math.max(...other.map((ray) => ray.along))).toBeGreaterThan(otherLanding.along + 20);

    const face = projectFlight(samples, { ...camera, view: 'face' }, ball, target, 1280, 720);
    const faceRays = imageRays(face, ball, target, 1280, 720);
    expect(face[0].x).toBeCloseTo(ball.x, 4);
    expect(Math.abs(faceRays.at(-1)!.across)).toBeLessThan(1.5);
    expect(Math.max(...faceRays.map((ray) => ray.along))).toBeGreaterThan(faceRays.at(-1)!.along + 10);

    const wedge = simulateShot({ ...emptyShot(), ballSpeed: 100, vla: 30, spin: 9000 })!;
    const driverAlong = imageRays(projectFlight(samples, camera, ball, target, width, height), ball, target, width, height).at(-1)!.along;
    const wedgeAlong = imageRays(projectFlight(wedge.samples, camera, ball, target, width, height), ball, target, width, height).at(-1)!.along;
    expect(wedgeAlong).toBeLessThan(driverAlong);
  });

  it('draws a fade as a curve off the start line, not a tilted straight stroke', () => {
    const fade = simulateShot({ ...emptyShot(), ballSpeed: 155, vla: 14, hla: -3, spin: 2800, spinAxis: 4 })!;
    const straight = driver(0, 0)!;
    const push = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, hla: -3, spin: 2500, spinAxis: 0 })!;
    const portrait = { view: 'dtl' as const, height: 1.4, distance: 3.5, fov: 60 };
    const tee = { x: 0.5, y: 0.78 };
    const aim = { x: 0.5, y: 0.32 };
    const width = 1080;
    const height = 1920;
    const fadePath = projectFlight(fade.samples, portrait, tee, aim, width, height);
    const straightPath = projectFlight(straight.samples, portrait, tee, aim, width, height);
    const pushPath = projectFlight(push.samples, portrait, tee, aim, width, height);

    expect(fadePath.length).toBeGreaterThan(120);
    expect(lineDeviation(straightPath, width, height)).toBeLessThan(2);
    expect(lineDeviation(fadePath, width, height)).toBeGreaterThan(50);

    const fadeRays = imageRays(fadePath, tee, aim, width, height);
    const started = fadeRays.find((ray) => ray.t >= 0.25)!;
    expect(started.across).toBeLessThan(-40);
    expect(started.across).toBeGreaterThan(-180);
    const landing = fadeRays.at(-1)!;
    const leftmost = Math.min(...fadeRays.map((ray) => ray.across));
    expect(landing.across).toBeLessThan(-8);
    expect(landing.across).toBeGreaterThan(leftmost + 60);
    expect(fadePath.every((point) => point.x > 0.05 && point.x < 0.95 && point.y > 0.05 && point.y < 0.98)).toBe(true);

    const straightRays = imageRays(straightPath, tee, aim, width, height);
    expect(Math.abs(straightRays.at(-1)!.across)).toBeLessThan(1.5);
    expect(Math.max(...straightRays.map((ray) => ray.along))).toBeGreaterThan(straightRays.at(-1)!.along + 20);
    const straightLanding = straightPath.at(-1)!;
    expect(straightLanding.y).toBeGreaterThan(0.35);
    expect(straightLanding.y).toBeLessThan(tee.y - 0.1);
    expect(Math.min(...straightPath.map((point) => point.y))).toBeLessThan(straightLanding.y - 0.05);

    expect(push.curveYd).toBeLessThan(-11);
    expect(push.curveYd).toBeGreaterThan(-16);
    const pushLanding = imageRays(pushPath, tee, aim, width, height).at(-1)!;
    const hFov = 2 * Math.atan(Math.tan(((60 * Math.PI) / 180) / 2) * (width / height));
    const degrees = (pushLanding.across / width) * ((hFov * 180) / Math.PI);
    expect(degrees).toBeLessThan(-2);
    expect(degrees).toBeGreaterThan(-4.5);
  });

  it('shrinks the arc in the frame when the field of view opens', () => {
    const span = (fov: number) => {
      const path = projectFlight(samples, { ...camera, fov }, ball, target, width, height);
      const apex = path.reduce((best, point) => (point.y < best.y ? point : best), path[0]);
      return Math.hypot((apex.x - ball.x) * width, (apex.y - ball.y) * height);
    };
    expect(span(75)).toBeLessThan(span(40));
  });
});

describe('tracer timing', () => {
  it('hides the line before impact, grows through the flight, and holds the landing', () => {
    expect(tracerPlayhead(1, 1.4, 6.8)).toBe(0);
    expect(tracerPlayhead(3, 1.4, 6.8)).toBeCloseTo(1.6);
    expect(tracerPlayhead(10, 1.4, 6.8)).toBe(6.8);
    expect(tracerPlayhead(2.2, 1.4, 6.8, 1)).toBeCloseTo(1.8);
    expect(tracerPlayhead(2.2, 1.4, 6.8, 20)).toBe(6.8);
    expect(tracerPlayhead(4, null, 6.8)).toBe(0);
  });

  it('applies left as negative and right as positive', () => {
    expect(withSide(2.5, -1)).toBeCloseTo(-2.5);
    expect(withSide(-2.5, 1)).toBeCloseTo(2.5);
  });
});

describe('impact onset', () => {
  it('finds a sharp spike and ignores a quiet clip', () => {
    const rate = 16000;
    const samples = new Float32Array(rate * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.37) * 0.01;
    const at = Math.round(1.25 * rate);
    for (let i = 0; i < 80; i++) samples[at + i] = 0.85;
    const found = detectImpact(samples, rate);
    expect(found).not.toBeNull();
    expect(found!).toBeGreaterThan(1.2);
    expect(found!).toBeLessThan(1.32);
    expect(detectImpact(new Float32Array(rate), rate)).toBeNull();
  });
});

describe('tracer on a swing', () => {
  it('knows when there is a tracer to clear', () => {
    expect(tracerIsSet(emptyShot(), defaultTracer())).toBe(false);
    expect(tracerIsSet(null, null)).toBe(false);
    expect(tracerIsSet(emptyShot(), { ...defaultTracer(), impactTime: 1.2 })).toBe(true);
    expect(tracerIsSet(emptyShot(), { ...defaultTracer(), ball: { x: 0.5, y: 0.7 } })).toBe(true);
    expect(tracerIsSet({ ...emptyShot(), ballSpeed: 167 }, defaultTracer())).toBe(true);
    expect(tracerIsSet(emptyShot(), { ...defaultTracer(), cameraHeight: 2 })).toBe(true);
  });

  it('undoes a tracer clear ahead of older drawings and behind a newer one', () => {
    expect(chooseUndo({ hasDraft: true, hasTracerUndo: true, tracerStamp: 2, drawingStamp: 1, drawingSteps: 1 })).toBe('draft');
    expect(chooseUndo({ hasDraft: false, hasTracerUndo: true, tracerStamp: 3, drawingStamp: 1, drawingSteps: 2 })).toBe('tracer');
    expect(chooseUndo({ hasDraft: false, hasTracerUndo: true, tracerStamp: 1, drawingStamp: 4, drawingSteps: 1 })).toBe('drawing');
    expect(chooseUndo({ hasDraft: false, hasTracerUndo: true, tracerStamp: 1, drawingStamp: 0, drawingSteps: 0 })).toBe('tracer');
    expect(chooseUndo({ hasDraft: false, hasTracerUndo: false, tracerStamp: 0, drawingStamp: 0, drawingSteps: 0 })).toBe('none');
  });
});

describe('tesseract paths', () => {
  it('stays under the Pages base and does not point at a CDN', () => {
    const paths = tesseractPaths('/swingframe/');
    expect(paths.workerPath).toBe('/swingframe/tesseract/worker.min.js');
    expect(paths.corePath).toBe('/swingframe/tesseract/tesseract-core-simd-lstm.wasm.js');
    expect(paths.langPath).toBe('/swingframe/tesseract/lang');
    expect(JSON.stringify(paths)).not.toContain('jsdelivr');
    expect(JSON.stringify(paths)).not.toContain('http');
  });
});
