import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clubGroup, type ClubFilter } from '../clubs';
import { deleteSwings, listSwings, storedUsage } from '../db';
import { cx, formatBytes, formatDate, formatDuration, viewLabel } from '../format';
import { isIos, isStandalone, requestPersistentStorage, storageGet, storageSet } from '../platform';
import type { SwingMeta, ViewAngle } from '../types';
import { APP_VERSION } from '../version';
import { Dialog } from './Dialog';
import { Icon } from './Icons';

type ViewFilter = 'all' | ViewAngle;

const CLUB_FILTERS: { id: ClubFilter; label: string; name: string }[] = [
  { id: 'all', label: 'All', name: 'All clubs' },
  { id: 'driver', label: 'Driver', name: 'Driver' },
  { id: 'iron', label: 'Iron', name: 'Iron' },
  { id: 'wedge', label: 'Wedge', name: 'Wedge' },
];

const VIEW_FILTERS: { id: ViewFilter; label: string; name: string }[] = [
  { id: 'all', label: 'All', name: 'All views' },
  { id: 'dtl', label: 'DTL', name: 'Down the Line' },
  { id: 'face', label: 'FO', name: 'Face On' },
];

export function LibraryView({
  picking = false,
  initialPicked = [],
  onOpen,
  onCompare,
  onAdd,
}: {
  picking?: boolean;
  initialPicked?: string[];
  onOpen: (id: string) => void;
  onCompare: (a: string, b: string) => void;
  onAdd: () => void;
}) {
  const [swings, setSwings] = useState<SwingMeta[]>([]);
  const [clubFilter, setClubFilter] = useState<ClubFilter>('all');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState(picking);
  const [picked, setPicked] = useState<string[]>(initialPicked);
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [hideInstall, setHideInstall] = useState(() => storageGet('swingframe.install.v1') === '1');

  useEffect(() => {
    let cancel = false;
    void listSwings()
      .then((rows) => {
        if (!cancel) setSwings(rows);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : 'Could not read saved swings.');
      });
    void requestPersistentStorage().then((ok) => {
      if (!cancel) setPersisted(ok);
    });
    void storedUsage().then((bytes) => {
      if (!cancel) setUsage(bytes);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const viewFiltered = useMemo(
    () => swings.filter((swing) => viewFilter === 'all' || swing.view === viewFilter),
    [swings, viewFilter],
  );
  const clubFiltered = useMemo(
    () => swings.filter((swing) => clubFilter === 'all' || clubGroup(swing.club) === clubFilter),
    [swings, clubFilter],
  );
  const visible = useMemo(
    () => viewFiltered.filter((swing) => clubFilter === 'all' || clubGroup(swing.club) === clubFilter),
    [viewFiltered, clubFilter],
  );
  const showInstall = isIos() && !isStandalone() && !hideInstall;
  const swipeEnabled = !selecting && !pickMode;

  function togglePick(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 2) return [current[1], id];
      return [...current, id];
    });
  }

  function toggleChosen(id: string) {
    setChosen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function refreshUsage() {
    void storedUsage().then(setUsage).catch(() => undefined);
  }

  async function confirmDelete() {
    const ids = pendingDelete ?? [];
    setPendingDelete(null);
    if (ids.length === 0) return;
    try {
      await deleteSwings(ids);
      setSwings((current) => current.filter((swing) => !ids.includes(swing.id)));
      setChosen((current) => current.filter((id) => !ids.includes(id)));
      setPicked((current) => current.filter((id) => !ids.includes(id)));
      setRevealedId(null);
      setSelecting(false);
      refreshUsage();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the swing.');
    }
  }

  return (
    <div className="screen">
      <header className="topbar library-top">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="line" />
          </span>
          <div>
            <p className="brand-name">Swingframe</p>
            <p className="brand-sub" data-testid="app-version">
              Scott&apos;s swing book · Version {APP_VERSION}
            </p>
          </div>
        </div>
        {usage != null && (
          <p className="usage" data-testid="storage-usage">
            {formatBytes(usage)} on this phone
          </p>
        )}
      </header>

      <div className="filter-groups">
        <div className="filter-row">
          <span className="filter-label" id="filter-club-label">
            Club
          </span>
          <div className="filters" role="group" aria-labelledby="filter-club-label">
            {CLUB_FILTERS.map((item) => (
              <FilterChip
                key={item.id}
                testId={`filter-club-${item.id}`}
                label={item.label}
                name={item.name}
                count={viewFiltered.filter((swing) => item.id === 'all' || clubGroup(swing.club) === item.id).length}
                pressed={clubFilter === item.id}
                onSelect={() => setClubFilter(item.id)}
              />
            ))}
          </div>
        </div>
        <div className="filter-row">
          <span className="filter-label" id="filter-view-label">
            View
          </span>
          <div className="filters" role="group" aria-labelledby="filter-view-label">
            {VIEW_FILTERS.map((item) => (
              <FilterChip
                key={item.id}
                testId={`filter-view-${item.id === 'face' ? 'fo' : item.id}`}
                label={item.label}
                name={item.name}
                count={clubFiltered.filter((swing) => item.id === 'all' || swing.view === item.id).length}
                pressed={viewFilter === item.id}
                onSelect={() => setViewFilter(item.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="list-scroll">
        {showInstall && (
          <div className="note">
            <p>
              Add Swingframe to your Home Screen, then import swings from that icon. On iPhone, the home screen app
              keeps its own saved videos.
            </p>
            <p>In Safari, tap Share, then Add to Home Screen.</p>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                storageSet('swingframe.install.v1', '1');
                setHideInstall(true);
              }}
            >
              Dismiss
            </button>
          </div>
        )}
        {persisted === false && (
          <div className="note">
            This phone has not granted permanent storage. Open Swingframe from the Home Screen now and then so iOS is
            less likely to clear saved swings.
          </div>
        )}
        {error && <p className="banner">{error}</p>}
        {pickMode && <p className="pick-hint">Choose two swings. The order you tap is left/top, then right/bottom.</p>}
        {selecting && <p className="pick-hint">Tap the swings to delete, then Delete.</p>}
        {visible.length === 0 ? (
          <div className="empty">
            <span className="brand-mark big" aria-hidden="true">
              <Icon name="line" />
            </span>
            <h2>{swings.length === 0 ? 'No swings yet' : 'Nothing in this filter'}</h2>
            <p>
              {swings.length === 0
                ? 'Record on the range, or pull a slo-mo clip from your camera roll. Drawings stay on this phone.'
                : 'Try another club or camera angle, or add a swing.'}
            </p>
          </div>
        ) : (
          <ul className="swing-list">
            {visible.map((swing) => {
              const selected = selecting ? chosen.includes(swing.id) : picked.includes(swing.id);
              const mark = selecting
                ? selected
                  ? '✓'
                  : ''
                : pickMode
                  ? selected
                    ? String(picked.indexOf(swing.id) + 1)
                    : ''
                  : null;
              return (
                <SwingRow
                  key={swing.id}
                  swing={swing}
                  selected={selected}
                  mark={mark}
                  revealed={revealedId === swing.id}
                  swipeEnabled={swipeEnabled}
                  onReveal={() => setRevealedId(swing.id)}
                  onCloseReveal={() => setRevealedId((current) => (current === swing.id ? null : current))}
                  onOpen={() => {
                    if (selecting) toggleChosen(swing.id);
                    else if (pickMode) togglePick(swing.id);
                    else onOpen(swing.id);
                  }}
                  onDelete={() => setPendingDelete([swing.id])}
                />
              );
            })}
          </ul>
        )}
        <p className="privacy">Videos stay on this phone. Nothing is uploaded. Swipe a swing left to delete it.</p>
      </div>

      <div className="bottom-bar">
        {pickMode ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPickMode(false);
                setPicked([]);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              data-testid="compare-open"
              disabled={picked.length !== 2}
              onClick={() => onCompare(picked[0], picked[1])}
            >
              Compare
            </button>
          </>
        ) : selecting ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSelecting(false);
                setChosen([]);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              data-testid="delete-selected"
              disabled={chosen.length === 0}
              onClick={() => setPendingDelete(chosen)}
            >
              Delete{chosen.length > 0 ? ` ${chosen.length}` : ''}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn"
              data-testid="select-mode"
              disabled={swings.length === 0}
              onClick={() => {
                setSelecting(true);
                setChosen([]);
                setRevealedId(null);
              }}
            >
              Select
            </button>
            <button
              type="button"
              className="btn"
              data-testid="compare-mode"
              disabled={swings.length < 2}
              onClick={() => {
                setSelecting(false);
                setChosen([]);
                setPickMode(true);
              }}
            >
              <Icon name="compare" />
              Compare
            </button>
            <button type="button" className="btn primary" data-testid="add-swing" onClick={onAdd}>
              <Icon name="plus" />
              Add swing
            </button>
          </>
        )}
      </div>

      {pendingDelete && (
        <Dialog
          title={pendingDelete.length === 1 ? 'Delete this swing?' : `Delete ${pendingDelete.length} swings?`}
          body="The video, thumbnail, and drawings will be removed from this phone."
          confirmLabel="Delete"
          danger
          confirmTestId="confirm-delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
    </div>
  );
}

function FilterChip({
  testId,
  label,
  name,
  count,
  pressed,
  onSelect,
}: {
  testId: string;
  label: string;
  name?: string;
  count: number;
  pressed: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={pressed}
      aria-label={name ?? label}
      data-testid={testId}
      onClick={onSelect}
    >
      {label}
      <span>{count}</span>
    </button>
  );
}

function SwingRow({
  swing,
  selected,
  mark,
  revealed,
  swipeEnabled,
  onReveal,
  onCloseReveal,
  onOpen,
  onDelete,
}: {
  swing: SwingMeta;
  selected: boolean;
  mark: string | null;
  revealed: boolean;
  swipeEnabled: boolean;
  onReveal: () => void;
  onCloseReveal: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const reveal = 92;
  const [shift, setShift] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; base: number; horizontal: boolean | null } | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => {
    if (!revealed) setShift(0);
  }, [revealed]);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!swipeEnabled) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base: revealed ? -reveal : 0, horizontal: null };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.horizontal == null) {
      if (Math.hypot(dx, dy) < 8) return;
      current.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!current.horizontal) {
        drag.current = null;
        return;
      }
      onReveal();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setShift(Math.min(0, Math.max(-reveal, current.base + dx)));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (!current.horizontal) return;
    swallowClick.current = true;
    const dx = event.clientX - current.x;
    const next = current.base + dx;
    if (next < -reveal / 2) {
      setShift(-reveal);
      onReveal();
    } else {
      setShift(0);
      onCloseReveal();
    }
  }

  return (
    <li className="swing-row">
      {swipeEnabled && (
        <button type="button" className="swing-delete" data-testid={`swipe-delete-${swing.id}`} onClick={onDelete}>
          Delete
        </button>
      )}
      <button
        type="button"
        className={cx('swing-card', selected && 'is-selected', dragging && 'is-dragging')}
        data-testid={`swing-${swing.id}`}
        aria-pressed={mark != null ? selected : undefined}
        style={{ transform: swipeEnabled ? `translateX(${shift}px)` : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          if (shift < -8) {
            setShift(0);
            onCloseReveal();
            return;
          }
          onOpen();
        }}
      >
        <Thumb swing={swing} />
        <span className="swing-copy">
          <span className="swing-title">{swing.club || 'Club not set'}</span>
          <span className="swing-meta">
            {formatDate(swing.date)} · {formatDuration(swing.duration)}
            {swing.drawings.length > 0 ? ` · ${swing.drawings.length} drawn` : ''}
          </span>
          {swing.notes ? <span className="swing-notes">{swing.notes}</span> : null}
        </span>
        <span className={cx('badge', swing.view)}>{viewLabel(swing.view, true)}</span>
        {mark != null && (
          <span className={cx('pick-mark', selected && 'on')} aria-hidden="true">
            {mark}
          </span>
        )}
      </button>
    </li>
  );
}

function Thumb({ swing }: { swing: SwingMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!swing.thumbnail) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(swing.thumbnail);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [swing.thumbnail]);
  if (!url) {
    return <span className="thumb thumb-fallback">{viewLabel(swing.view, true)}</span>;
  }
  return <img className="thumb" src={url} alt="" />;
}
