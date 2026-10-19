import { describe, expect, it } from 'vitest';
import { chooseUndo, tracerIsSet } from './active';
import { completeShot, editShot, emptyShot, mergeScreen, sampleAt, simulateShot } from './flight';
import { detectImpact } from './impact';
import { tesseractPaths } from './ocrPaths';
import { parseForesightText } from './parseShot';
import { defaultTracer, projectFlight, type TracerPoint } from './project';
import { withSide } from './sign';
import { clipEndTime, holdSpan, nextHold, playClock, tracerPlayhead, tracerProgress } from './timing';
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
    expect(flight!.carryYd).toBeLessThan(305);
    expect(flight!.apexFt).toBeGreaterThan(100);
    expect(flight!.apexFt).toBeLessThan(120);
    expect(flight!.samples.at(-1)?.y).toBe(0);
    expect(flight!.flightTime).toBeGreaterThan(6);
    expect(flight!.flightTime).toBeLessThan(7.5);
  });

  it('keeps a wedge in the air for about five or six seconds', () => {
    const wedge = simulateShot({ ...emptyShot(), ballSpeed: 100, vla: 30, hla: 0, spin: 9000, spinAxis: 0 });
    expect(wedge).not.toBeNull();
    expect(wedge!.samples.at(-1)?.y).toBe(0);
    expect(wedge!.flightTime).toBeGreaterThan(5);
    expect(wedge!.flightTime).toBeLessThan(6.3);
  });

  it('curves a driver about two yards per degree of spin axis, and less for an iron and a wedge', () => {
    const driver = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, spin: 2500, spinAxis: 10 });
    expect(driver).not.toBeNull();
    expect(driver!.carryYd).toBeGreaterThan(255);
    expect(driver!.carryYd).toBeLessThan(270);
    expect(driver!.apexFt).toBeGreaterThan(70);
    expect(driver!.apexFt).toBeLessThan(110);
    expect(driver!.curveYd).toBeGreaterThan(20);
    expect(driver!.curveYd).toBeLessThan(25);

    const pushedFade = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, hla: -2, spin: 2500, spinAxis: 10 })!;
    expect(pushedFade.curveYd).toBeGreaterThan(12);
    expect(pushedFade.curveYd).toBeLessThan(15);

    const iron = simulateShot({ ...emptyShot(), ballSpeed: 120, vla: 16, spin: 7000, spinAxis: 10 })!;
    expect(iron.curveYd).toBeGreaterThan(10);
    expect(iron.curveYd).toBeLessThan(14);

    const wedge = simulateShot({ ...emptyShot(), ballSpeed: 100, vla: 30, spin: 9000, spinAxis: 10 })!;
    expect(wedge.curveYd).toBeGreaterThan(6);
    expect(wedge.curveYd).toBeLessThan(9);

    const draw = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, spin: 2500, spinAxis: -10 })!;
    expect(draw.curveYd).toBeLessThan(-20);
    expect(draw.curveYd).toBeGreaterThan(-25);
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

/** Degrees off the ball-to-aim line. Positive is right. Skips the point on the ball. */
function positionAngles(path: TracerPoint[], ball: Pt, target: Pt, width: number, height: number): number[] {
  return imageRays(path, ball, target, width, height).flatMap((ray) => {
    if (Math.hypot(ray.across, ray.along) < 4) return [];
    return [(Math.atan2(ray.across, ray.along) * 180) / Math.PI];
  });
}

function risesThenFalls(path: TracerPoint[], height: number) {
  expect(path.length).toBeGreaterThan(20);
  let apex = 0;
  for (let i = 1; i < path.length; i++) if (path[i].y < path[apex].y) apex = i;
  expect(apex).toBeGreaterThan(path.length * 0.15);
  expect(apex).toBeLessThan(path.length * 0.85);
  const slack = 2 / height;
  for (let i = 1; i <= apex; i++) expect(path[i].y).toBeLessThanOrEqual(path[i - 1].y + slack);
  for (let i = apex + 1; i < path.length; i++) expect(path[i].y).toBeGreaterThanOrEqual(path[i - 1].y - slack);
}

/** Proper crossings only. A straight ray that climbs and comes back down overlaps itself and does not count. */
function properCrossings(path: TracerPoint[]): number {
  const orient = (a: TracerPoint, b: TracerPoint, c: TracerPoint) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  let hits = 0;
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = i + 2; j < path.length - 1; j++) {
      const a = path[i];
      const b = path[i + 1];
      const c = path[j];
      const d = path[j + 1];
      const o1 = orient(a, b, c);
      const o2 = orient(a, b, d);
      const o3 = orient(c, d, a);
      const o4 = orient(c, d, b);
      if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) continue;
      if (o1 !== o2 && o3 !== o4) hits++;
    }
  }
  return hits;
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

  it('curves a fade off the launch line without bending the start back toward a landing spot', () => {
    const fade = simulateShot({ ...emptyShot(), ballSpeed: 155, vla: 14, hla: -3, spin: 2800, spinAxis: 4 })!;
    const push = simulateShot({ ...emptyShot(), ballSpeed: 155, vla: 14, hla: -3, spin: 2800, spinAxis: 0 })!;
    const straight = driver(0, 0)!;
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
    const straightRays = imageRays(straightPath, tee, aim, width, height);
    expect(Math.abs(straightRays.at(-1)!.across)).toBeLessThan(1.5);
    expect(Math.max(...straightRays.map((ray) => ray.along))).toBeGreaterThan(straightRays.at(-1)!.along + 20);
    const straightLanding = straightPath.at(-1)!;
    expect(straightLanding.y).toBeGreaterThan(0.35);
    expect(straightLanding.y).toBeLessThan(tee.y - 0.1);
    expect(Math.min(...straightPath.map((point) => point.y))).toBeLessThan(straightLanding.y - 0.05);

    const fadeAngles = positionAngles(fadePath, tee, aim, width, height);
    const pushAngles = positionAngles(pushPath, tee, aim, width, height);
    expect(fadeAngles[0]).toBeCloseTo(-3, 1);
    expect(pushAngles[0]).toBeCloseTo(fadeAngles[0], 1);
    expect(Math.max(...pushAngles) - Math.min(...pushAngles)).toBeLessThan(0.6);
    expect(pushAngles.at(-1)!).toBeLessThan(-1.5);
    for (let i = 1; i < fadeAngles.length; i++) {
      expect(fadeAngles[i]).toBeGreaterThanOrEqual(fadeAngles[i - 1] - 0.03);
    }
    expect(fadeAngles.at(-1)!).toBeGreaterThan(fadeAngles[0] + 0.4);
    expect(Math.abs(fadePath.at(-1)!.x - aim.x)).toBeGreaterThan(0.005);
    expect(fadePath.every((point) => point.x > 0.02 && point.x < 0.98 && point.y > 0.02 && point.y < 0.98)).toBe(true);

    expect(push.curveYd).toBeLessThan(-8);
    expect(push.curveYd).toBeGreaterThan(-20);
    const pushLanding = positionAngles(pushPath, tee, aim, width, height).at(-1)!;
    expect(pushLanding).toBeLessThan(-2);
    expect(pushLanding).toBeGreaterThan(-4.5);
  });

  it('puts the straight carry on the tapped ground height without moving the sideways finish', () => {
    const straight = driver(0, 0)!;
    const fade = driver(8)!;
    const draw = driver(-8)!;
    const ground = { x: 0.12, y: 0.52 };
    const tee = { x: 0.5, y: 0.78 };
    const aim = { x: 0.5, y: 0.3 };
    const width = 1080;
    const height = 1920;
    const tuned = projectFlight(straight.samples, camera, tee, aim, width, height, ground);
    const untouched = projectFlight(straight.samples, camera, tee, aim, width, height);
    expect(Math.abs(tuned.at(-1)!.y - ground.y)).toBeLessThan(0.02);
    expect(untouched.at(-1)!.y).not.toBeCloseTo(ground.y, 2);
    const fadePath = projectFlight(fade.samples, camera, tee, aim, width, height, ground);
    const drawPath = projectFlight(draw.samples, camera, tee, aim, width, height, ground);
    const fadeElsewhere = projectFlight(fade.samples, camera, tee, aim, width, height, { x: 0.9, y: ground.y });
    expect(fadeElsewhere).toEqual(fadePath);
    expect(Math.abs(fadePath.at(-1)!.x - drawPath.at(-1)!.x)).toBeGreaterThan(0.008);
    expect(Math.abs(fadePath.at(-1)!.x - ground.x)).toBeGreaterThan(0.05);
    expect(Math.abs(fadePath.at(-1)!.x - aim.x)).toBeGreaterThan(0.004);
    expect(Math.abs(drawPath.at(-1)!.x - aim.x)).toBeGreaterThan(0.004);
    const straightRays = imageRays(tuned, tee, aim, width, height);
    expect(Math.abs(straightRays.at(-1)!.across)).toBeLessThan(2);
    expect(projectFlight(straight.samples, camera, tee, aim, width, height, null)).toEqual(untouched);
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

describe('launch line with a horizon tap', () => {
  const portrait = { view: 'dtl' as const, height: 1.4, distance: 3.5, fov: 60 };
  const tee = { x: 0.5, y: 0.72 };
  const aim = { x: 0.5, y: 0.28 };
  // The sideways part of the tap is a decoy. It must not become the landing.
  const ground = { x: 0.82, y: 0.55 };
  const width = 1080;
  const height = 1920;

  function shot(spinAxis: number) {
    return simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, hla: -2, spin: 2800, spinAxis })!;
  }

  function project(spinAxis: number, groundPoint: Pt = ground) {
    return projectFlight(shot(spinAxis).samples, portrait, tee, aim, width, height, groundPoint);
  }

  it('keeps a 2° left launch left of the aim line, with no curve back, when the axis is zero', () => {
    const path = project(0);
    const angles = positionAngles(path, tee, aim, width, height);
    expect(angles[0]).toBeCloseTo(-2, 1);
    expect(Math.max(...angles)).toBeLessThan(-1);
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(0.5);
    expect(angles.at(-1)!).toBeLessThanOrEqual(angles[0] + 0.15);
    expect(Math.abs(path.at(-1)!.x - aim.x)).toBeGreaterThan(0.008);
    expect(Math.abs(path.at(-1)!.x - ground.x)).toBeGreaterThan(0.05);
    risesThenFalls(path, height);
  });

  it('starts a 10° right axis on that same line and curves only to the right', () => {
    const straight = positionAngles(project(0), tee, aim, width, height);
    const path = project(10);
    const fade = positionAngles(path, tee, aim, width, height);
    expect(fade[0]).toBeCloseTo(-2, 1);
    expect(fade[0]).toBeCloseTo(straight[0], 1);
    expect(fade[0]).toBeGreaterThan(straight[0] - 0.08);
    for (let i = 1; i < fade.length; i++) {
      expect(fade[i]).toBeGreaterThanOrEqual(fade[i - 1] - 0.03);
    }
    expect(fade.at(-1)!).toBeGreaterThan(fade[0] + 0.5);
    expect(Math.abs(path.at(-1)!.x - aim.x)).toBeGreaterThan(0.008);
    expect(Math.abs(path.at(-1)!.x - ground.x)).toBeGreaterThan(0.05);
    risesThenFalls(path, height);
    expect(properCrossings(path)).toBe(0);
  });

  it('keeps the same initial direction when the spin axis or the horizon tap changes', () => {
    const base = positionAngles(project(0), tee, aim, width, height)[0];
    for (const axis of [-20, -10, 5, 10, 20]) {
      expect(positionAngles(project(axis), tee, aim, width, height)[0]).toBeCloseTo(base, 1);
    }
    const tiltedAim = { x: 0.68, y: 0.4 };
    const tilted = positionAngles(
      projectFlight(shot(10).samples, portrait, tee, tiltedAim, width, height, ground),
      tee,
      tiltedAim,
      width,
      height,
    )[0];
    expect(tilted).toBeCloseTo(-2, 1);
    const higher = positionAngles(project(10, { x: 0.2, y: 0.42 }), tee, aim, width, height)[0];
    expect(higher).toBeCloseTo(base, 1);
    expect(project(10, { x: 0.1, y: ground.y })).toEqual(project(10));
  });
});

describe('descent keeps bending away from the start line', () => {
  const portrait = { view: 'dtl' as const, height: 1.4, distance: 3.5, fov: 60 };
  const tee = { x: 0.5, y: 0.72 };
  const aim = { x: 0.5, y: 0.28 };
  const ground = { x: 0.82, y: 0.55 };
  const width = 1080;
  const height = 1920;

  function flightFor(club: 'driver' | 'iron', hla: number, axis: number) {
    if (club === 'driver') {
      return simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, hla, spin: 2500, spinAxis: axis })!;
    }
    return simulateShot({ ...emptyShot(), ballSpeed: 120, vla: 16, hla, spin: 7000, spinAxis: axis })!;
  }

  /** Pixels off the drawn start line. Positive is right. */
  function offsetsOf(path: TracerPoint[]) {
    const rays = imageRays(path, tee, aim, width, height);
    const first = rays.find((ray) => Math.hypot(ray.across, ray.along) >= 4);
    const a0 = first ? Math.atan2(first.across, first.along) : 0;
    return rays.map((ray) => {
      const rad = Math.hypot(ray.across, ray.along);
      return { t: ray.t, off: rad * Math.sin(Math.atan2(ray.across, ray.along) - a0) };
    });
  }

  function assertFlares(club: 'driver' | 'iron', hla: number, axis: number) {
    const flight = flightFor(club, hla, axis);
    const sign = Math.sign(axis);
    const heading = Math.atan2(flight.samples[1].x, flight.samples[1].z);
    const world = flight.samples.map((sample) => sample.x * Math.cos(heading) - sample.z * Math.sin(heading));
    for (let i = 1; i < world.length; i++) {
      expect((world[i] - world[i - 1]) * sign).toBeGreaterThanOrEqual(-1e-4);
    }
    let apex = 0;
    for (let i = 1; i < flight.samples.length; i++) {
      if (flight.samples[i].y > flight.samples[apex].y) apex = i;
    }
    const worldAscent = world[apex] / flight.samples[apex].t;
    const worldDescent =
      (world[world.length - 1] - world[apex]) / (flight.samples[flight.samples.length - 1].t - flight.samples[apex].t);
    expect(worldDescent * sign).toBeGreaterThanOrEqual(worldAscent * sign);

    const path = projectFlight(flight.samples, portrait, tee, aim, width, height, ground);
    const offsets = offsetsOf(path);
    expect(offsets.length).toBeGreaterThan(20);
    for (let i = 1; i < offsets.length; i++) {
      expect((offsets[i].off - offsets[i - 1].off) * sign).toBeGreaterThanOrEqual(-0.05);
    }
    const before = offsets.filter((point) => point.t <= flight.samples[apex].t + 1e-9);
    const after = offsets.filter((point) => point.t >= flight.samples[apex].t - 1e-9);
    expect(before.length).toBeGreaterThan(2);
    expect(after.length).toBeGreaterThan(2);
    const ascent = (before[before.length - 1].off - before[0].off) / (before[before.length - 1].t - before[0].t);
    const descent = (after[after.length - 1].off - after[0].off) / (after[after.length - 1].t - after[0].t);
    expect(descent * sign).toBeGreaterThanOrEqual(ascent * sign);
    expect(Math.abs(path[path.length - 1].x - aim.x)).toBeGreaterThan(0.008);
    expect(Math.abs(path[path.length - 1].x - ground.x)).toBeGreaterThan(0.05);
  }

  it('flares a driver and a 7-iron at 10, 20, and 40 degrees, both ways', () => {
    for (const club of ['driver', 'iron'] as const) {
      for (const axis of [10, 20, 40, -10, -20, -40]) {
        assertFlares(club, axis > 0 ? -2 : 2, axis);
      }
    }
  });

  it('mirrors a 2° right launch with a 40° left axis against a 2° left launch with a 40° right axis', () => {
    for (const club of ['driver', 'iron'] as const) {
      const fade = projectFlight(flightFor(club, -2, 40).samples, portrait, tee, aim, width, height, ground);
      const draw = projectFlight(flightFor(club, 2, -40).samples, portrait, tee, aim, width, height, ground);
      expect(draw.length).toBe(fade.length);
      for (let i = 0; i < fade.length; i++) {
        expect(draw[i].t).toBeCloseTo(fade[i].t, 5);
        expect(draw[i].y).toBeCloseTo(fade[i].y, 4);
        expect(draw[i].x + fade[i].x).toBeCloseTo(tee.x * 2, 4);
      }
      const fadeOff = offsetsOf(fade);
      const drawOff = offsetsOf(draw);
      expect(fadeOff[fadeOff.length - 1].off).toBeGreaterThan(40);
      expect(drawOff[drawOff.length - 1].off).toBeLessThan(-40);
      expect(drawOff[drawOff.length - 1].off).toBeCloseTo(-fadeOff[fadeOff.length - 1].off, 1);
    }
  });
});

describe('version 29 tracer picture', () => {
  it('matches the v29 flight for a 2° left, 40° right driver', () => {
    const flight = simulateShot({ ...emptyShot(), ballSpeed: 150, vla: 12, hla: -2, spin: 2500, spinAxis: 40 })!;
    const camera = { view: 'dtl' as const, height: 1.4, distance: 3.5, fov: 60 };
    const ball = { x: 0.5, y: 0.78 };
    const aim = { x: 0.5, y: 0.28 };
    const ground = { x: 0.18, y: 0.52 };
    const path = projectFlight(flight.samples, camera, ball, aim, 1080, 1920, ground);
    const bare = projectFlight(flight.samples, camera, ball, aim, 1080, 1920);
    let apex = 0;
    for (let i = 1; i < path.length; i++) if (path[i].y < path[apex].y) apex = i;
    expect(flight.carryYd).toBeCloseTo(226.9865, 3);
    expect(flight.curveYd).toBeCloseTo(54.6206, 3);
    expect(path).toHaveLength(260);
    expect(path.at(-1)!.x).toBeCloseTo(0.615615, 5);
    expect(path.at(-1)!.y).toBeCloseTo(0.517682, 5);
    expect(path.at(-1)!.t).toBeCloseTo(5.1603, 3);
    expect(path[apex].x).toBeCloseTo(0.488566, 5);
    expect(path[apex].y).toBeCloseTo(0.394908, 5);
    expect(bare.at(-1)!.y).toBeCloseTo(0.444167, 5);
    expect(projectFlight(flight.samples, camera, ball, aim, 1080, 1920, { x: 0.9, y: ground.y })).toEqual(path);
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

  it('finishes the tracer on the last frame when the clip ends before the ball lands', () => {
    const end = 9.3;
    const impact = 3.5;
    const flight = 6.8;
    expect(clipEndTime(end, null, null)).toBe(end);
    expect(clipEndTime(end, 1, 4)).toBe(4);
    expect(clipEndTime(end, 1, null)).toBe(end);
    const cap = holdSpan(end, impact, flight);
    expect(cap).toBeCloseTo(1);

    const atClip = playClock({ videoTime: end, clipEnd: end, impact, flightTime: flight, hold: 0 });
    expect(atClip.pictureDone).toBe(true);
    expect(atClip.holding).toBe(true);
    expect(atClip.landed).toBe(false);
    expect(atClip.playbackTime).toBeCloseTo(end);
    expect(tracerPlayhead(atClip.playbackTime, impact, flight)).toBeCloseTo(5.8);

    // A video clock that runs past the file, the way the pill did, is not tracer time.
    const runaway = playClock({ videoTime: 10.29, clipEnd: end, impact, flightTime: flight, hold: 0 });
    expect(runaway.playbackTime).toBeCloseTo(end);
    expect(runaway.holding).toBe(true);
    expect(tracerPlayhead(runaway.playbackTime, impact, flight)).toBeCloseTo(5.8);

    const stepped = nextHold(0, 0.5, 1, end, impact, flight);
    expect(stepped).toBeCloseTo(0.5);
    const mid = playClock({ videoTime: end, clipEnd: end, impact, flightTime: flight, hold: stepped });
    expect(mid.playbackTime).toBeCloseTo(9.8);
    expect(tracerPlayhead(mid.playbackTime, impact, flight)).toBeCloseTo(6.3);

    const full = nextHold(stepped, 1, 1, end, impact, flight);
    expect(full).toBeCloseTo(cap);
    const landed = playClock({ videoTime: end, clipEnd: end, impact, flightTime: flight, hold: full });
    expect(landed.playbackTime).toBeCloseTo(10.3);
    expect(landed.holding).toBe(false);
    expect(landed.landed).toBe(true);
    expect(tracerPlayhead(landed.playbackTime, impact, flight)).toBeCloseTo(flight);

    expect(nextHold(0, 0.5, 0.25, end, impact, flight)).toBeCloseTo(0.125);

    const early = playClock({ videoTime: 8, clipEnd: end, impact, flightTime: flight, hold: 2 });
    expect(early.pictureDone).toBe(false);
    expect(early.hold).toBe(0);
    expect(early.playbackTime).toBeCloseTo(8);
    expect(tracerPlayhead(early.playbackTime, impact, flight)).toBeCloseTo(4.5);
  });

  it('draws the ground landing and reaches it at the end of the hold', () => {
    const flight = simulateShot({ ...emptyShot(), ballSpeed: 100, vla: 32, hla: 0, spin: 9000, spinAxis: 0 });
    expect(flight).not.toBeNull();
    const last = flight!.samples.at(-1)!;
    const prev = flight!.samples.at(-2)!;
    expect(last.y).toBe(0);
    expect(prev.y).toBeGreaterThan(0);
    expect(last.t).toBeGreaterThan(prev.t);
    expect(last.t - prev.t).toBeLessThanOrEqual(0.02 + 1e-9);
    expect(sampleAt(flight!.samples, last.t - 0.05).y).toBeGreaterThan(0);
    expect(sampleAt(flight!.samples, last.t).y).toBe(0);
    expect(sampleAt(flight!.samples, last.t).z).toBeCloseTo(last.z);

    const defaults = defaultTracer();
    const path = projectFlight(
      flight!.samples,
      { view: 'dtl', height: defaults.cameraHeight, distance: defaults.cameraDistance, fov: defaults.fov },
      { x: 0.5, y: 0.62 },
      { x: 0.5, y: 0.4 },
      1080,
      1920,
    );
    expect(path.at(-1)?.t).toBeCloseTo(last.t, 5);

    const impact = 3.5;
    const clipEnd = 8;
    const cap = holdSpan(clipEnd, impact, flight!.flightTime);
    expect(cap).toBeGreaterThan(0.2);
    const finished = playClock({ videoTime: clipEnd, clipEnd, impact, flightTime: flight!.flightTime, hold: cap });
    expect(finished.landed).toBe(true);
    expect(finished.holding).toBe(false);
    const elapsed = tracerPlayhead(finished.playbackTime, impact, flight!.flightTime);
    expect(tracerProgress(elapsed, flight!.flightTime)).toBe(1);
    expect(sampleAt(flight!.samples, elapsed).y).toBe(0);

    const short = playClock({
      videoTime: clipEnd,
      clipEnd,
      impact,
      flightTime: flight!.flightTime,
      hold: cap - 0.02,
    });
    expect(short.holding).toBe(true);
    expect(tracerProgress(tracerPlayhead(short.playbackTime, impact, flight!.flightTime), flight!.flightTime)).toBeLessThan(1);
    expect(sampleAt(flight!.samples, tracerPlayhead(short.playbackTime, impact, flight!.flightTime)).y).toBeGreaterThan(0);
  });

  it('keeps a 100 mph, 32° wedge on wedge carry', () => {
    const carries = [5000, 7000, 9000, 11000].map((spin) => {
      const flight = simulateShot({ ...emptyShot(), ballSpeed: 100, vla: 32, hla: 0, spin, spinAxis: 0 });
      expect(flight).not.toBeNull();
      expect(flight!.samples.at(-1)?.y).toBe(0);
      expect(flight!.carryYd).toBeGreaterThan(90);
      expect(flight!.carryYd).toBeLessThan(160);
      return flight!.carryYd;
    });
    expect(carries[0]).toBeGreaterThan(carries[3]);
    expect(carries[3]).toBeGreaterThan(100);
    expect(carries[3]).toBeLessThan(140);
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
    expect(tracerIsSet(emptyShot(), { ...defaultTracer(), manualStart: { x: 0.5, y: 0.7 } })).toBe(true);
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
