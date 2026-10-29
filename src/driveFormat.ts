import type { Drawing, DriveLink, Pt, ShotData, ShotField, ShotSource, SwingMeta, TracerCalibration, ViewAngle } from './types';
import { UPLOAD_CHUNK_BYTES } from './driveConfig';

export interface SwingBackupFile {
  version: 1;
  id: string;
  view: ViewAngle;
  date: string;
  club: string;
  notes: string;
  createdAt: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  trimIn: number | null;
  trimOut: number | null;
  mirrored: boolean;
  mimeType: string;
  fileName: string;
  byteSize: number;
  drawings: Drawing[];
  drive: DriveLink;
  shot: ShotData | null;
  tracer: TracerCalibration | null;
}

export function uploadRanges(total: number, chunk = UPLOAD_CHUNK_BYTES): { start: number; end: number }[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  const ranges: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += chunk) {
    ranges.push({ start, end: Math.min(total, start + chunk) - 1 });
  }
  return ranges;
}

/** Byte offset to send next after a 308 Range header. Null means nothing received yet. */
export function nextByteFromRange(header: string | null): number | null {
  if (!header) return null;
  const match = /bytes=(\d+)-(\d+)/i.exec(header);
  if (!match) return null;
  return Number(match[2]) + 1;
}

export type OAuthHash =
  | { kind: 'token'; accessToken: string; expiresIn: number; state: string | null; scope: string }
  | { kind: 'error'; error: string; state: string | null };

export function parseOAuthHash(hash: string): OAuthHash | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.includes('=')) return null;
  const params = new URLSearchParams(raw);
  const state = params.get('state');
  const accessToken = params.get('access_token');
  if (accessToken) {
    const expiresIn = Number(params.get('expires_in') ?? '3600');
    return {
      kind: 'token',
      accessToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
      state,
      scope: params.get('scope') ?? '',
    };
  }
  const error = params.get('error');
  if (error) return { kind: 'error', error, state };
  return null;
}

export function driveFolderQuery(): string {
  return `name='${'Swingframe'}' and mimeType='application/vnd.google-apps.folder' and appProperties has { key='swingframe' and value='root' } and trashed=false`;
}

export function driveMetaQuery(): string {
  return "appProperties has { key='swingframeRole' and value='meta' } and trashed=false";
}

export function driveFileNameSafe(id: string, fileName: string): string {
  const clean = fileName.replace(/[^\w.\- ]+/g, '').trim().slice(0, 80);
  return clean ? `${id}-${clean}` : `${id}.mp4`;
}

export function toBackup(meta: SwingMeta, drive: DriveLink): SwingBackupFile {
  return {
    version: 1,
    id: meta.id,
    view: meta.view,
    date: meta.date,
    club: meta.club,
    notes: meta.notes,
    createdAt: meta.createdAt,
    duration: meta.duration,
    videoWidth: meta.videoWidth,
    videoHeight: meta.videoHeight,
    fps: meta.fps,
    trimIn: meta.trimIn ?? null,
    trimOut: meta.trimOut ?? null,
    mirrored: Boolean(meta.mirrored),
    mimeType: meta.mimeType,
    fileName: meta.fileName,
    byteSize: meta.byteSize,
    drawings: meta.drawings,
    drive,
    shot: meta.shot ?? null,
    tracer: meta.tracer ?? null,
  };
}

const SHOT_FIELDS: ShotField[] = [
  'ballSpeed',
  'vla',
  'hla',
  'spin',
  'spinAxis',
  'sideSpin',
  'clubPath',
  'faceToTarget',
  'faceToPath',
  'carry',
  'apex',
  'curve',
];

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeShot(value: unknown): ShotData | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const shot: ShotData = {
    ballSpeed: null,
    vla: null,
    hla: null,
    spin: null,
    spinAxis: null,
    sideSpin: null,
    clubPath: null,
    faceToTarget: null,
    faceToPath: null,
    carry: null,
    apex: null,
    curve: null,
    sources: {},
  };
  let any = false;
  for (const field of SHOT_FIELDS) {
    const number = finiteNumber(rec[field]);
    if (number == null) continue;
    shot[field] = number;
    any = true;
  }
  if (rec.sources && typeof rec.sources === 'object') {
    const sources = rec.sources as Record<string, unknown>;
    for (const field of SHOT_FIELDS) {
      const source = sources[field];
      if (source === 'screen' || source === 'typed' || source === 'model') shot.sources[field] = source as ShotSource;
    }
  }
  return any ? shot : null;
}

function sanitizePoint(value: unknown): Pt | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as { x?: unknown; y?: unknown };
  if (typeof rec.x !== 'number' || typeof rec.y !== 'number') return null;
  if (!Number.isFinite(rec.x) || !Number.isFinite(rec.y)) return null;
  return { x: Math.min(1, Math.max(0, rec.x)), y: Math.min(1, Math.max(0, rec.y)) };
}

function sanitizeTracer(value: unknown): TracerCalibration | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const cameraHeight = finiteNumber(rec.cameraHeight);
  const cameraDistance = finiteNumber(rec.cameraDistance);
  const fov = finiteNumber(rec.fov);
  if (cameraHeight == null || cameraDistance == null || fov == null) return null;
  return {
    ball: sanitizePoint(rec.ball),
    target: sanitizePoint(rec.target),
    aimSuggested: rec.aimSuggested === true,
    ground: sanitizePoint(rec.ground),
    impactTime: finiteNumber(rec.impactTime),
    cameraHeight,
    cameraDistance,
    fov,
    locked: rec.locked === true,
    showAim: rec.showAim === true,
    showTracer: rec.showTracer !== false,
    color: typeof rec.color === 'string' && /^#[0-9a-f]{6}$/i.test(rec.color) ? rec.color.toLowerCase() : undefined,
    mode: rec.mode === 'manual' ? 'manual' : rec.mode === 'data' ? 'data' : undefined,
    shape: rec.shape === 'draw' || rec.shape === 'straight' || rec.shape === 'fade' ? rec.shape : null,
    manualStart: sanitizePoint(rec.manualStart),
    manualApex: sanitizePoint(rec.manualApex),
    manualFinish: sanitizePoint(rec.manualFinish),
    setupDone: rec.setupDone === true,
  };
}

export function parseBackup(text: string): SwingBackupFile | null {
  try {
    const value = JSON.parse(text) as Partial<SwingBackupFile>;
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id) return null;
    if (value.view !== 'dtl' && value.view !== 'face') return null;
    const drive = value.drive;
    if (!drive || typeof drive.videoId !== 'string' || !drive.videoId) return null;
    return {
      version: 1,
      id: value.id,
      view: value.view,
      date: typeof value.date === 'string' ? value.date : '',
      club: typeof value.club === 'string' ? value.club : '',
      notes: typeof value.notes === 'string' ? value.notes : '',
      createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
      duration: typeof value.duration === 'number' ? value.duration : 0,
      videoWidth: typeof value.videoWidth === 'number' ? value.videoWidth : 0,
      videoHeight: typeof value.videoHeight === 'number' ? value.videoHeight : 0,
      fps: typeof value.fps === 'number' ? value.fps : 60,
      trimIn: typeof value.trimIn === 'number' ? value.trimIn : null,
      trimOut: typeof value.trimOut === 'number' ? value.trimOut : null,
      mirrored: Boolean(value.mirrored),
      mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'video/mp4',
      fileName: typeof value.fileName === 'string' ? value.fileName : 'swing.mp4',
      byteSize: typeof value.byteSize === 'number' ? value.byteSize : 0,
      drawings: Array.isArray(value.drawings) ? value.drawings : [],
      shot: sanitizeShot(value.shot),
      tracer: sanitizeTracer(value.tracer),
      drive: {
        folderId: typeof drive.folderId === 'string' ? drive.folderId : '',
        videoId: drive.videoId,
        thumbId: typeof drive.thumbId === 'string' && drive.thumbId ? drive.thumbId : null,
        metaId: typeof drive.metaId === 'string' ? drive.metaId : '',
        backedUpAt: typeof drive.backedUpAt === 'number' ? drive.backedUpAt : 0,
      },
    };
  } catch {
    return null;
  }
}

export function backupToSwing(file: SwingBackupFile, thumbnail: Blob | null): SwingMeta {
  return {
    id: file.id,
    view: file.view,
    date: file.date,
    club: file.club,
    notes: file.notes,
    createdAt: file.createdAt,
    duration: file.duration,
    videoWidth: file.videoWidth,
    videoHeight: file.videoHeight,
    fps: file.fps,
    trimIn: file.trimIn,
    trimOut: file.trimOut,
    mirrored: file.mirrored,
    mimeType: file.mimeType,
    fileName: file.fileName,
    byteSize: file.byteSize,
    thumbnail,
    drawings: file.drawings,
    drive: file.drive,
    videoKept: true,
    shot: file.shot,
    tracer: file.tracer,
  };
}
