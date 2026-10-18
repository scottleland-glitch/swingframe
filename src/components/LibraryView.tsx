import { useEffect, useMemo, useState } from 'react';
import { listSwings } from '../db';
import { cx, formatBytes, formatDate, formatDuration, viewLabel } from '../format';
import { isIos, isStandalone, requestPersistentStorage, storageGet, storageSet, storageUsage } from '../platform';
import type { SwingMeta, ViewAngle } from '../types';
import { APP_VERSION } from '../version';
import { Icon } from './Icons';

type Filter = 'all' | ViewAngle;

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
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState(picking);
  const [picked, setPicked] = useState<string[]>(initialPicked);
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
    void storageUsage().then((bytes) => {
      if (!cancel) setUsage(bytes);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const counts = useMemo(
    () => ({
      all: swings.length,
      dtl: swings.filter((swing) => swing.view === 'dtl').length,
      face: swings.filter((swing) => swing.view === 'face').length,
    }),
    [swings],
  );
  const visible = swings.filter((swing) => filter === 'all' || swing.view === filter);
  const showInstall = isIos() && !isStandalone() && !hideInstall;

  function togglePick(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 2) return [current[1], id];
      return [...current, id];
    });
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
        {usage != null && <p className="usage">{formatBytes(usage)} on this phone</p>}
      </header>

      <div className="filters" role="tablist" aria-label="Filter swings">
        <FilterChip id="all" label="All" count={counts.all} current={filter} onSelect={setFilter} />
        <FilterChip id="dtl" label="Down the Line" count={counts.dtl} current={filter} onSelect={setFilter} />
        <FilterChip id="face" label="Face On" count={counts.face} current={filter} onSelect={setFilter} />
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
        {visible.length === 0 ? (
          <div className="empty">
            <span className="brand-mark big" aria-hidden="true">
              <Icon name="line" />
            </span>
            <h2>{swings.length === 0 ? 'No swings yet' : 'Nothing in this filter'}</h2>
            <p>
              {swings.length === 0
                ? 'Record on the range, or pull a slo-mo clip from your camera roll. Drawings stay on this phone.'
                : 'Try another camera angle, or add a swing from that view.'}
            </p>
          </div>
        ) : (
          <ul className="swing-list">
            {visible.map((swing) => {
              const selected = picked.includes(swing.id);
              return (
                <li key={swing.id}>
                  <button
                    type="button"
                    className={cx('swing-card', selected && 'is-selected')}
                    data-testid={`swing-${swing.id}`}
                    aria-pressed={pickMode ? selected : undefined}
                    onClick={() => {
                      if (pickMode) togglePick(swing.id);
                      else onOpen(swing.id);
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
                    {pickMode && (
                      <span className={cx('pick-mark', selected && 'on')} aria-hidden="true">
                        {selected ? picked.indexOf(swing.id) + 1 : ''}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="privacy">Videos stay on this phone. Nothing is uploaded.</p>
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
        ) : (
          <>
            <button
              type="button"
              className="btn"
              data-testid="compare-mode"
              disabled={swings.length < 2}
              onClick={() => setPickMode(true)}
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
    </div>
  );
}

function FilterChip({
  id,
  label,
  count,
  current,
  onSelect,
}: {
  id: Filter;
  label: string;
  count: number;
  current: Filter;
  onSelect: (id: Filter) => void;
}) {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={current === id}
      data-testid={`filter-${id}`}
      onClick={() => onSelect(id)}
    >
      {label}
      <span>{count}</span>
    </button>
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
