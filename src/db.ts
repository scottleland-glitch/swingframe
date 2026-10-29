import { requestPersistentStorage } from './platform';
import type { SwingMeta } from './types';
import { playbackMime } from './videoFile';

const DB_NAME = 'swingframe';
const DB_VERSION = 2;

/**
 * iOS drops Blob and File values stored in IndexedDB after the Home Screen
 * app is closed. Bytes plus a MIME type survive, and the Blob is rebuilt on read.
 */
type StoredBytes = { bytes: ArrayBuffer; type: string };
type StoredSwing = Omit<SwingMeta, 'thumbnail'> & { thumbnail: StoredBytes | Blob | null };

let dbPromise: Promise<IDBDatabase> | null = null;
let chain: Promise<unknown> = Promise.resolve();

const OP_TIMEOUT_MS = 30000;
const OPEN_TIMEOUT_MS = 4000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const diag: string[] = [];
const diagStart = Date.now();

export function dbLog(line: string): void {
  diag.push(`${((Date.now() - diagStart) / 1000).toFixed(1)}s ${line}`);
  if (diag.length > 40) diag.shift();
}

export function dbDiagnostics(): string[] {
  return diag.slice();
}

function enqueue<T>(fn: () => Promise<T>, label = 'op'): Promise<T> {
  dbLog(`queued ${label}`);
  const guarded = () => {
    dbLog(`start ${label}`);
    return withTimeout(fn().then((value) => {
      dbLog(`done ${label}`);
      return value;
    }), OP_TIMEOUT_MS, 'Storage did not respond. Close Swingframe fully and open it again.', () => {
      dbLog(`TIMEOUT ${label}`);
      dbPromise = null;
    });
  };
  const run = chain.then(guarded, guarded);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function openGuarded(): Promise<IDBDatabase> {
  return withTimeout(openRaw(), OPEN_TIMEOUT_MS, 'Storage is slow to open.', () => {
    dbPromise = null;
  });
}

async function openDB(): Promise<IDBDatabase> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const db = await openGuarded();
      // iOS closes the connection when the app is backgrounded. Probe it and reopen if it is closed.
      db.transaction('swings', 'readonly');
      return db;
    } catch (err) {
      lastErr = err;
      dbPromise = null;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not open on-device storage.');
}

function openRaw(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser cannot store videos on the device.'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('swings')) {
          db.createObjectStore('swings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('videos')) {
          db.createObjectStore('videos');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error('Could not open on-device storage.'));
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('Storage is busy in another tab. Close other Swingframe tabs and try again.'));
      };
    });
  }
  return dbPromise;
}

export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export function quotaMessage(): string {
  return 'This phone does not have enough free space for that video.';
}

function storedBytes(value: unknown): { bytes: ArrayBuffer | ArrayBufferView; type: string } | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as { bytes?: unknown; type?: unknown };
  if (!(rec.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(rec.bytes)) return null;
  return { bytes: rec.bytes, type: typeof rec.type === 'string' ? rec.type : '' };
}

function isStoredBytes(value: unknown): value is StoredBytes {
  return storedBytes(value) != null;
}

function plainBuffer(bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength));
  return copy;
}

function asBlob(value: unknown, fallbackType: string): Blob | null {
  try {
    if (value instanceof Blob) return value.size > 0 ? value : null;
    const stored = storedBytes(value);
    if (stored && stored.bytes.byteLength > 0) {
      const mime = fallbackType.startsWith('image/')
        ? stored.type || fallbackType
        : playbackMime(stored.type || fallbackType);
      return new Blob([plainBuffer(stored.bytes)], { type: mime });
    }
  } catch {
    return null;
  }
  return null;
}

async function toStoredBytes(blob: Blob, fallbackType: string): Promise<StoredBytes> {
  const bytes = await blob.arrayBuffer();
  return { bytes, type: blob.type || fallbackType };
}

function rehydrate(row: unknown): SwingMeta | null {
  try {
    if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') return null;
    const rec = row as StoredSwing;
    return {
      ...rec,
      drawings: Array.isArray(rec.drawings) ? rec.drawings : [],
      thumbnail: asBlob(rec.thumbnail, 'image/jpeg'),
    };
  } catch {
    return null;
  }
}

function readStore<T>(store: IDBObjectStore, key?: IDBValidKey): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = key === undefined ? store.getAll() : store.get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('Could not read saved swings.'));
  });
}

function txDone(tx: IDBTransaction, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(failure));
    tx.onabort = () => reject(tx.error ?? new Error(failure));
  });
}

function readAllKeyed(store: IDBObjectStore): Promise<{ key: IDBValidKey; value: unknown }[]> {
  return new Promise((resolve, reject) => {
    const rows: { key: IDBValidKey; value: unknown }[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      rows.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('Could not read saved swings.'));
  });
}

/**
 * Older builds stored Blob values. iOS drops those records when the Home
 * Screen app closes, so rewrite any that are still readable into bytes.
 */
let bytesReady: Promise<void> | null = null;

const BYTES_FLAG = 'swingframe-bytes-v1';

function bytesFlagSet(): boolean {
  try {
    return window.localStorage.getItem(BYTES_FLAG) === '1';
  } catch {
    return false;
  }
}

function ensureStoredBytes(): Promise<void> {
  // The upgrade used to read every saved video into memory on each launch. Once it has finished, never run it again.
  if (bytesFlagSet()) return Promise.resolve();
  if (!bytesReady) {
    dbLog('upgrade check running');
    bytesReady = withTimeout(rewriteBlobValues(), 8000, 'Storage upgrade timed out.')
      .then(() => {
        try {
          window.localStorage.setItem(BYTES_FLAG, '1');
        } catch {
          /* The check just runs again next launch. */
        }
      })
      .catch((err: unknown) => {
        // Do not retry this session. Every storage call would otherwise wait on it again.
        dbLog(`upgrade check failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
  return bytesReady;
}

async function rewriteBlobValues(): Promise<void> {
  const db = await openDB();
  const readTx = db.transaction(['swings', 'videos'], 'readonly');
  const swings = await readAllKeyed(readTx.objectStore('swings'));
  await txDone(readTx, 'Could not read swings.');

  const swingPuts: StoredSwing[] = [];
  for (const row of swings) {
    if (!row.value || typeof row.value !== 'object') continue;
    const rec = row.value as StoredSwing;
    if (!(rec.thumbnail instanceof Blob)) continue;
    let thumbnail: StoredBytes | null = null;
    if (rec.thumbnail.size > 0) {
      try {
        const stored = await toStoredBytes(rec.thumbnail, 'image/jpeg');
        thumbnail = stored.bytes.byteLength > 0 ? stored : null;
      } catch {
        thumbnail = null;
      }
    }
    swingPuts.push({ ...rec, thumbnail });
  }

  // Saved videos are never read here. A Blob video is still played as is, and reading every video on launch stalls the phone.
  const videoPuts: { key: IDBValidKey; value: StoredBytes }[] = [];

  if (swingPuts.length === 0 && videoPuts.length === 0) return;
  const writeTx = db.transaction(['swings', 'videos'], 'readwrite');
  const swingStore = writeTx.objectStore('swings');
  const videoStore = writeTx.objectStore('videos');
  for (const rec of swingPuts) swingStore.put(rec);
  for (const item of videoPuts) videoStore.put(item.value, item.key);
  await txDone(writeTx, 'Could not keep saved swings on this phone.');
}

async function thumbnailBytes(
  current: StoredSwing['thumbnail'],
  incoming: Blob | null | undefined,
): Promise<StoredBytes | null> {
  if (incoming instanceof Blob && incoming.size > 0) {
    try {
      const stored = await toStoredBytes(incoming, 'image/jpeg');
      if (stored.bytes.byteLength > 0) return stored;
    } catch {
      /* Keep the previous poster. */
    }
  }
  if (isStoredBytes(current)) return current;
  if (current instanceof Blob && current.size > 0) {
    try {
      const stored = await toStoredBytes(current, 'image/jpeg');
      return stored.bytes.byteLength > 0 ? stored : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function listSwings(): Promise<SwingMeta[]> {
  return enqueue(async () => {
    await ensureStoredBytes();
    const db = await openDB();
    const tx = db.transaction('swings', 'readonly');
    const rows = await readStore<unknown[]>(tx.objectStore('swings'));
    await txDone(tx, 'Could not read swings.');
    dbLog(`listSwings: ${rows.length} rows`);
    return rows
      .map(rehydrate)
      .filter((row): row is SwingMeta => row != null)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.createdAt - a.createdAt;
      });
  }, 'listSwings');
}

export function getSwing(id: string): Promise<SwingMeta | null> {
  return enqueue(async () => {
    await ensureStoredBytes();
    dbLog('getSwing: upgrade check done');
    const db = await openDB();
    dbLog('getSwing: database open');
    const tx = db.transaction('swings', 'readonly');
    const row = await readStore<unknown>(tx.objectStore('swings'), id);
    await txDone(tx, 'Could not read that swing.');
    return rehydrate(row);
  }, 'getSwing');
}

export function getVideo(id: string): Promise<Blob | null> {
  return enqueue(async () => {
    await ensureStoredBytes();
    const db = await openDB();
    const tx = db.transaction('videos', 'readonly');
    const row = await readStore<unknown>(tx.objectStore('videos'), id);
    const size = (row as { bytes?: { byteLength?: number } } | null)?.bytes?.byteLength;
    dbLog(`getVideo: row read, ${row instanceof Blob ? `blob ${row.size}` : size != null ? `${(size / 1048576).toFixed(1)} MB bytes` : 'no data'}`);
    await txDone(tx, 'Could not read that video.');
    const blob = asBlob(row, 'video/mp4');
    dbLog(`getVideo: blob ${blob ? (blob.size / 1048576).toFixed(1) + ' MB' : 'none'}`);
    return blob;
  }, 'getVideo');
}

export function saveSwing(meta: SwingMeta, video: Blob): Promise<void> {
  return enqueue(async () => {
    await requestPersistentStorage();
    await ensureStoredBytes();
    const videoRecord = await toStoredBytes(video, playbackMime(meta.mimeType || video.type, meta.fileName));
    videoRecord.type = playbackMime(video.type || videoRecord.type, meta.fileName);
    const expected = videoRecord.bytes.byteLength;
    if (expected === 0) {
      throw new Error('That video was empty and was not saved.');
    }
    let thumbnail: StoredBytes | null = null;
    if (meta.thumbnail) {
      try {
        const stored = await toStoredBytes(meta.thumbnail, 'image/jpeg');
        thumbnail = stored.bytes.byteLength > 0 ? stored : null;
      } catch {
        thumbnail = null;
      }
    }
    const record: StoredSwing = { ...meta, thumbnail, videoKept: true };
    const db = await openDB();
    const tx = db.transaction(['swings', 'videos'], 'readwrite');
    tx.objectStore('swings').put(record);
    tx.objectStore('videos').put(videoRecord, meta.id);
    await txDone(tx, 'Could not save the swing.');

    const checkTx = db.transaction('videos', 'readonly');
    const saved = await readStore<unknown>(checkTx.objectStore('videos'), meta.id);
    await txDone(checkTx, 'Could not confirm the swing was saved.');
    const kept = storedBytes(saved);
    if (!kept || kept.bytes.byteLength !== expected) {
      try {
        const undo = db.transaction(['swings', 'videos'], 'readwrite');
        undo.objectStore('swings').delete(meta.id);
        undo.objectStore('videos').delete(meta.id);
        await txDone(undo, 'Could not save the swing.');
      } catch {
        /* The message below is the one to show. */
      }
      throw new Error('The swing did not stay saved on this phone. Try again.');
    }
  });
}

export function updateSwing(id: string, partial: Partial<SwingMeta>): Promise<void> {
  return enqueue(async () => {
    await ensureStoredBytes();
    const db = await openDB();
    const readTx = db.transaction('swings', 'readonly');
    const current = await readStore<StoredSwing | undefined>(readTx.objectStore('swings'), id);
    await txDone(readTx, 'Could not read that swing.');
    if (!current) throw new Error('That swing is no longer on this phone.');
    const thumbnail = await thumbnailBytes(current.thumbnail, partial.thumbnail);
    const next: StoredSwing = { ...current, ...partial, id: current.id, thumbnail };
    const tx = db.transaction('swings', 'readwrite');
    tx.objectStore('swings').put(next);
    await txDone(tx, 'Could not update the swing.');
  });
}

async function removeSwingRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  const tx = db.transaction(['swings', 'videos'], 'readwrite');
  const swings = tx.objectStore('swings');
  const videos = tx.objectStore('videos');
  for (const id of ids) {
    swings.delete(id);
    videos.delete(id);
  }
  await txDone(tx, 'Could not delete the swing.');
}

/** Drops the swing row (drawings and thumbnail) and the video bytes. */
export function deleteSwing(id: string): Promise<void> {
  return enqueue(() => removeSwingRecords([id]));
}

export function deleteSwings(ids: string[]): Promise<void> {
  return enqueue(() => removeSwingRecords(ids));
}

/** Drop the video bytes for a swing that already lives on Google Drive. */
export function releaseLocalVideo(id: string): Promise<void> {
  return enqueue(async () => {
    const db = await openDB();
    const readTx = db.transaction('swings', 'readonly');
    const current = await readStore<StoredSwing | undefined>(readTx.objectStore('swings'), id);
    await txDone(readTx, 'Could not read that swing.');
    if (!current) throw new Error('That swing is no longer on this phone.');
    const drive = (current as { drive?: { videoId?: string } }).drive;
    if (!drive?.videoId) throw new Error('Back this swing up to Google Drive before removing it from the phone.');
    const tx = db.transaction(['swings', 'videos'], 'readwrite');
    tx.objectStore('swings').put({ ...current, videoKept: false });
    tx.objectStore('videos').delete(id);
    await txDone(tx, 'Could not free that space.');
  });
}

/** Put a downloaded video back next to the card. */
export function keepLocalVideo(id: string, video: Blob): Promise<void> {
  return enqueue(async () => {
    const videoRecord = await toStoredBytes(video, playbackMime(video.type));
    videoRecord.type = playbackMime(video.type || videoRecord.type);
    const expected = videoRecord.bytes.byteLength;
    if (expected === 0) throw new Error('That video was empty and was not saved.');
    const db = await openDB();
    const readTx = db.transaction('swings', 'readonly');
    const current = await readStore<StoredSwing | undefined>(readTx.objectStore('swings'), id);
    await txDone(readTx, 'Could not read that swing.');
    if (!current) throw new Error('That swing is no longer on this phone.');
    const tx = db.transaction(['swings', 'videos'], 'readwrite');
    tx.objectStore('swings').put({
      ...current,
      videoKept: true,
      byteSize: expected,
      mimeType: videoRecord.type || current.mimeType,
    });
    tx.objectStore('videos').put(videoRecord, id);
    await txDone(tx, 'Could not save the video on this phone.');
    const checkTx = db.transaction('videos', 'readonly');
    const saved = await readStore<unknown>(checkTx.objectStore('videos'), id);
    await txDone(checkTx, 'Could not confirm the video was saved.');
    const kept = storedBytes(saved);
    if (!kept || kept.bytes.byteLength !== expected) {
      throw new Error('The video did not stay on this phone. Try the download again.');
    }
  });
}

/** Bytes still held for saved videos and thumbnails. */
export function storedUsage(): Promise<number> {
  return enqueue(async () => {
    const db = await openDB();
    const tx = db.transaction(['swings', 'videos'], 'readonly');
    const videos = await readStore<unknown[]>(tx.objectStore('videos'));
    const swings = await readStore<unknown[]>(tx.objectStore('swings'));
    await txDone(tx, 'Could not read storage.');
    let total = 0;
    for (const row of videos) {
      const stored = storedBytes(row);
      if (stored) total += stored.bytes.byteLength;
    }
    for (const row of swings) {
      if (!row || typeof row !== 'object') continue;
      const thumb = storedBytes((row as { thumbnail?: unknown }).thumbnail);
      if (thumb) total += thumb.bytes.byteLength;
    }
    return total;
  });
}
