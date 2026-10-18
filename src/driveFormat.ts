import type { Drawing, DriveLink, SwingMeta, ViewAngle } from './types';
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
  };
}
