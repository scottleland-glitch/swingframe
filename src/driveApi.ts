import { getVideo, keepLocalVideo, listSwings, releaseLocalVideo, saveSwing, updateSwing } from './db';
import { DRIVE_FOLDER_NAME, UPLOAD_CHUNK_BYTES } from './driveConfig';
import {
  backupToSwing,
  driveFileNameSafe,
  driveFolderQuery,
  driveMetaQuery,
  nextByteFromRange,
  parseBackup,
  toBackup,
  type SwingBackupFile,
} from './driveFormat';
import { DriveAuthError, assertOnline, clearGoogleToken, getAccessToken } from './googleAuth';
import type { DriveLink, SwingMeta } from './types';

export { DriveAuthError };

type DriveFile = { id: string; appProperties?: Record<string, string> };

async function authorized(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  assertOnline();
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error('Google Drive did not answer. Check the connection and try again.');
  }
  if (response.status === 401) throw new DriveAuthError();
  return response;
}

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await getAccessToken());
  } catch (err) {
    if (!(err instanceof DriveAuthError)) throw err;
    clearGoogleToken();
    return await fn(await getAccessToken());
  }
}

async function driveError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) return new Error(body.error.message);
  } catch {
    /* Use the fallback. */
  }
  if (response.status === 404) return new DriveMissingError();
  return new Error(fallback);
}

export class DriveMissingError extends Error {
  constructor() {
    super('That file is no longer on Google Drive.');
    this.name = 'DriveMissingError';
  }
}

async function listFiles(token: string, query: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', query);
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('fields', 'nextPageToken,files(id,appProperties)');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await authorized(token, url.href);
    if (!response.ok) throw await driveError(response, 'Could not read the Swingframe folder.');
    const body = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

async function ensureFolder(token: string): Promise<string> {
  const existing = await listFiles(token, driveFolderQuery());
  if (existing[0]?.id) return existing[0].id;
  const response = await authorized(token, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { swingframe: 'root' },
    }),
  });
  if (!response.ok) throw await driveError(response, 'Could not create the Swingframe folder.');
  const created = (await response.json()) as { id?: string };
  if (!created.id) throw new Error('Google Drive did not create the Swingframe folder.');
  return created.id;
}

async function querySession(session: string, total: number): Promise<{ done: true; id: string } | { done: false; offset: number }> {
  const response = await fetch(session, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${total}` },
  });
  if (response.ok) {
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error('Google Drive did not keep that file.');
    return { done: true, id: body.id };
  }
  if (response.status === 308) {
    return { done: false, offset: nextByteFromRange(response.headers.get('Range')) ?? 0 };
  }
  throw await driveError(response, 'The upload stopped.');
}

async function uploadSession(
  session: string,
  body: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  const total = body.size;
  let offset = 0;
  let failures = 0;
  while (offset < total) {
    const end = Math.min(total, offset + UPLOAD_CHUNK_BYTES);
    try {
      const response = await fetch(session, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}` },
        body: body.slice(offset, end),
      });
      failures = 0;
      if (response.status === 308) {
        offset = nextByteFromRange(response.headers.get('Range')) ?? end;
        onProgress?.(Math.min(offset, total), total);
        continue;
      }
      if (response.ok) {
        const created = (await response.json()) as { id?: string };
        if (!created.id) throw new Error('Google Drive did not keep that file.');
        onProgress?.(total, total);
        return created.id;
      }
      throw await driveError(response, 'The upload failed.');
    } catch (err) {
      if (err instanceof DriveMissingError || err instanceof DriveAuthError) throw err;
      failures += 1;
      if (failures > 3) {
        throw err instanceof Error ? err : new Error('The upload stopped. Check the connection and try again.');
      }
      const status = await querySession(session, total);
      if (status.done) return status.id;
      offset = status.offset;
    }
  }
  throw new Error('The upload did not finish.');
}

async function resumableUpload(options: {
  token: string;
  fileId?: string;
  metadata: Record<string, unknown>;
  body: Blob;
  mimeType: string;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<string> {
  const url = options.fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(options.fileId)}?uploadType=resumable`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
  const response = await authorized(options.token, url, {
    method: options.fileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': options.mimeType,
      'X-Upload-Content-Length': String(options.body.size),
    },
    body: JSON.stringify(options.metadata),
  });
  if (response.status === 404) throw new DriveMissingError();
  if (!response.ok) throw await driveError(response, 'Could not start the upload.');
  const session = response.headers.get('Location');
  if (!session) throw new Error('Google Drive did not start the upload.');
  return uploadSession(session, options.body, options.onProgress);
}

async function putFile(options: {
  token: string;
  folderId: string;
  fileId?: string | null;
  name: string;
  mimeType: string;
  swingId: string;
  role: 'video' | 'thumb' | 'meta';
  body: Blob;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<string> {
  const appProperties = { swingframeId: options.swingId, swingframeRole: options.role };
  const createMeta = {
    name: options.name,
    mimeType: options.mimeType,
    parents: [options.folderId],
    appProperties,
  };
  const updateMeta = { name: options.name, mimeType: options.mimeType, appProperties };
  const attempt = (fileId?: string) =>
    resumableUpload({
      token: options.token,
      fileId,
      metadata: fileId ? updateMeta : createMeta,
      body: options.body,
      mimeType: options.mimeType,
      onProgress: options.onProgress,
    });
  if (!options.fileId) return attempt();
  try {
    return await attempt(options.fileId);
  } catch (err) {
    if (err instanceof DriveMissingError) return attempt();
    throw err;
  }
}

async function downloadFile(token: string, fileId: string): Promise<Blob> {
  const response = await authorized(
    token,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (response.status === 404) throw new DriveMissingError();
  if (!response.ok) throw await driveError(response, 'Could not download that file from Google Drive.');
  return response.blob();
}

export async function backupSwing(
  meta: SwingMeta,
  video: Blob | null,
  onProgress?: (label: string) => void,
): Promise<DriveLink> {
  return withToken(async (token) => {
    const folderId = await ensureFolder(token);
    let videoId = meta.drive?.videoId ?? '';
    let thumbId = meta.drive?.thumbId ?? null;
    let metaId = meta.drive?.metaId || '';
    if (video && video.size > 0) {
      onProgress?.('Uploading video…');
      videoId = await putFile({
        token,
        folderId,
        fileId: videoId || null,
        name: driveFileNameSafe(meta.id, meta.fileName || 'swing.mp4'),
        mimeType: video.type || meta.mimeType || 'video/mp4',
        swingId: meta.id,
        role: 'video',
        body: video,
        onProgress: (loaded, total) => {
          const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
          onProgress?.(`Uploading video… ${pct}%`);
        },
      });
    } else if (!videoId) {
      throw new Error('The video is not on this phone, so it cannot be backed up.');
    }
    if (meta.thumbnail && meta.thumbnail.size > 0) {
      onProgress?.('Uploading thumbnail…');
      thumbId = await putFile({
        token,
        folderId,
        fileId: thumbId,
        name: `${meta.id}.jpg`,
        mimeType: 'image/jpeg',
        swingId: meta.id,
        role: 'thumb',
        body: meta.thumbnail,
      });
    }
    const drive: DriveLink = {
      folderId,
      videoId,
      thumbId,
      metaId: metaId || 'pending',
      backedUpAt: Date.now(),
    };
    onProgress?.('Saving details…');
    const first = new Blob([JSON.stringify(toBackup(meta, drive))], { type: 'application/json' });
    metaId = await putFile({
      token,
      folderId,
      fileId: metaId && metaId !== 'pending' ? metaId : null,
      name: `${meta.id}.json`,
      mimeType: 'application/json',
      swingId: meta.id,
      role: 'meta',
      body: first,
    });
    drive.metaId = metaId;
    const finalBody = new Blob([JSON.stringify(toBackup(meta, drive))], { type: 'application/json' });
    await putFile({
      token,
      folderId,
      fileId: metaId,
      name: `${meta.id}.json`,
      mimeType: 'application/json',
      swingId: meta.id,
      role: 'meta',
      body: finalBody,
    });
    await updateSwing(meta.id, { drive, byteSize: video && video.size > 0 ? video.size : meta.byteSize });
    onProgress?.('Backed up to Google Drive.');
    return drive;
  });
}

export async function backupAll(
  swings: SwingMeta[],
  onProgress: (label: string) => void,
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  for (let index = 0; index < swings.length; index += 1) {
    const swing = swings[index];
    const label = swing.club || 'Swing';
    onProgress(`Backing up ${index + 1} of ${swings.length}: ${label}`);
    try {
      const video = await getVideo(swing.id);
      await backupSwing(swing, video, (detail) => onProgress(`${label}: ${detail}`));
      ok += 1;
    } catch (err) {
      failed.push(`${label}: ${err instanceof Error ? err.message : 'Could not back up.'}`);
    }
  }
  return { ok, failed };
}

export async function downloadSwingVideo(meta: SwingMeta, onProgress?: (label: string) => void): Promise<void> {
  if (!meta.drive?.videoId) throw new Error('This swing is not on Google Drive.');
  await withToken(async (token) => {
    onProgress?.('Downloading video…');
    const video = await downloadFile(token, meta.drive!.videoId);
    if (video.size === 0) throw new Error('Google Drive returned an empty video.');
    onProgress?.('Saving on this phone…');
    await keepLocalVideo(meta.id, video);
    onProgress?.('Downloaded from Google Drive.');
  });
}

export async function listRemoteSwings(): Promise<SwingBackupFile[]> {
  return withToken(async (token) => {
    const local = new Set((await listSwings()).map((swing) => swing.id));
    const files = await listFiles(token, driveMetaQuery());
    const found: SwingBackupFile[] = [];
    for (const file of files) {
      try {
        const text = await (await downloadFile(token, file.id)).text();
        const parsed = parseBackup(text);
        if (parsed && !local.has(parsed.id)) found.push(parsed);
      } catch {
        /* Skip a file this phone cannot read. */
      }
    }
    return found.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  });
}

export async function importRemoteSwing(file: SwingBackupFile, onProgress?: (label: string) => void): Promise<void> {
  await withToken(async (token) => {
    onProgress?.('Downloading video…');
    const video = await downloadFile(token, file.drive.videoId);
    if (video.size === 0) throw new Error('Google Drive returned an empty video.');
    let thumbnail: Blob | null = null;
    if (file.drive.thumbId) {
      try {
        thumbnail = await downloadFile(token, file.drive.thumbId);
      } catch {
        thumbnail = null;
      }
    }
    onProgress?.('Saving on this phone…');
    await saveSwing(backupToSwing(file, thumbnail), video);
    onProgress?.('Restored from Google Drive.');
  });
}

export async function freeBackedUpVideos(swings: SwingMeta[]): Promise<number> {
  let freed = 0;
  for (const swing of swings) {
    if (!swing.drive?.videoId || swing.videoKept === false) continue;
    await releaseLocalVideo(swing.id);
    freed += 1;
  }
  return freed;
}
