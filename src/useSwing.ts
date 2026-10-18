import { useCallback, useEffect, useRef, useState } from 'react';
import { getSwing, getVideo, updateSwing } from './db';
import type { Drawing, SwingMeta } from './types';

export type SwingLoad =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

export function useSwing(id: string) {
  const [swing, setSwing] = useState<SwingMeta | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [past, setPast] = useState<Drawing[][]>([]);
  const [load, setLoad] = useState<SwingLoad>({ status: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const pastRef = useRef<Drawing[][]>([]);
  const dirty = useRef(false);
  const ready = load.status === 'ready';

  useEffect(() => {
    let cancel = false;
    dirty.current = false;
    setLoad({ status: 'loading' });
    setSaveError(null);
    void (async () => {
      try {
        const [meta, video] = await Promise.all([getSwing(id), getVideo(id)]);
        if (cancel) return;
        if (!meta || !video) {
          setSwing(null);
          setBlob(null);
          setLoad({ status: 'missing' });
          return;
        }
        const next = Array.isArray(meta.drawings) ? meta.drawings : [];
        drawingsRef.current = next;
        pastRef.current = [];
        setDrawings(next);
        setPast([]);
        setSwing({ ...meta, drawings: next });
        setBlob(video);
        setLoad({ status: 'ready' });
      } catch (err) {
        if (cancel) return;
        setLoad({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not open that swing.',
        });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    const persist = () => {
      if (!dirty.current) return Promise.resolve();
      const snapshot = drawingsRef.current;
      return updateSwing(id, { drawings: snapshot })
        .then(() => {
          if (drawingsRef.current === snapshot) dirty.current = false;
          if (!cancel) {
            setLastSaved(Date.now());
            setSaveError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancel) setSaveError(err instanceof Error ? err.message : 'Could not save drawings.');
        });
    };
    const handle = window.setTimeout(() => {
      void persist();
    }, 280);
    const onHide = () => {
      void persist();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
      window.removeEventListener('pagehide', onHide);
      void persist();
    };
  }, [drawings, ready, id]);

  const commit = useCallback((next: Drawing[]) => {
    dirty.current = true;
    pastRef.current = [...pastRef.current.slice(-50), drawingsRef.current];
    setPast(pastRef.current);
    drawingsRef.current = next;
    setDrawings(next);
    setSwing((s) => (s ? { ...s, drawings: next } : s));
  }, []);

  const undo = useCallback(() => {
    const stack = pastRef.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    pastRef.current = stack.slice(0, -1);
    setPast(pastRef.current);
    drawingsRef.current = prev;
    dirty.current = true;
    setDrawings(prev);
    setSwing((s) => (s ? { ...s, drawings: prev } : s));
  }, []);

  const patch = useCallback(
    async (partial: Partial<Omit<SwingMeta, 'id' | 'drawings' | 'thumbnail'>>) => {
      setSwing((s) => (s ? { ...s, ...partial } : s));
      await updateSwing(id, partial);
    },
    [id],
  );

  return {
    swing,
    blob,
    drawings,
    pastCount: past.length,
    load,
    saveError,
    lastSaved,
    commit,
    undo,
    patch,
  };
}
