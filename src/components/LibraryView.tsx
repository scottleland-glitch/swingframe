import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { clubGroup, type ClubFilter } from '../clubs';
import { deleteSwings, listSwings, storedUsage } from '../db';
import { DRIVE_ENABLED } from '../driveConfig';
import { cx, formatBytes, formatDate, formatDuration, viewLabel } from '../format';
import { isIos, isStandalone, requestPersistentStorage, storageGet, storageSet } from '../platform';
import type { SwingMeta, ViewAngle } from '../types';
import { APP_VERSION } from '../version';
import { Dialog } from './Dialog';
import { DriveSheet } from './DriveSheet';
import { Icon } from './Icons';

type ViewFilter = 'all' | ViewAngle;

const CLUB_FILTERS: { id: ClubFilter; label: string; name: string }[] = [
  { id: 'all', label: 'All', name: 'All clubs' },
  { id: 'driver', label: 'Driver', name: 'Driver' },
  { id: 'wood', label: 'Wood', name: 'Woods' },
  { id: 'iron', label: 'Iron', name: 'Iron' },
  { id: 'wedge', label: 'Wedge', name: 'Wedge' },
  { id: 'putter', label: 'Putt', name: 'Putter' },
];

type Group = Exclude<ClubFilter, 'all'>;
type Section = Group | 'all' | null;

const TILES: { id: Group; title: string; line: string }[] = [
  { id: 'driver', title: 'Driver', line: 'Off the tee' },
  { id: 'wood', title: 'Woods', line: 'Fairway woods and hybrids' },
  { id: 'iron', title: 'Irons', line: 'Mid and short irons' },
  { id: 'wedge', title: 'Wedges', line: 'Scoring clubs' },
  { id: 'putter', title: 'Putting', line: 'On the green' },
];

/** Remembers where History was left, so coming back from a swing lands in the same group. */
let lastSection: Section = null;

/** A newly saved swing sends History back to the carousel when the swing is closed. */
export function resetLibrarySection() {
  lastSection = null;
}

const VIEW_FILTERS: { id: ViewFilter; label: string; name: string }[] = [
  { id: 'all', label: 'All', name: 'All views' },
  { id: 'dtl', label: 'DTL', name: 'Down the Line' },
  { id: 'face', label: 'FO', name: 'Face On' },
];

export function LibraryView({
  onOpen,
  onAdd,
  onHome,
}: {
  onOpen: (id: string) => void;
  onAdd: () => void;
  onHome: () => void;
}) {
  const [swings, setSwings] = useState<SwingMeta[]>([]);
  const [section, setSectionState] = useState<Section>(lastSection);
  const [allClub, setAllClub] = useState<ClubFilter>('all');
  const [tileIndex, setTileIndex] = useState(0);
  const clubFilter: ClubFilter = section === 'all' || section == null ? allClub : section;
  const setClubFilter = setAllClub;
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const [usage, setUsage] = useState<number | null>(null);
  const [listed, setListed] = useState(false);
  const [hideInstall, setHideInstall] = useState(() => storageGet('swingframe.install.v1') === '1');

  useEffect(() => {
    let cancel = false;
    void listSwings()
      .then((rows) => {
        if (!cancel) {
          setSwings(rows);
          setListed(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : 'Could not read saved swings.');
      });
    void requestPersistentStorage();
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
  const swipeEnabled = !selecting;
  const grouped = section != null && section !== 'all';
  const tileSwings = useMemo(
    () =>
      TILES.map((tile) => {
        const rows = swings.filter((swing) => clubGroup(swing.club) === tile.id);
        return {
          ...tile,
          count: rows.length,
          dtl: rows.filter((swing) => swing.view === 'dtl').length,
          face: rows.filter((swing) => swing.view === 'face').length,
          cover: rows.find((swing) => swing.thumbnail)?.thumbnail ?? null,
        };
      }),
    [swings],
  );
  const activeFilters = (clubFilter === 'all' ? 0 : 1) + (viewFilter === 'all' ? 0 : 1);

  function setSection(next: Section) {
    lastSection = next;
    setSectionState(next);
    setViewFilter('all');
    setAllClub('all');
    setSelecting(false);
    setChosen([]);
    setRevealedId(null);
    setFilterOpen(false);
  }

  function goBack() {
    if (section != null) setSection(null);
    else onHome();
  }

  useEffect(() => {
    if (!filterOpen) return;
    function onPointer(event: PointerEvent) {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setFilterOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

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
        <button type="button" className="icon-btn" aria-label="Home" data-testid="library-home" onClick={goBack}>
          <Icon name="back" />
        </button>
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
        <div className="library-side">
          {usage != null && (
            <p className="usage" data-testid="storage-usage">
              {formatBytes(usage)} on this phone
            </p>
          )}
          {DRIVE_ENABLED && (
            <button type="button" className="text-btn" data-testid="drive-menu" onClick={() => setDriveOpen(true)}>
              Google Drive
            </button>
          )}
        </div>
      </header>

      {section == null ? (
        <div className="library-tools">
          <button type="button" className="text-btn" data-testid="open-all" onClick={() => setSection('all')}>
            All swings ({swings.length})
          </button>
        </div>
      ) : (
      <div className="library-tools">
        {grouped ? (
          <div className="view-toggle" role="group" aria-label="Camera angle">
            {VIEW_FILTERS.filter((item) => item.id !== 'all').map((item) => (
              <button
                key={item.id}
                type="button"
                className="view-btn"
                aria-pressed={viewFilter === item.id}
                aria-label={item.name}
                data-testid={`view-${item.id === 'face' ? 'fo' : item.id}`}
                onClick={() => setViewFilter(viewFilter === item.id ? 'all' : item.id)}
              >
                {item.label}
                <span>{clubFiltered.filter((swing) => swing.view === item.id).length}</span>
              </button>
            ))}
          </div>
        ) : (
        <div className="filter-wrap" ref={filterRef}>
          <button
            type="button"
            className={cx('filter-toggle', filterOpen && 'is-open')}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            data-testid="filter-menu"
            onClick={() => setFilterOpen((open) => !open)}
          >
            Filter
            {activeFilters > 0 && (
              <span className="filter-badge" data-testid="filter-badge">
                {activeFilters}
              </span>
            )}
          </button>
          {filterOpen && (
            <div className="filter-panel" role="dialog" aria-label="Filters">
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
              <button
                type="button"
                className="text-btn filter-clear"
                data-testid="filter-clear"
                disabled={activeFilters === 0}
                onClick={() => {
                  setClubFilter('all');
                  setViewFilter('all');
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
        )}
        <button
          type="button"
          className="text-btn"
          data-testid="select-mode"
          disabled={swings.length === 0 || selecting}
          onClick={() => {
            setSelecting(true);
            setChosen([]);
            setRevealedId(null);
            setFilterOpen(false);
          }}
        >
          Select
        </button>
      </div>
      )}

      {section == null ? (
        <Carousel
          tiles={tileSwings}
          loaded={listed || error != null}
          index={tileIndex}
          onIndex={setTileIndex}
          onPick={(id) => setSection(id)}
        />
      ) : (
      <div className="list-scroll">
        {grouped && (
          <h2 className="group-title" data-testid="group-title">
            {TILES.find((tile) => tile.id === section)?.title}
            <span>{visible.length} {visible.length === 1 ? 'swing' : 'swings'}</span>
          </h2>
        )}
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
        {error && <p className="banner">{error}</p>}
        {selecting && <p className="pick-hint">Tap the swings to delete, then Delete.</p>}
        {!listed && !error && swings.length === 0 ? (
          <div className="empty">
            <p>Loading your swings…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <span className="brand-mark big" aria-hidden="true">
              <Icon name="line" />
            </span>
            <h2>{swings.length === 0 ? 'No swings yet' : 'Nothing in this filter'}</h2>
            <p>
              {swings.length === 0
                ? 'Record on the range, or pull a slo-mo clip from your camera roll. Drawings stay on this phone.'
                : 'Try another club or camera angle, clear the filter, or add a swing.'}
            </p>
          </div>
        ) : (
          <ul className="swing-list">
            {visible.map((swing) => {
              const selected = chosen.includes(swing.id);
              return (
                <SwingRow
                  key={swing.id}
                  swing={swing}
                  selected={selecting && selected}
                  mark={selecting ? (selected ? '✓' : '') : null}
                  revealed={revealedId === swing.id}
                  swipeEnabled={swipeEnabled}
                  onReveal={() => setRevealedId(swing.id)}
                  onCloseReveal={() => setRevealedId((current) => (current === swing.id ? null : current))}
                  onOpen={() => {
                    if (selecting) toggleChosen(swing.id);
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
      )}

      {selecting && section != null ? (
        <div className="bottom-bar">
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
        </div>
      ) : (
        <button type="button" className="add-fab" data-testid="add-swing" aria-label="Add swing" onClick={onAdd}>
          <Icon name="plus" />
        </button>
      )}

      {driveOpen && DRIVE_ENABLED && (
        <DriveSheet
          swings={swings}
          onClose={() => setDriveOpen(false)}
          onChanged={async () => {
            const rows = await listSwings();
            setSwings(rows);
            refreshUsage();
          }}
        />
      )}
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

type TileInfo = {
  id: Group;
  title: string;
  line: string;
  count: number;
  dtl: number;
  face: number;
  cover: Blob | null;
};

function Carousel({
  tiles,
  loaded,
  index,
  onIndex,
  onPick,
}: {
  tiles: TileInfo[];
  loaded: boolean;
  index: number;
  onIndex: (index: number) => void;
  onPick: (id: Group) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  return (
    <div className="carousel-wrap">
      <div
        className="carousel"
        ref={track}
        data-testid="carousel"
        onScroll={(event) => {
          const el = event.currentTarget;
          const first = el.firstElementChild as HTMLElement | null;
          const step = first ? first.offsetWidth + 14 : 1;
          const next = Math.max(0, Math.min(tiles.length - 1, Math.round(el.scrollLeft / step)));
          if (next !== index) onIndex(next);
        }}
      >
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="tile"
            data-testid={`tile-${tile.id}`}
            onClick={() => onPick(tile.id)}
          >
            <span className="tile-head">
              <span className="tile-title">{tile.title}</span>
              <span className="tile-line">{tile.line}</span>
            </span>
            <span className="tile-photo">
              <TileCover blob={tile.cover} />
            </span>
            <span className="tile-foot">
              <span className="tile-count">
                {loaded ? `${tile.count} ${tile.count === 1 ? 'swing' : 'swings'}` : ' '}
              </span>
              {loaded && tile.count > 0 && (
                <span className="tile-views">
                  DTL {tile.dtl} · FO {tile.face}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="carousel-dots" aria-hidden="true">
        {tiles.map((tile, i) => (
          <span key={tile.id} className={cx('dot', i === index && 'on')} />
        ))}
      </div>
    </div>
  );
}

function TileCover({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <img className="tile-cover" src={url} alt="" /> : <span className="tile-cover tile-empty" />;
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
          <span className="swing-title">
            {swing.club || 'Club not set'}
            {swing.draft ? ' · Not kept' : ''}
          </span>
          <span className="swing-meta">
            {formatDate(swing.date)} · {formatDuration(swing.duration)}
            {swing.drawings.length > 0 ? ` · ${swing.drawings.length} drawn` : ''}
          </span>
          {swing.notes ? <span className="swing-notes">{swing.notes}</span> : null}
        </span>
        <span className="card-badges">
          <span className={cx('badge', swing.view)}>{viewLabel(swing.view, true)}</span>
          {swing.drive?.videoId && (
            <span className="drive-badge" data-testid="drive-badge">
              {swing.videoKept === false ? 'Drive only' : 'Drive'}
            </span>
          )}
        </span>
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
