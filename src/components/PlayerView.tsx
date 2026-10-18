import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { DRAW_COLORS, FPS_OPTIONS, SPEEDS } from '../constants';
import { deleteSwing, getVideo, listSwings } from '../db';
import { cx, formatDate, formatRate, formatScrub, formatTime, viewLabel } from '../format';
import { withColor } from '../geometry';
import type { SwingMeta, Tool } from '../types';
import { useSwing } from '../useSwing';
import { DetailsSheet } from './DetailsSheet';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icons';
import { Scrubber } from './Scrubber';
import { VideoStage, type VideoEngine } from './VideoStage';

const HINTS: Record<Tool, string> = {
  select: 'Drag a drawing to move it. Drag a handle to reshape it.',
  line: 'Drag a swing-plane line. It extends across the frame.',
  pen: 'Draw with one finger.',
  angle: 'Tap the end, the joint, then the other end.',
  circle: 'Drag from the center outward.',
  box: 'Drag a box.',
  hline: 'Drag a level line.',
  vline: 'Drag a plumb line.',
  erase: 'Tap a drawing to remove it.',
};

const DRAW_TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: 'select', label: 'Move', icon: 'select' },
  { id: 'box', label: 'Box', icon: 'box' },
  { id: 'circle', label: 'Circle', icon: 'circle' },
  { id: 'line', label: 'Line', icon: 'line' },
  { id: 'erase', label: 'Erase', icon: 'erase' },
  { id: 'angle', label: 'Angle', icon: 'angle' },
  { id: 'pen', label: 'Freehand', icon: 'pen' },
  { id: 'hline', label: 'Level', icon: 'hline' },
  { id: 'vline', label: 'Plumb', icon: 'vline' },
];

function useClock(engine: RefObject<VideoEngine | null>) {
  const [clock, setClock] = useState({ time: 0, duration: 0, paused: true });
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const api = engine.current;
      const time = api?.getTime() ?? 0;
      const duration = api?.getDuration() ?? 0;
      const paused = api?.getPaused() ?? true;
      setClock((prev) => {
        if (
          prev.paused === paused &&
          Math.abs(prev.time - time) < 0.0005 &&
          Math.abs(prev.duration - duration) < 0.0005
        ) {
          return prev;
        }
        return { time, duration, paused };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  return clock;
}

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
  const { swing, blob, drawings, pastCount, load, saveError, commit, undo, patch } = useSwing(id);
  const stageRef = useRef<VideoEngine>(null);
  const [tool, setTool] = useState<Tool>('line');
  const [color, setColor] = useState<string>(DRAW_COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playError, setPlayError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [details, setDetails] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pinch, setPinch] = useState(false);
  const [panelPage, setPanelPage] = useState<'tools' | 'trim' | 'overlay'>('tools');
  const [others, setOthers] = useState<SwingMeta[]>([]);
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [overlayBlob, setOverlayBlob] = useState<Blob | null>(null);
  const clock = useClock(stageRef);

  useEffect(() => {
    let cancel = false;
    void listSwings()
      .then((rows) => {
        if (!cancel) setOthers(rows.filter((row) => row.id !== id));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [id]);

  useEffect(() => {
    if (!overlayId) {
      setOverlayBlob(null);
      return;
    }
    let cancel = false;
    void getVideo(overlayId)
      .then((video) => {
        if (!cancel) setOverlayBlob(video);
      })
      .catch(() => {
        if (!cancel) {
          setOverlayBlob(null);
          setPlayError('Could not load that swing for the overlay.');
        }
      });
    return () => {
      cancel = true;
    };
  }, [overlayId]);

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

  function chooseTool(next: Tool) {
    setTool(next);
    setPinch(false);
    setToolsOpen(false);
    setPanelPage('tools');
  }

  function cycleRate() {
    const index = SPEEDS.findIndex((speed) => speed === rate);
    const next = SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
    setRate(next);
  }

  function onTimePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const engine = stageRef.current;
    if (!engine) return;
    engine.pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, time: engine.getTime(), duration: engine.getDuration() };
    const move = (ev: PointerEvent) => {
      const span = Math.max(origin.duration, 0.01);
      const next = Math.min(span, Math.max(0, origin.time + ((ev.clientX - origin.x) / 160) * span));
      engine.seek(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

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
  const mirrored = Boolean(swing.mirrored);
  const trimIn = swing.trimIn ?? null;
  const trimOut = swing.trimOut ?? null;

  return (
    <div className="screen player-screen">
      <div className="stage-wrap player-stage">
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
          mirrored={mirrored}
          panMode={pinch}
          trimIn={trimIn}
          trimOut={trimOut}
          overlayBlob={overlayBlob}
          onSelect={setSelectedId}
          onCommit={commit}
          onDraftChange={setHasDraft}
        />
      </div>

      <button type="button" className="float-btn float-close" aria-label="Close" data-testid="close-player" onClick={onBack}>
        <Icon name="close" />
      </button>
      <button type="button" className="time-pill" data-testid="time-pill" aria-label="Drag sideways to scrub" onPointerDown={onTimePointerDown}>
        {formatScrub(clock.time)}
      </button>
      <button
        type="button"
        className="float-btn float-help"
        aria-label="Help and swing details"
        data-testid="help"
        onClick={() => setHelpOpen(true)}
      >
        <Icon name="help" />
      </button>

      {pinch && <p className="pinch-banner">Drag to pan. Use two fingers to zoom. Open the wrench to draw.</p>}
      {(saveError || playError) && <p className="player-banner">{saveError || playError}</p>}

      <div className="player-bar">
        <Scrubber className="slim" value={clock.time} max={clock.duration} onScrub={scrub} testId="play-scrubber" />
        <div className="bar-meta">
          <button type="button" className="speed-pill" data-testid="speed-pill" aria-label="Playback speed" onClick={cycleRate}>
            {formatRate(rate)}
          </button>
          <button
            type="button"
            className="color-dot"
            data-testid="color-dot"
            aria-label="Current drawing color"
            style={{ background: color }}
            onClick={() => {
              setPanelPage('tools');
              setToolsOpen(true);
            }}
          />
          {trimIn != null || trimOut != null ? (
            <span className="trim-readout">
              {trimIn != null ? formatTime(trimIn) : '0:00.0'} – {trimOut != null ? formatTime(trimOut) : 'end'}
            </span>
          ) : null}
        </div>
        <div className="bar-transport">
          <button type="button" className="bar-icon" aria-label="Previous frame" data-testid="play-back" onClick={() => step(-1)}>
            <Icon name="stepBack" />
          </button>
          <button
            type="button"
            className="bar-icon bar-play"
            aria-label={clock.paused ? 'Play' : 'Pause'}
            data-testid="play"
            onClick={() => void toggle()}
          >
            <Icon name={clock.paused ? 'play' : 'pause'} />
          </button>
          <button type="button" className="bar-icon" aria-label="Next frame" data-testid="play-forward" onClick={() => step(1)}>
            <Icon name="stepForward" />
          </button>
          <button
            type="button"
            className={cx('bar-icon bar-wrench', toolsOpen && 'is-on')}
            aria-label="Tools"
            aria-pressed={toolsOpen}
            data-testid="tools-toggle"
            onClick={() => {
              setPanelPage('tools');
              setToolsOpen((open) => !open);
            }}
          >
            <Icon name="wrench" />
          </button>
        </div>
      </div>

      {toolsOpen && (
        <div
          className="tool-backdrop"
          data-testid="tool-panel"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setToolsOpen(false);
          }}
        >
          <div className="tool-panel" role="dialog" aria-label="Edit tools">
            {panelPage === 'tools' && (
              <>
                <h2>Edit Tools</h2>
                <div className="tool-grid">
                  <ToolButton
                    icon="flip"
                    label="Flip"
                    pressed={mirrored}
                    testId="edit-flip"
                    onClick={() => {
                      void patch({ mirrored: !mirrored }).catch(() => setPlayError('Could not save the flip.'));
                    }}
                  />
                  <ToolButton
                    icon="trim"
                    label="Trim"
                    pressed={trimIn != null || trimOut != null}
                    testId="edit-trim"
                    onClick={() => setPanelPage('trim')}
                  />
                  <ToolButton
                    icon="pinch"
                    label="Pinch"
                    pressed={pinch}
                    testId="edit-pinch"
                    onClick={() => {
                      setPinch((value) => !value);
                      setToolsOpen(false);
                    }}
                  />
                  <ToolButton icon="compare" label="Compare" testId="edit-compare" onClick={() => onCompare(swing.id)} />
                  <ToolButton
                    icon="overlay"
                    label="Overlay"
                    pressed={overlayBlob != null}
                    testId="edit-overlay"
                    onClick={() => setPanelPage('overlay')}
                  />
                </div>
                <h2>Draw Tools</h2>
                <p className="panel-hint">{HINTS[tool]}</p>
                <div className="tool-grid">
                  {DRAW_TOOLS.map((item) => (
                    <ToolButton
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      pressed={tool === item.id && !pinch}
                      testId={`tool-${item.id}`}
                      onClick={() => chooseTool(item.id)}
                    />
                  ))}
                  <ToolButton icon="undo" label="Undo" testId="tool-undo" disabled={pastCount === 0 && !hasDraft} onClick={undoAll} />
                </div>
                <h2>Colors</h2>
                <div className="color-row" role="group" aria-label="Drawing color">
                  {DRAW_COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className="color-choice"
                      style={{ background: swatch }}
                      aria-label={`Color ${swatch}`}
                      aria-pressed={color === swatch}
                      data-testid={`color-${swatch.slice(1)}`}
                      onClick={() => {
                        setColor(swatch);
                        if (!selectedId) return;
                        commit(drawings.map((drawing) => (drawing.id === selectedId ? withColor(drawing, swatch) : drawing)));
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {panelPage === 'trim' && (
              <div className="panel-page">
                <h2>Trim</h2>
                <p className="panel-hint">Paused at {formatScrub(clock.time)}. Playback stays between the two marks.</p>
                <div className="panel-actions">
                  <button
                    type="button"
                    className="btn"
                    data-testid="trim-start"
                    onClick={() => {
                      const time = stageRef.current?.getTime() ?? 0;
                      const nextOut = trimOut != null && trimOut <= time ? null : trimOut;
                      void patch({ trimIn: time, trimOut: nextOut }).catch(() => setPlayError('Could not save the trim.'));
                    }}
                  >
                    Set start
                  </button>
                  <button
                    type="button"
                    className="btn"
                    data-testid="trim-end"
                    onClick={() => {
                      const time = stageRef.current?.getTime() ?? 0;
                      const nextIn = trimIn != null && trimIn >= time ? null : trimIn;
                      void patch({ trimIn: nextIn, trimOut: time }).catch(() => setPlayError('Could not save the trim.'));
                    }}
                  >
                    Set end
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void patch({ trimIn: null, trimOut: null }).catch(() => setPlayError('Could not save the trim.'));
                    }}
                  >
                    Clear
                  </button>
                </div>
                <button type="button" className="text-btn" onClick={() => setPanelPage('tools')}>
                  Back
                </button>
              </div>
            )}

            {panelPage === 'overlay' && (
              <div className="panel-page">
                <h2>Overlay</h2>
                <p className="panel-hint">A second swing sits on top, half transparent, and follows this one.</p>
                <div className="overlay-list">
                  {others.length === 0 && <p className="panel-hint">Save another swing first.</p>}
                  {others.map((other) => (
                    <button
                      key={other.id}
                      type="button"
                      className={cx('overlay-choice', overlayId === other.id && 'is-on')}
                      data-testid={`overlay-${other.id}`}
                      onClick={() => {
                        setOverlayId(other.id);
                        setToolsOpen(false);
                        setPanelPage('tools');
                      }}
                    >
                      <strong>{other.club || 'Swing'}</strong>
                      <span>
                        {viewLabel(other.view)} · {formatDate(other.date)}
                      </span>
                    </button>
                  ))}
                </div>
                {overlayId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setOverlayId(null);
                      setToolsOpen(false);
                    }}
                  >
                    Remove overlay
                  </button>
                )}
                <button type="button" className="text-btn" onClick={() => setPanelPage('tools')}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Help">
          <header className="topbar">
            <button type="button" className="icon-btn" aria-label="Close help" onClick={() => setHelpOpen(false)}>
              <Icon name="close" />
            </button>
            <div className="titles">
              <h1>{swing.club || 'Swing'}</h1>
              <p>
                {viewLabel(swing.view)} · {formatDate(swing.date)}
              </p>
            </div>
          </header>
          <div className="sheet-body">
            <p className="tip">
              The video stays on this page, so you can draw on it. Pause, open the wrench, pick a tool, and drag with one
              finger. Drag the time at the top, or the bar above the buttons, to scrub. Frame step is the arrows.
            </p>
            {swing.notes ? <p className="note-block">{swing.notes}</p> : null}
            <div className="fps-row" role="group" aria-label="Frame step size">
              <span>Step</span>
              {FPS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cx('chip tiny', fps === option && 'is-on')}
                  aria-pressed={fps === option}
                  onClick={() => {
                    void patch({ fps: option }).catch(() => setPlayError('Could not save the frame rate.'));
                  }}
                >
                  {option}
                </button>
              ))}
              <span className="faint">fps</span>
            </div>
            <div className="panel-actions">
              <button type="button" className={cx('btn', !muted && 'primary')} onClick={() => setMuted((value) => !value)}>
                {muted ? 'Sound off' : 'Sound on'}
              </button>
              <button type="button" className={cx('btn', loop && 'primary')} onClick={() => setLoop((value) => !value)}>
                {loop ? 'Loop on' : 'Loop off'}
              </button>
            </div>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={() => setDetails(true)}>
                Edit details
              </button>
              <button type="button" className="btn" disabled={drawings.length === 0} onClick={() => setConfirmClear(true)}>
                Clear drawings
              </button>
              <button type="button" className="btn danger" data-testid="delete-swing" onClick={() => setConfirmDelete(true)}>
                Delete swing
              </button>
            </div>
          </div>
        </div>
      )}

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

function ToolButton({
  icon,
  label,
  pressed,
  disabled,
  testId,
  onClick,
}: {
  icon: IconName;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="panel-tool"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
