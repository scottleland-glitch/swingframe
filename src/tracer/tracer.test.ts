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

  it('derives launch direction from face to target and curve from face to path', () => {
    const fromFace = completeShot({
      ...emptyShot(),
      faceToTarget: -2.5,
      sources: { faceToTarget: 'typed' },
    });
    expect(fromFace.hla).toBeCloseTo(-2);
    expect(fromFace.sources.hla).toBe('model');

    const measured = completeShot({
      ...emptyShot(),
      hla: 1.2,
      faceToTarget: 5,
      sources: { hla: 'screen', faceToTarget: 'screen' },
    });
    expect(measured.hla).toBe(1.2);

    const curved = completeShot({
      ...emptyShot(),
      ballSpeed: 150,
      vla: 14,
      spin: 6000,
      faceToPath: -8,
      sources: { ballSpeed: 'typed', vla: 'typed', spin: 'typed', faceToPath: 'typed' },
    });
    expect(curved.spinAxis).toBeCloseTo(-8);
    expect(curved.curve).toBeLessThan(-2);

    const preferred = completeShot({
      ...emptyShot(),
      ballSpeed: 150,
      vla: 12,
      spin: 3000,
      sideSpin: 400,
      faceToPath: -5,
      sources: { ballSpeed: 'typed', vla: 'typed', spin: 'typed', sideSpin: 'typed', faceToPath: 'typed' },
    });
    expect(preferred.spinAxis).toBeGreaterThan(0);

    const rough = completeShot({
      ...emptyShot(),
      faceToPath: 3,
      carry: 225,
      sources: { faceToPath: 'typed', carry: 'typed' },
    });
    expect(rough.curve).toBeCloseTo(9);
    expect(rough.sources.curve).toBe('model');

    const edited = editShot(fromFace, 'faceToTarget', 4);
    expect(edited.hla).toBeCloseTo(3.2);
    const typed = editShot(fromFace, 'hla', 0.4);
    expect(editShot(typed, 'faceToTarget', 5).hla).toBeCloseTo(0.4);
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
    expect(shot.carry).toBeCloseTo(276);
    expect(shot.apex).toBeNull();
    expect(shot.sources.carry).toBe('screen');
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
    expect(shot.sideSpin).toBe(320);
    expect(shot.apex).toBe(96);
    expect(shot.carry).toBeNull();
    const filled = mergeScreen(emptyShot(), shot);
    expect(filled.carry).not.toBeNull();
    expect(filled.sources.carry).toBe('model');
    expect(filled.sources.ballSpeed).toBe('screen');
    expect(filled.spinAxis).not.toBeNull();
    expect(filled.spinAxis!).toBeGreaterThan(0);
  });

  it('builds total spin from back spin and side spin', () => {
    const shot = parseForesightText('Back Spin 5200\nSide Spin 400 L\nCurve 6.5 L');
    expect(shot.spin).toBe(Math.round(Math.hypot(5200, 400)));
    expect(shot.spinAxis).toBeLessThan(0);
    expect(shot.curve).toBeCloseTo(-6.5);
  });

  it('reads club path and face angles without mixing them into launch direction', () => {
    const shot = parseForesightText(`
      Launch Direction 1.2 L
      Club Path 3.4 R
      Face to Target 0.8 R
      Face to Path 4.2 L
      Attack Angle -2.4
    `);
    expect(shot.hla).toBeCloseTo(-1.2);
    expect(shot.clubPath).toBeCloseTo(3.4);
    expect(shot.faceToTarget).toBeCloseTo(0.8);
    expect(shot.faceToPath).toBeCloseTo(-4.2);
    expect(shot.vla).toBeNull();
  });
});

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
