import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE, UPLOAD_CHUNK_BYTES, googleRedirectUri, isDriveConfigured, prefersRedirectSignIn } from './driveConfig';
import {
  driveFileNameSafe,
  nextByteFromRange,
  parseBackup,
  parseOAuthHash,
  toBackup,
  uploadRanges,
} from './driveFormat';
import type { SwingMeta } from './types';

function sample(): SwingMeta {
  return {
    id: 'swing-1',
    view: 'dtl',
    date: '2026-04-01',
    club: 'PW',
    notes: 'hold the face',
    createdAt: 10,
    duration: 2.5,
    videoWidth: 720,
    videoHeight: 1280,
    fps: 120,
    trimIn: null,
    trimOut: 2,
    mirrored: false,
    mimeType: 'video/mp4',
    fileName: 'IMG_3803.mov',
    byteSize: 18,
    thumbnail: null,
    drawings: [{ id: 'd1', type: 'hline', color: '#fff', y: 0.5 }],
  };
}

describe('drive config', () => {
  it('hides the feature when the client id is missing', () => {
    expect(isDriveConfigured(undefined)).toBe(false);
    expect(isDriveConfigured('  ')).toBe(false);
    expect(isDriveConfigured('abc.apps.googleusercontent.com')).toBe(true);
    expect(DRIVE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });

  it('uses a full-page sign-in only for an iOS home-screen app', () => {
    expect(prefersRedirectSignIn(true, true)).toBe(true);
    expect(prefersRedirectSignIn(true, false)).toBe(false);
    expect(prefersRedirectSignIn(false, true)).toBe(false);
  });

  it('builds the GitHub Pages redirect URI with the trailing slash', () => {
    expect(googleRedirectUri('https://scottleland-glitch.github.io', '/swingframe/')).toBe(
      'https://scottleland-glitch.github.io/swingframe/',
    );
  });
});

describe('resumable upload ranges', () => {
  it('splits on 256 KiB boundaries and covers the file', () => {
    expect(UPLOAD_CHUNK_BYTES % (256 * 1024)).toBe(0);
    const total = UPLOAD_CHUNK_BYTES + 1000;
    const ranges = uploadRanges(total);
    expect(ranges).toEqual([
      { start: 0, end: UPLOAD_CHUNK_BYTES - 1 },
      { start: UPLOAD_CHUNK_BYTES, end: total - 1 },
    ]);
    expect(uploadRanges(0)).toEqual([]);
  });

  it('reads the next byte from a Drive 308 Range header', () => {
    expect(nextByteFromRange('bytes=0-524287')).toBe(524288);
    expect(nextByteFromRange(null)).toBeNull();
  });
});

describe('oauth hash', () => {
  it('reads a token or an error and ignores unrelated hashes', () => {
    const token = parseOAuthHash('#access_token=ya29.abc&expires_in=3600&token_type=Bearer&scope=https://www.googleapis.com/auth/drive.file&state=sf1.one');
    expect(token).toMatchObject({ kind: 'token', accessToken: 'ya29.abc', expiresIn: 3600, state: 'sf1.one' });
    expect(parseOAuthHash('#error=access_denied&state=sf1.one')).toEqual({
      kind: 'error',
      error: 'access_denied',
      state: 'sf1.one',
    });
    expect(parseOAuthHash('#not-oauth')).toBeNull();
  });
});

describe('backup json', () => {
  it('round-trips metadata and drawings without the thumbnail bytes', () => {
    const drive = { folderId: 'folder', videoId: 'video', thumbId: 'thumb', metaId: 'meta', backedUpAt: 5 };
    const json = JSON.stringify(toBackup(sample(), drive));
    expect(json).not.toContain('thumbnail');
    const parsed = parseBackup(json);
    expect(parsed?.club).toBe('PW');
    expect(parsed?.drawings).toHaveLength(1);
    expect(parsed?.drive.videoId).toBe('video');
    expect(parseBackup('{"version":1}')).toBeNull();
    expect(driveFileNameSafe('swing-1', 'IMG 3803.mov')).toBe('swing-1-IMG 3803.mov');
  });
});
