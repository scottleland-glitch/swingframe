const VIDEO_EXT = /\.(mov|mp4|m4v|webm|avi|mkv|qt)$/i;

/** iPhone camera-roll clips are often video/quicktime, or the type is blank. */
export function looksLikeVideo(file: { type: string; name: string }): boolean {
  const type = file.type.toLowerCase();
  if (type.startsWith('video/') || type === 'application/mp4') return true;
  if (VIDEO_EXT.test(file.name)) return true;
  return type === '';
}

/**
 * Blob type Safari will actually play. Rebuilt video/quicktime blobs (HEVC .mov)
 * often fail to open; the same bytes play as video/mp4.
 */
export function playbackMime(type: string, fileName = ''): string {
  const name = fileName.toLowerCase();
  const mime = type.toLowerCase().split(';')[0].trim();
  if (mime === 'video/webm' || name.endsWith('.webm')) return 'video/webm';
  if (mime === 'video/ogg' || name.endsWith('.ogv')) return 'video/ogg';
  return 'video/mp4';
}

export function mimeAttempts(type: string, fileName = ''): string[] {
  const primary = playbackMime(type, fileName);
  if (primary !== 'video/mp4') return [primary];
  return ['video/mp4', 'video/quicktime'];
}

export function blobWithMime(blob: Blob, type: string): Blob {
  if ((blob.type || '').toLowerCase() === type.toLowerCase()) return blob;
  try {
    return blob.slice(0, blob.size, type);
  } catch {
    return blob;
  }
}
