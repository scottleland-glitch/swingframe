import type { ShotData, ShotField } from '../types';
import { emptyShot } from './flight';

const LABELS: { field: ShotField | 'backSpin'; re: RegExp }[] = [
  { field: 'ballSpeed', re: /ball\s*spe{1,2}d/i },
  { field: 'vla', re: /\bvla\b|launch\s*ang(?:le)?|vertical\s*launch/i },
  { field: 'hla', re: /\bhla\b|launch\s*dir(?:ection)?|azimuth|side\s*ang(?:le)?|horizontal\s*launch/i },
  { field: 'spinAxis', re: /spin\s*axis|\baxis\b/i },
  { field: 'sideSpin', re: /side\s*spin/i },
  { field: 'backSpin', re: /back\s*spin/i },
  { field: 'spin', re: /spin\s*rate|total\s*spin|\bspin\b/i },
  { field: 'carry', re: /\bcarry\b/i },
  { field: 'apex', re: /\bapex\b|\bheight\b|peak\s*height/i },
  { field: 'curve', re: /\bcurve\b|\bside\b/i },
];

const DIRECTIONAL = new Set<ShotField | 'backSpin'>(['hla', 'spinAxis', 'sideSpin', 'curve']);

function normalizeOcr(text: string): string {
  return text
    .replace(/[°º]/g, ' ')
    .replace(/[|]/g, 'I')
    .replace(/(\d)\s*[Oo](?=\d)/g, '$10')
    .replace(/(?<!\w)[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo](?!\w)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
    .replace(/(?<=\d)[lI](?!\w)/g, '1')
    .replace(/(?<!\w)[lI](?=\d)/g, '1');
}

function matchLabel(line: string): { field: ShotField | 'backSpin'; end: number; length: number } | null {
  let best: { field: ShotField | 'backSpin'; end: number; length: number } | null = null;
  for (const label of LABELS) {
    const found = label.re.exec(line);
    if (!found) continue;
    const length = found[0].length;
    if (!best || length > best.length) {
      best = { field: label.field, end: found.index + length, length };
    }
  }
  return best;
}

function parseNumber(text: string): number | null {
  const match = /(-?\d[\d,]*(?:\.\d+)?)(?:\s*([RrLl]))?/.exec(text);
  if (!match) return null;
  const magnitude = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(magnitude)) return null;
  if (match[1].startsWith('-')) return magnitude;
  if (match[2] && /[Ll]/.test(match[2])) return -Math.abs(magnitude);
  return Math.abs(magnitude);
}

function plausible(field: ShotField | 'backSpin', value: number): number | null {
  const abs = Math.abs(value);
  if (field === 'ballSpeed') {
    const speed = abs > 250 && abs <= 2500 ? abs / 10 : abs;
    return speed >= 40 && speed <= 230 ? speed : null;
  }
  if (field === 'vla') {
    const angle = abs > 60 && abs <= 600 ? value / 10 : value;
    return angle >= -15 && angle <= 70 ? angle : null;
  }
  if (field === 'hla' || field === 'spinAxis') return abs <= 60 ? value : null;
  if (field === 'spin' || field === 'backSpin') return abs >= 50 && abs <= 16000 ? abs : null;
  if (field === 'sideSpin') return abs <= 12000 ? value : null;
  if (field === 'carry') return abs >= 5 && abs <= 450 ? abs : null;
  if (field === 'apex') return abs >= 1 && abs <= 250 ? abs : null;
  if (field === 'curve') return abs <= 120 ? value : null;
  return null;
}

function readValue(field: ShotField | 'backSpin', raw: number): number | null {
  const signed = DIRECTIONAL.has(field) ? raw : Math.abs(raw);
  return plausible(field, signed);
}

/**
 * Pull Foresight-style labels out of OCR text.
 * Does not invent carry, apex, or curve. Club speed, smash, and attack angle are ignored.
 */
export function parseForesightText(text: string): ShotData {
  const shot = emptyShot();
  let backSpin: number | null = null;
  const lines = normalizeOcr(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const label = matchLabel(lines[i]);
    if (!label) continue;
    if (label.field !== 'backSpin' && shot[label.field] != null) continue;
    let raw = parseNumber(lines[i].slice(label.end));
    if (raw == null && i + 1 < lines.length && !matchLabel(lines[i + 1])) {
      raw = parseNumber(lines[i + 1]);
      if (raw != null) used.add(i + 1);
    }
    if (raw == null) continue;
    const value = readValue(label.field, raw);
    if (value == null) continue;
    if (label.field === 'backSpin') {
      backSpin = value;
      continue;
    }
    shot[label.field] = value;
    shot.sources[label.field] = 'screen';
  }

  if (shot.spin == null && backSpin != null) {
    if (shot.sideSpin != null) {
      shot.spin = Math.round(Math.hypot(backSpin, shot.sideSpin));
      if (shot.spinAxis == null) {
        shot.spinAxis = Math.round((Math.atan2(shot.sideSpin, backSpin) * 180) / Math.PI * 10) / 10;
        shot.sources.spinAxis = 'screen';
      }
    } else {
      shot.spin = backSpin;
    }
    shot.sources.spin = 'screen';
  }
  return shot;
}
