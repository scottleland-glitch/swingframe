import type { SwingMeta } from './types';

const DB_NAME = 'swingframe';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function openDB(): Promise<IDBDatabase> {
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
      req.onsuccess = () => resolve(req.result);
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

function settle<T>(resolve: (value: T) => void, reject: (err: Error) => void) {
  let done = false;
  return {
    ok(value: T) {
      if (done) return;
      done = true;
      resolve(value);
    },
    fail(err: unknown) {
      if (done) return;
      done = true;
      reject(err instanceof Error ? err : new Error('Storage error'));
    },
  };
}

export function listSwings(): Promise<SwingMeta[]> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const gate = settle(resolve, reject);
        openDB()
          .then((db) => {
            const tx = db.transaction('swings', 'readonly');
            const req = tx.objectStore('swings').getAll();
            req.onsuccess = () => {
              const rows = (req.result as SwingMeta[]).slice().sort((a, b) => {
                if (a.date !== b.date) return a.date < b.date ? 1 : -1;
                return b.createdAt - a.createdAt;
              });
              gate.ok(rows);
            };
            req.onerror = () => gate.fail(req.error ?? new Error('Could not read swings.'));
            tx.onerror = () => gate.fail(tx.error ?? new Error('Could not read swings.'));
          })
          .catch(gate.fail);
      }),
  );
}

export function getSwing(id: string): Promise<SwingMeta | null> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const gate = settle(resolve, reject);
        openDB()
          .then((db) => {
            const tx = db.transaction('swings', 'readonly');
            const req = tx.objectStore('swings').get(id);
            req.onsuccess = () => gate.ok((req.result as SwingMeta | undefined) ?? null);
            req.onerror = () => gate.fail(req.error ?? new Error('Could not read that swing.'));
          })
          .catch(gate.fail);
      }),
  );
}

export function getVideo(id: string): Promise<Blob | null> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const gate = settle(resolve, reject);
        openDB()
          .then((db) => {
            const tx = db.transaction('videos', 'readonly');
            const req = tx.objectStore('videos').get(id);
            req.onsuccess = () => {
              const result = req.result as Blob | undefined;
              gate.ok(result ?? null);
            };
            req.onerror = () => gate.fail(req.error ?? new Error('Could not read that video.'));
          })
          .catch(gate.fail);
      }),
  );
}

export function saveSwing(meta: SwingMeta, video: Blob): Promise<void> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const gate = settle(resolve, reject);
        openDB()
          .then((db) => {
            const tx = db.transaction(['swings', 'videos'], 'readwrite');
            tx.objectStore('swings').put(meta);
            tx.objectStore('videos').put(video, meta.id);
            tx.oncomplete = () => gate.ok(undefined);
            tx.onerror = () => gate.fail(tx.error ?? new Error('Could not save the swing.'));
            tx.onabort = () => gate.fail(tx.error ?? new Error('Could not save the swing.'));
          })
          .catch(gate.fail);
      }),
  );
}

export function updateSwing(id: string, partial: Partial<SwingMeta>): Promise<void> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const gate = settle(resolve, reject);
        openDB()
          .then((db) => {
            const tx = db.transaction('swings', 'readwrite');
            const store = tx.objectStore('swings');
            const req = store.get(id);
            req.onsuccess = () => {
              const current = req.result as SwingMeta | undefined;
              if (!current) {
                gate.fail(new Error('That swing is no longer on this phone.'));
                return;
              }
              store.put({ ...current, ...partial, id: current.id });
            };
            req.onerror = () => gate.fail(req.error ?? new Error('Could not update the swing.'));
            tx.oncomplete = () => gate.ok(undefined);
            tx.onerror = () => gate.fail(tx.error ?? new Error('Could not update the swing.'));
            tx.onabort = () => gate.fail(tx.error ?? new Error('Could not update the swing.'));
          })
          .catch(gate.fail);
      }),
  );
}

export function deleteSwing(id: string): Promise<void> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const gate = settle(resolve, reject);
        openDB()
          .then((db) => {
            const tx = db.transaction(['swings', 'videos'], 'readwrite');
            tx.objectStore('swings').delete(id);
            tx.objectStore('videos').delete(id);
            tx.oncomplete = () => gate.ok(undefined);
            tx.onerror = () => gate.fail(tx.error ?? new Error('Could not delete the swing.'));
            tx.onabort = () => gate.fail(tx.error ?? new Error('Could not delete the swing.'));
          })
          .catch(gate.fail);
      }),
  );
}
