import { useEffect, useRef, useState, type RefObject } from 'react';
import { SPEEDS } from '../constants';
import { cx, speedLabel, viewLabel } from '../format';
import { withColor } from '../geometry';
import type { Tool } from '../types';
import { useSwing } from '../useSwing';
import { Dialog } from './Dialog';
import { DrawToolbar } from './DrawToolbar';
import { Icon } from './Icons';
import { PlaybackBar } from './PlaybackBar';
import { VideoStage, type VideoEngine } from './VideoStage';

export function CompareView({ a, b, onBack }: { a: string; b: string; onBack: () => void }) {
  const swingA = useSwing(a);
  const swingB = useSwing(b);
  const aRef = useRef<VideoEngine>(null);
  const bRef = useRef<VideoEngine>(null);
  const syncRef = useRef(false);
  const leaderRef = useRef<'a' | 'b' | null>(null);
  const lastSeek = useRef(0);
  const [sync, setSync] = useState(false);
  const [syncRate, setSyncRate] = useState(1);
  const [rateA, setRateA] = useState(1);
  const [rateB, setRateB] = useState(1);
  const [active, setActive] = useState<'a' | 'b'>('a');
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#ffe14a');
  const [selA, setSelA] = useState<string | null>(null);
  const [selB, setSelB] = useState<string | null>(null);
  const [draftA, setDraftA] = useState(false);
  const [draftB, setDraftB] = useState(false);
  const [mutedA, setMutedA] = useState(true);
  const [mutedB, setMutedB] = useState(true);
  const [loopA, setLoopA] = useState(false);
  const [loopB, setLoopB] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const leader = leaderRef.current;
      if (syncRef.current && leader) {
        const lead = (leader === 'a' ? aRef : bRef).current;
        const follow = (leader === 'a' ? bRef : aRef).current;
        if (lead && follow && !lead.getPaused()) {
          const leadDur = lead.getDuration();
          const followDur = follow.getDuration();
          const now = performance.now();
          if (leadDur > 0 && followDur > 0 && now - lastSeek.current > 90) {
            const target = (lead.getTime() / leadDur) * followDur;
            if (Math.abs(follow.getTime() - target) > 0.045) {
              lastSeek.current = now;
              follow.seek(target);
            }
          }
        }
      }
      frame = requestAnimationFrame(tick);
      return undefined;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function engine(which: 'a' | 'b') {
    return which === 'a' ? aRef.current : bRef.current;
  }

  function snap(leader: 'a' | 'b') {
    const lead = engine(leader);
    const follow = engine(leader === 'a' ? 'b' : 'a');
    if (!lead || !follow) return;
    const leadDur = lead.getDuration();
    const followDur = follow.getDuration();
    if (leadDur > 0 && followDur > 0) follow.seek((lead.getTime() / leadDur) * followDur);
  }

  function toggleSync() {
    const next = !syncRef.current;
    syncRef.current = next;
    setSync(next);
    leaderRef.current = null;
    aRef.current?.pause();
    bRef.current?.pause();
    if (next) snap(active);
  }

  async function toggle(which: 'a' | 'b') {
    const lead = engine(which);
    const follow = engine(which === 'a' ? 'b' : 'a');
    if (!lead) return;
    if (syncRef.current) {
      if (!lead.getPaused() || leaderRef.current) {
        aRef.current?.pause();
        bRef.current?.pause();
        leaderRef.current = null;
        return;
      }
      follow?.pause();
      snap(which);
      lead.setRate(syncRate);
      leaderRef.current = which;
      try {
        await lead.play();
        setError(null);
      } catch (err) {
        leaderRef.current = null;
        setError(err instanceof Error ? err.message : 'Could not play.');
      }
      return;
    }
    if (lead.getPaused()) {
      lead.setRate(which === 'a' ? rateA : rateB);
      try {
        await lead.play();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not play.');
      }
    } else {
      lead.pause();
    }
  }

  function step(which: 'a' | 'b', dir: number) {
    const lead = engine(which);
    const follow = engine(which === 'a' ? 'b' : 'a');
    if (!lead) return;
    leaderRef.current = null;
    lead.step(dir);
    follow?.pause();
    if (!syncRef.current || !follow) return;
    const leadDur = lead.getDuration();
    const followDur = follow.getDuration();
    if (leadDur > 0 && followDur > 0) follow.seek((lead.getTime() / leadDur) * followDur);
  }

  function scrub(which: 'a' | 'b', time: number) {
    const lead = engine(which);
    const follow = engine(which === 'a' ? 'b' : 'a');
    if (!lead) return;
    leaderRef.current = null;
    lead.pause();
    follow?.pause();
    lead.seek(time);
    if (!syncRef.current || !follow) return;
    const leadDur = lead.getDuration();
    const followDur = follow.getDuration();
    if (leadDur > 0 && followDur > 0) follow.seek((time / leadDur) * followDur);
  }

  const editor = active === 'a' ? swingA : swingB;
  const selectedId = active === 'a' ? selA : selB;
  const setSelected = active === 'a' ? setSelA : setSelB;
  const hasDraft = active === 'a' ? draftA : draftB;

  function undoActive() {
    const stage = engine(active);
    if (stage?.undoDraft()) return;
    editor.undo();
    setSelected(null);
  }

  return (
    <div className="screen compare-screen">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div className="titles">
          <h1>Compare</h1>
          <p>{sync ? 'Matching swing progress' : 'Each clip scrubs on its own'}</p>
        </div>
        <button type="button" className={cx('btn tiny', sync && 'primary')} aria-pressed={sync} data-testid="sync" onClick={toggleSync}>
          {sync ? 'Synced' : 'Sync'}
        </button>
      </header>
      {sync && (
        <div className="seg sync-rates" role="group" aria-label="Synced playback speed">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={syncRate === speed}
              data-testid={`sync-speed-${speed}`}
              onClick={() => {
                setSyncRate(speed);
                aRef.current?.setRate(speed);
                bRef.current?.setRate(speed);
              }}
            >
              {speedLabel(speed)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="banner">{error}</p>}
      <div className="compare-body">
        <Pane
          which="a"
          active={active === 'a'}
          onActivate={() => setActive('a')}
          swing={swingA}
          engineRef={aRef}
          tool={tool}
          color={color}
          selectedId={selA}
          onSelect={setSelA}
          rate={sync ? syncRate : rateA}
          onRate={setRateA}
          loop={loopA}
          onLoop={() => setLoopA((value) => !value)}
          muted={mutedA}
          onMuted={() => setMutedA((value) => !value)}
          showRates={!sync}
          onToggle={() => void toggle('a')}
          onStep={(dir) => step('a', dir)}
          onScrub={(time) => scrub('a', time)}
          onDraft={setDraftA}
        />
        <Pane
          which="b"
          active={active === 'b'}
          onActivate={() => setActive('b')}
          swing={swingB}
          engineRef={bRef}
          tool={tool}
          color={color}
          selectedId={selB}
          onSelect={setSelB}
          rate={sync ? syncRate : rateB}
          onRate={setRateB}
          loop={loopB}
          onLoop={() => setLoopB((value) => !value)}
          muted={mutedB}
          onMuted={() => setMutedB((value) => !value)}
          showRates={!sync}
          onToggle={() => void toggle('b')}
          onStep={(dir) => step('b', dir)}
          onScrub={(time) => scrub('b', time)}
          onDraft={setDraftB}
        />
      </div>
      <div className="dock compare-dock">
        <DrawToolbar
          tool={tool}
          color={color}
          canUndo={editor.pastCount > 0 || hasDraft}
          hasSelection={selectedId != null}
          canClear={editor.drawings.length > 0}
          onTool={setTool}
          onColor={(next) => {
            setColor(next);
            if (!selectedId) return;
            editor.commit(editor.drawings.map((drawing) => (drawing.id === selectedId ? withColor(drawing, next) : drawing)));
          }}
          onUndo={undoActive}
          onDelete={() => {
            if (!selectedId) return;
            editor.commit(editor.drawings.filter((drawing) => drawing.id !== selectedId));
            setSelected(null);
          }}
          onClear={() => setConfirmClear(true)}
        />
      </div>
      {confirmClear && (
        <Dialog
          title="Clear drawings?"
          body="Drawings on the selected swing will be removed. You can undo it."
          confirmLabel="Clear"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            editor.commit([]);
            setSelected(null);
            setConfirmClear(false);
          }}
        />
      )}
    </div>
  );
}

function Pane({
  which,
  active,
  onActivate,
  swing,
  engineRef,
  tool,
  color,
  selectedId,
  onSelect,
  rate,
  onRate,
  loop,
  onLoop,
  muted,
  onMuted,
  showRates,
  onToggle,
  onStep,
  onScrub,
  onDraft,
}: {
  which: 'a' | 'b';
  active: boolean;
  onActivate: () => void;
  swing: ReturnType<typeof useSwing>;
  engineRef: RefObject<VideoEngine | null>;
  tool: Tool;
  color: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  rate: number;
  onRate: (rate: number) => void;
  loop: boolean;
  onLoop: () => void;
  muted: boolean;
  onMuted: () => void;
  showRates: boolean;
  onToggle: () => void;
  onStep: (dir: number) => void;
  onScrub: (time: number) => void;
  onDraft: (has: boolean) => void;
}) {
  const ready = swing.load.status === 'ready' && swing.swing && swing.blob;
  return (
    <section className={cx('pane', active && 'active')} onPointerDown={onActivate}>
      <div className="pane-label">
        {swing.swing ? (
          <>
            <strong>{swing.swing.club || 'Swing'}</strong>
            <span>{viewLabel(swing.swing.view)}</span>
          </>
        ) : (
          <span>{swing.load.status === 'loading' ? 'Loading…' : 'Missing swing'}</span>
        )}
      </div>
      <div className="pane-stage">
        {ready && swing.blob && swing.swing ? (
          <VideoStage
            ref={engineRef}
            blob={swing.blob}
            drawings={swing.drawings}
            tool={tool}
            color={color}
            selectedId={selectedId}
            fps={swing.swing.fps || 60}
            rate={rate}
            loop={loop}
            muted={muted}
            onSelect={onSelect}
            onCommit={swing.commit}
            onDraftChange={onDraft}
          />
        ) : (
          <div className="stage">
            <p className="stage-error">
              {swing.load.status === 'error'
                ? swing.load.message
                : swing.load.status === 'missing'
                  ? "This swing isn't on this phone."
                  : 'Loading…'}
            </p>
          </div>
        )}
      </div>
      {ready && swing.swing && (
        <PlaybackBar
          engine={engineRef}
          fps={swing.swing.fps || 60}
          rate={rate}
          onRate={onRate}
          loop={loop}
          onLoop={onLoop}
          muted={muted}
          onMuted={onMuted}
          onToggle={onToggle}
          onStep={onStep}
          onScrub={onScrub}
          showRates={showRates}
          showExtras={false}
          compact
          testId={`play-${which}`}
        />
      )}
    </section>
  );
}
