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
    expect(parsed?.shot).toBeNull();
    expect(parsed?.tracer).toBeNull();
    expect(parseBackup('{"version":1}')).toBeNull();
    expect(driveFileNameSafe('swing-1', 'IMG 3803.mov')).toBe('swing-1-IMG 3803.mov');
  });

  it('round-trips shot and tracer data and still reads a backup from before the tracer', () => {
    const drive = { folderId: 'folder', videoId: 'video', thumbId: null, metaId: 'meta', backedUpAt: 5 };
    const meta = sample();
    meta.shot = {
      ballSpeed: 167,
      vla: 12,
      hla: 1.2,
      spin: 2600,
      spinAxis: null,
      sideSpin: null,
      clubPath: -1.5,
      faceToTarget: 0.8,
      faceToPath: 2.3,
      carry: 280,
      apex: null,
      curve: null,
      sources: { ballSpeed: 'screen', carry: 'typed' },
    };
    meta.tracer = {
      ball: { x: 0.5, y: 0.7 },
      target: { x: 0.52, y: 0.3 },
      impactTime: 1.25,
      cameraHeight: 1.5,
      cameraDistance: 3,
      fov: 58,
    };
    const parsed = parseBackup(JSON.stringify(toBackup(meta, drive)));
    expect(parsed?.shot?.ballSpeed).toBe(167);
    expect(parsed?.shot?.clubPath).toBe(-1.5);
    expect(parsed?.shot?.faceToTarget).toBe(0.8);
    expect(parsed?.shot?.faceToPath).toBe(2.3);
    expect(parsed?.shot?.sources.carry).toBe('typed');
    expect(parsed?.tracer?.impactTime).toBe(1.25);
    expect(parsed?.tracer?.ball).toEqual({ x: 0.5, y: 0.7 });
    const legacy = JSON.parse(JSON.stringify(toBackup(sample(), drive))) as Record<string, unknown>;
    delete legacy.shot;
    delete legacy.tracer;
    const old = parseBackup(JSON.stringify(legacy));
    expect(old?.club).toBe('PW');
    expect(old?.shot).toBeNull();
    expect(old?.tracer).toBeNull();
  });
});
