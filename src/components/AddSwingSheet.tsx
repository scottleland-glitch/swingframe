import { useEffect, useRef, useState } from 'react';
import { CLUBS, DEFAULT_FPS } from '../constants';
import { isQuotaError, quotaMessage, saveSwing } from '../db';
import { errorMessage, formatBytes, todayISO, uid } from '../format';
import type { SwingMeta, ViewAngle } from '../types';
import { exitIfNativeFullscreen, loadInlineSource, mediaErrorMessage, paintFirstFrame } from '../inlineVideo';
import { looksLikeVideo, probeVideo, type ProbeResult } from '../videoProbe';
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
  const [view, setView] = useState<ViewAngle | null>(null);
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
    node.addEventListener('loadeddata', onReady);
    node.addEventListener('error', onErr);
    node.addEventListener('webkitbeginfullscreen', onFs);
    loadInlineSource(node, previewUrl);
    const timer = window.setTimeout(() => {
      if (cancelled || node.readyState >= 1 || node.error) return;
      setPreviewError('This phone did not start loading that video.');
    }, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      node.removeEventListener('loadeddata', onReady);
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
    setPreviewUrl(URL.createObjectURL(next));
    try {
      const result = await probeVideo(next);
      if (!alive.current) return;
      setProbe(result);
    } catch (err) {
      if (!alive.current) return;
      setFile(null);
      setError(errorMessage(err, 'Could not read that video.'));
    } finally {
      if (alive.current) setReading(false);
    }
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
      mimeType: file.type || 'video/mp4',
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
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="titles">
          <h1>Add swing</h1>
          <p>Tag it before you save</p>
        </div>
      </header>
      <div className="sheet-body">
        {!file && (
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
        )}

        {file && (
          <form
            className="swing-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {previewUrl && (
              <video
                ref={previewRef}
                className="preview"
                playsInline
                muted
                preload="auto"
                controls={false}
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
              {reading ? ' · Reading…' : ''}
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
            {error && (
              <p className="banner" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFile(null);
                  setProbe(null);
                  setError(null);
                }}
              >
                Different video
              </button>
              <button
                type="submit"
                className="btn primary"
                data-testid="save-swing"
                disabled={!view || reading || saving}
              >
                {saving ? 'Saving…' : 'Save swing'}
              </button>
            </div>
          </form>
        )}
        {!file && error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
