import { useEffect, useRef, useState } from 'react';
import { CLUBS, DEFAULT_FPS } from '../constants';
import { isQuotaError, quotaMessage, saveSwing } from '../db';
import { errorMessage, formatBytes, todayISO, uid } from '../format';
import type { SwingMeta, ViewAngle } from '../types';
import { exitIfNativeFullscreen, loadInlineSource, markInline, mediaErrorMessage, paintFirstFrame } from '../inlineVideo';
import { looksLikeVideo, probeVideo, type ProbeResult } from '../videoProbe';
import { blobWithMime, playbackMime } from '../videoFile';
import { Dialog } from './Dialog';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(message));
      },
    );
  });
}
import { Icon } from './Icons';
import { ViewPicker } from './ViewPicker';

export function AddSwingSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const alive = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState<ViewAngle>('dtl');
  const [confirmClose, setConfirmClose] = useState(false);
  const [date, setDate] = useState(todayISO);
  const [club, setClub] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const node = previewRef.current;
    if (!node || !previewUrl) return;
    let cancelled = false;
    setPreviewError(null);
    const onReady = () => {
      if (cancelled) return;
      paintFirstFrame(node);
      if (node.videoWidth > 0) setPreviewError(null);
    };
    const onErr = () => {
      if (!cancelled) setPreviewError(mediaErrorMessage(node));
    };
    const onFs = () => exitIfNativeFullscreen(node);
    const keepInline = () => markInline(node);
    node.addEventListener('loadeddata', onReady);
    node.addEventListener('loadedmetadata', keepInline);
    node.addEventListener('error', onErr);
    node.addEventListener('webkitbeginfullscreen', onFs);
    markInline(node);
    loadInlineSource(node, previewUrl);
    const timer = window.setTimeout(() => {
      if (cancelled || node.readyState >= 1 || node.error) return;
      setPreviewError('This phone did not start loading that video.');
    }, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      node.removeEventListener('loadeddata', onReady);
      node.removeEventListener('loadedmetadata', keepInline);
      node.removeEventListener('error', onErr);
      node.removeEventListener('webkitbeginfullscreen', onFs);
    };
  }, [previewUrl]);

  async function takeFile(next: File | null) {
    if (!next) return;
    if (next.type && !looksLikeVideo(next)) {
      setError('Choose a video.');
      return;
    }
    setError(null);
    setPreviewError(null);
    setReading(true);
    setFile(next);
    setProbe(null);
    const playback = blobWithMime(next, playbackMime(next.type, next.name));
    setPreviewUrl(URL.createObjectURL(playback));
    try {
      const result = await withTimeout(
        probeVideo(playback),
        12000,
        'Reading that video took too long. You can still save it.',
      );
      if (!alive.current) return;
      setProbe(result);
    } catch (err) {
      if (!alive.current) return;
      setError(errorMessage(err, 'Could not read that video. You can still save it.'));
    } finally {
      if (alive.current) setReading(false);
    }
  }

  function requestClose() {
    if (saving) return;
    if (file) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  async function save() {
    if (!file || !view || saving) return;
    setSaving(true);
    setError(null);
    const meta: SwingMeta = {
      id: uid(),
      view,
      date: date || todayISO(),
      club: club.trim(),
      notes: notes.trim(),
      createdAt: Date.now(),
      duration: probe?.duration ?? 0,
      videoWidth: probe?.width ?? 0,
      videoHeight: probe?.height ?? 0,
      fps: DEFAULT_FPS,
      mimeType: playbackMime(file.type, file.name),
      fileName: file.name || 'swing.mov',
      byteSize: file.size,
      thumbnail: probe?.thumbnail ?? null,
      drawings: [],
    };
    try {
      await saveSwing(meta, file);
      if (!alive.current) return;
      onSaved();
    } catch (err) {
      if (!alive.current) return;
      setError(isQuotaError(err) ? quotaMessage() : errorMessage(err, 'Could not save that swing.'));
      setSaving(false);
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Add swing">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Close" data-testid="close-add" onClick={requestClose}>
          <Icon name="close" />
        </button>
        <div className="titles">
          <h1>Add swing</h1>
          <p>Tag it before you save</p>
        </div>
      </header>
      {!file && (
        <div className="sheet-body">
          <div className="source-picker">
            <label className="source-btn">
              <input
                data-testid="pick-camera"
                type="file"
                accept="video/*"
                capture="environment"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  event.target.value = '';
                  void takeFile(next);
                }}
              />
              <Icon name="camera" />
              <span>Record swing</span>
              <small>Opens the iPhone camera</small>
            </label>
            <label className="source-btn">
              <input
                data-testid="pick-library"
                type="file"
                accept="video/*"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  event.target.value = '';
                  void takeFile(next);
                }}
              />
              <Icon name="photos" />
              <span>Choose from library</span>
              <small>Photos, including slo-mo</small>
            </label>
            <p className="tip">
              For 120 or 240 fps, record Slo-Mo in the Camera app, then choose it here. Set the frame step to match
              while you review.
            </p>
          </div>
          {error && (
            <p className="banner" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {file && (
        <form
          className="sheet-form swing-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="sheet-body">
            {previewUrl && (
              <video
                ref={(node) => {
                  previewRef.current = node;
                  if (node) markInline(node);
                }}
                className="preview"
                playsInline
                muted
                preload="auto"
                aria-label="Import preview"
              />
            )}
            {previewError && (
              <p className="banner" role="alert">
                {previewError}
              </p>
            )}
            <p className="file-line">
              {file.name || 'Video'} · {formatBytes(file.size)}
              {reading ? ' · Reading… you can save now.' : ''}
            </p>
            <ViewPicker value={view} onChange={setView} />
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <div className="field">
              <span>Club</span>
              <div className="club-row">
                {CLUBS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip"
                    aria-pressed={club === item}
                    onClick={() => setClub(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <input
                value={club}
                onChange={(event) => setClub(event.target.value)}
                placeholder="Or type a club"
                maxLength={40}
              />
            </div>
            <label className="field">
              <span>Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Miss, feel, what to look at…"
                rows={3}
                maxLength={500}
              />
            </label>
          </div>
          <div className="sheet-footer">
            {error && (
              <p className="banner" role="alert">
                {error}
              </p>
            )}
            {!view && (
              <p className="save-hint" data-testid="save-hint">
                Pick Down the Line or Face On.
              </p>
            )}
            <button type="submit" className="btn primary" data-testid="save-swing" disabled={!view || saving}>
              {saving ? 'Saving…' : 'Save swing'}
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setFile(null);
                setProbe(null);
                setError(null);
                setPreviewError(null);
              }}
            >
              Different video
            </button>
          </div>
        </form>
      )}
      {confirmClose && (
        <Dialog
          title="This swing isn't saved"
          body="Closing now discards the video. It is not in the library until you save."
          confirmLabel="Save swing"
          alternateLabel="Discard video"
          alternateDanger
          onCancel={() => setConfirmClose(false)}
          onAlternate={() => {
            setConfirmClose(false);
            onClose();
          }}
          onConfirm={() => {
            setConfirmClose(false);
            void save();
          }}
        />
      )}
    </div>
  );
}
