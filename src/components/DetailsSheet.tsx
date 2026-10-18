import { useState } from 'react';
import { CLUBS } from '../constants';
import { formatBytes, formatDuration } from '../format';
import type { SwingMeta, ViewAngle } from '../types';
import { Icon } from './Icons';
import { ViewPicker } from './ViewPicker';

export function DetailsSheet({
  swing,
  onClose,
  onSave,
}: {
  swing: SwingMeta;
  onClose: () => void;
  onSave: (patch: { view: ViewAngle; date: string; club: string; notes: string }) => Promise<void>;
}) {
  const [view, setView] = useState<ViewAngle>(swing.view);
  const [date, setDate] = useState(swing.date);
  const [club, setClub] = useState(swing.club);
  const [notes, setNotes] = useState(swing.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Swing details">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="titles">
          <h1>Details</h1>
          <p>
            {formatDuration(swing.duration)} · {formatBytes(swing.byteSize)} · {swing.fps} fps step
          </p>
        </div>
      </header>
      <form
        className="sheet-body swing-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          void onSave({
            view,
            date,
            club: club.trim(),
            notes: notes.trim(),
          })
            .then(onClose)
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : 'Could not save details.');
              setSaving(false);
            });
        }}
      >
        <ViewPicker value={view} onChange={setView} />
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <div className="field">
          <span>Club</span>
          <div className="club-row">
            {CLUBS.map((item) => (
              <button key={item} type="button" className="chip" aria-pressed={club === item} data-testid={`club-${item}`} onClick={() => setClub(item)}>
                {item}
              </button>
            ))}
          </div>
          <input value={club} onChange={(event) => setClub(event.target.value)} maxLength={40} />
        </div>
        <label className="field">
          <span>Notes</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={500} />
        </label>
        <p className="tip">Frame step size is the row of fps buttons under the scrubber.</p>
        {error && (
          <p className="banner" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={saving || !date}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
      </form>
    </div>
  );
}
