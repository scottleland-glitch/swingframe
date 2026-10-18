import { describe, expect, it } from 'vitest';
import { completeShot, editShot, emptyShot, mergeScreen, simulateShot } from './flight';
import { detectImpact } from './impact';
import { tesseractPaths } from './ocrPaths';
import { parseForesightText } from './parseShot';
import { defaultTracer, projectFlight } from './project';

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
    expect(flight!.flightTime).toBeGreaterThan(2);
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
});

describe('camera projection', () => {
  const samples = driver()!.samples;
  const camera = { view: 'dtl' as const, height: defaultTracer().cameraHeight, distance: defaultTracer().cameraDistance, fov: 58 };
  const ball = { x: 0.48, y: 0.74 };
  const target = { x: 0.53, y: 0.36 };

  it('pins the ball to the tap and aims the first step at the target', () => {
    const path = projectFlight(samples, camera, ball, target, 720, 1280);
    expect(path[0].x).toBeCloseTo(ball.x, 4);
    expect(path[0].y).toBeCloseTo(ball.y, 4);
    const ahead = path.find((point) => point.t >= 0.2)!;
    const got = Math.atan2(ahead.y - path[0].y, ahead.x - path[0].x);
    const want = Math.atan2(target.y - ball.y, target.x - ball.x);
    let diff = got - want;
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    expect(Math.abs(diff)).toBeLessThan(0.08);
  });

  it('shrinks the arc in the frame when the field of view opens, and works face on', () => {
    const span = (fov: number) => {
      const path = projectFlight(samples, { ...camera, fov }, ball, target, 720, 1280);
      const apex = path.reduce((best, point) => (point.y < best.y ? point : best), path[0]);
      return Math.hypot(apex.x - ball.x, apex.y - ball.y);
    };
    expect(span(75)).toBeLessThan(span(40));
    const face = projectFlight(samples, { ...camera, view: 'face' }, ball, target, 1280, 720);
    expect(face[0].x).toBeCloseTo(ball.x, 4);
    expect(face.length).toBeGreaterThan(10);
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
