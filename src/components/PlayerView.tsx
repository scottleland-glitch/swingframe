import { useCallback, useEffect, useRef, useState } from 'react';
import { FPS_OPTIONS } from '../constants';
import { deleteSwing } from '../db';
import { cx, formatDate, viewLabel } from '../format';
import { withColor } from '../geometry';
import { storageGet, storageSet } from '../platform';
import type { Tool } from '../types';
import { useSwing } from '../useSwing';
import { DetailsSheet } from './DetailsSheet';
import { Dialog } from './Dialog';
import { DrawToolbar } from './DrawToolbar';
import { Icon } from './Icons';
import { PlaybackBar } from './PlaybackBar';
import { VideoStage, type VideoEngine } from './VideoStage';

const HINTS: Record<Tool, string> = {
  select: 'Tap a drawing to move it. Drag a dot to reshape it.',
  line: 'Drag from the ball through the hands. The line extends across the frame.',
  pen: 'Draw with your finger.',
  angle: 'Tap end, joint, then the other end. The number is the angle between them.',
  circle: 'Drag from the center out. Useful for the head.',
  box: 'Drag a box around the hips or head.',
  hline: 'Drag a level line, for shoulder or knee height.',
  vline: 'Drag a plumb line.',
};

export function PlayerView({
  id,
  onBack,
  onCompare,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onCompare: (id: string) => void;
  onChanged: () => void;
}) {
  const { swing, blob, drawings, pastCount, load, saveError, lastSaved, commit, undo, patch } = useSwing(id);
  const stageRef = useRef<VideoEngine>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const [tool, setTool] = useState<Tool>('line');
  const [color, setColor] = useState('#ffe14a');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playError, setPlayError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [details, setDetails] = useState(false);
  const [coach, setCoach] = useState(() => storageGet('swingframe.coach.v1') !== '1');
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (!lastSaved) return;
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), 1400);
    return () => window.clearTimeout(timer);
  }, [lastSaved]);

  const toggle = useCallback(async () => {
    const engine = stageRef.current;
    if (!engine) return;
    if (engine.getPaused()) {
      try {
        await engine.play();
        setPlayError(null);
      } catch (err) {
        setPlayError(err instanceof Error ? err.message : 'Could not play.');
      }
    } else {
      engine.pause();
    }
  }, []);

  const step = useCallback((dir: number) => {
    stageRef.current?.step(dir);
  }, []);

  const scrub = useCallback((time: number) => {
    const engine = stageRef.current;
    if (!engine) return;
    engine.pause();
    engine.seek(time);
  }, []);

  const undoAll = useCallback(() => {
    if (stageRef.current?.undoDraft()) return;
    undo();
    setSelectedId(null);
  }, [undo]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit(drawings.filter((drawing) => drawing.id !== selectedId));
    setSelectedId(null);
  }, [commit, drawings, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === ' ') {
        event.preventDefault();
        void toggle();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        removeSelected();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeSelected, step, toggle, undoAll]);

  if (load.status !== 'ready' || !swing || !blob) {
    const message =
      load.status === 'loading'
        ? 'Loading swing…'
        : load.status === 'error'
          ? load.message
          : "This swing isn't on this phone.";
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
            <Icon name="back" />
          </button>
          <div className="titles">
            <h1>Swing</h1>
          </div>
        </header>
        <div className="empty">
          <p>{message}</p>
          <button type="button" className="btn" onClick={onBack}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  const fps = swing.fps || 60;

  return (
    <div className="screen player-screen">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="titles">
          <h1>{swing.club || 'Swing'}</h1>
          <p>
            {viewLabel(swing.view)} · {formatDate(swing.date)}
            {showSaved ? ' · Saved' : ''}
          </p>
        </div>
        <button type="button" className="text-btn" onClick={() => setDetails(true)}>
          Edit
        </button>
        <button type="button" className="icon-btn" aria-label="Compare with another swing" onClick={() => onCompare(swing.id)}>
          <Icon name="compare" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Delete swing"
          data-testid="delete-swing"
          onClick={() => setConfirmDelete(true)}
        >
          <Icon name="trash" />
        </button>
      </header>

      <div className="stage-wrap">
        <VideoStage
          ref={stageRef}
          blob={blob}
          drawings={drawings}
          tool={tool}
          color={color}
          selectedId={selectedId}
          fps={fps}
          rate={rate}
          loop={loop}
          muted={muted}
          onSelect={setSelectedId}
          onCommit={commit}
          onDraftChange={setHasDraft}
          onZoom={(scale) => {
            if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(scale * 100)}%`;
          }}
        />
      </div>

      <div className="dock">
        {(saveError || playError) && <p className="banner">{saveError || playError}</p>}
        {coach && (
          <div className="note coach">
            <p>Pinch with two fingers, or use + to zoom. Lines stay stuck to the video.</p>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                storageSet('swingframe.coach.v1', '1');
                setCoach(false);
              }}
            >
              Got it
            </button>
          </div>
        )}
        <DrawToolbar
          tool={tool}
          color={color}
          hint={HINTS[tool]}
          canUndo={pastCount > 0 || hasDraft}
          hasSelection={selectedId != null}
          canClear={drawings.length > 0}
          onTool={setTool}
          onColor={(next) => {
            setColor(next);
            if (!selectedId) return;
            commit(drawings.map((drawing) => (drawing.id === selectedId ? withColor(drawing, next) : drawing)));
          }}
          onUndo={undoAll}
          onDelete={removeSelected}
          onClear={() => setConfirmClear(true)}
          zoom={{
            labelRef: zoomLabel,
            onZoomOut: () => stageRef.current?.zoomBy(1 / 1.25),
            onZoomIn: () => stageRef.current?.zoomBy(1.25),
            onFit: () => stageRef.current?.resetZoom(),
          }}
        />
        <PlaybackBar
          engine={stageRef}
          fps={fps}
          rate={rate}
          onRate={setRate}
          loop={loop}
          onLoop={() => setLoop((value) => !value)}
          muted={muted}
          onMuted={() => setMuted((value) => !value)}
          onToggle={() => void toggle()}
          onStep={step}
          onScrub={scrub}
        />
        <div className="fps-row" role="group" aria-label="Frame step size">
          <span>Step</span>
          {FPS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={cx('chip tiny', fps === option && 'is-on')}
              aria-pressed={fps === option}
              onClick={() => {
                void patch({ fps: option }).catch((err: unknown) => {
                  setPlayError(err instanceof Error ? err.message : 'Could not save the frame rate.');
                });
              }}
            >
              {option}
            </button>
          ))}
          <span className="faint">fps</span>
        </div>
      </div>

      {details && (
        <DetailsSheet
          swing={swing}
          onClose={() => setDetails(false)}
          onSave={async (next) => {
            await patch(next);
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Dialog
          title="Delete this swing?"
          body="The video and drawings will be removed from this phone."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteSwing(swing.id)
              .then(() => {
                onChanged();
                onBack();
              })
              .catch((err: unknown) => {
                setPlayError(err instanceof Error ? err.message : 'Could not delete the swing.');
              });
          }}
        />
      )}
      {confirmClear && (
        <Dialog
          title="Clear drawings?"
          body="All drawings on this swing will be removed. You can undo it."
          confirmLabel="Clear"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            commit([]);
            setSelectedId(null);
            setConfirmClear(false);
          }}
        />
      )}
    </div>
  );
}
