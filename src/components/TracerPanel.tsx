import { useRef, useState } from 'react';
import { formatTime } from '../format';
import type { ShotData, ShotField, TracerCalibration, ViewAngle } from '../types';
import { editShot, mergeScreen } from '../tracer/flight';
import { readShotScreenshot } from '../tracer/ocr';

const FIELDS: { key: ShotField; label: string; unit: string; step: string }[] = [
  { key: 'ballSpeed', label: 'Ball speed', unit: 'mph', step: '0.1' },
  { key: 'vla', label: 'Launch angle', unit: 'deg', step: '0.1' },
  { key: 'hla', label: 'Direction', unit: '+ right', step: '0.1' },
  { key: 'spin', label: 'Spin', unit: 'rpm', step: '1' },
  { key: 'spinAxis', label: 'Spin axis', unit: '+ fade', step: '0.1' },
  { key: 'sideSpin', label: 'Side spin', unit: 'rpm', step: '1' },
  { key: 'carry', label: 'Carry', unit: 'yd', step: '0.1' },
  { key: 'apex', label: 'Apex', unit: 'ft', step: '0.1' },
  { key: 'curve', label: 'Curve', unit: '+ right yd', step: '0.1' },
];

const SOURCE_LABEL = { screen: 'screenshot', typed: 'typed', model: 'calculated' } as const;

function feet(meters: number): number {
  return meters / 0.3048;
}

function yards(meters: number): number {
  return meters / 0.9144;
}

export function TracerPanel({
  view,
  shot,
  tracer,
  busy,
  note,
  onShot,
  onTracer,
  onDetect,
  onMarkImpact,
  onCalibrate,
  onBack,
}: {
  view: ViewAngle;
  shot: ShotData;
  tracer: TracerCalibration;
  busy: boolean;
  note: string | null;
  onShot: (shot: ShotData) => void;
  onTracer: (tracer: TracerCalibration) => void;
  onDetect: () => void;
  onMarkImpact: () => void;
  onCalibrate: (which: 'ball' | 'target') => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ field: ShotField; text: string } | null>(null);

  function shown(field: ShotField): string {
    const value = shot[field];
    return value == null ? '' : String(value);
  }

  return (
    <div className="panel-page" data-testid="tracer-panel">
      <h2>Tracer</h2>
      <p className="panel-hint">
        {view === 'face' ? 'Face On.' : 'Down the Line.'} Add a Foresight screenshot or type the numbers. Check them before you trust the line.
      </p>
      <input
        ref={fileRef}
        className="tracer-file"
        type="file"
        accept="image/*"
        aria-label="Foresight screenshot"
        data-testid="tracer-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setReading(true);
          setLocalNote(null);
          void readShotScreenshot(file)
            .then((parsed) => {
              const read = Object.values(parsed.sources).filter((source) => source === 'screen').length;
              if (read === 0) {
                setLocalNote('Could not find shot numbers in that picture. Type them in.');
                return;
              }
              onShot(mergeScreen(shot, parsed));
              setLocalNote('Check these numbers. Fix anything the screenshot got wrong.');
            })
            .catch(() => setLocalNote('Could not read that screenshot on this phone. Type the numbers instead.'))
            .finally(() => setReading(false));
        }}
      />
      <button
        type="button"
        className="btn primary"
        data-testid="tracer-screenshot"
        disabled={reading}
        onClick={() => fileRef.current?.click()}
      >
        {reading ? 'Reading screenshot…' : 'Foresight screenshot'}
      </button>
      {(localNote || note) && <p className="tracer-status">{localNote || note}</p>}
      <div className="tracer-grid">
        {FIELDS.map((field) => {
          const source = shot.sources[field.key];
          return (
            <label key={field.key} className="tracer-row">
              <span>
                {field.label}
                <em>
                  {field.unit}
                  {source ? ` · ${SOURCE_LABEL[source]}` : ''}
                </em>
              </span>
              <input
                type="number"
                inputMode="decimal"
                step={field.step}
                value={draft?.field === field.key ? draft.text : shown(field.key)}
                aria-label={field.label}
                data-testid={`tracer-${field.key}`}
                onBlur={() => setDraft(null)}
                onChange={(event) => {
                  const text = event.target.value;
                  setDraft({ field: field.key, text });
                  const trimmed = text.trim();
                  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
                    if (trimmed === '') onShot(editShot(shot, field.key, null));
                    return;
                  }
                  const value = Number(trimmed);
                  if (!Number.isFinite(value)) return;
                  onShot(editShot(shot, field.key, value));
                }}
              />
            </label>
          );
        })}
      </div>
      <p className="panel-hint">Blank direction and spin axis are treated as straight. Carry, apex, and curve are calculated when the screenshot does not show them.</p>
      <div className="panel-actions">
        <button type="button" className="btn" data-testid="tracer-ball" onClick={() => onCalibrate('ball')}>
          {tracer.ball ? 'Move ball' : 'Tap the ball'}
        </button>
        <button type="button" className="btn" data-testid="tracer-target" onClick={() => onCalibrate('target')}>
          {tracer.target ? 'Move target' : 'Tap target line'}
        </button>
      </div>
      <label className="tracer-slider">
        <span>Camera height {feet(tracer.cameraHeight).toFixed(1)} ft</span>
        <input
          type="range"
          min={2}
          max={10}
          step={0.5}
          value={feet(tracer.cameraHeight)}
          aria-label="Camera height"
          data-testid="tracer-height"
          onChange={(event) => onTracer({ ...tracer, cameraHeight: Number(event.target.value) * 0.3048 })}
        />
      </label>
      <label className="tracer-slider">
        <span>Camera distance {yards(tracer.cameraDistance).toFixed(1)} yd</span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.25}
          value={yards(tracer.cameraDistance)}
          aria-label="Camera distance"
          data-testid="tracer-distance"
          onChange={(event) => onTracer({ ...tracer, cameraDistance: Number(event.target.value) * 0.9144 })}
        />
      </label>
      <label className="tracer-slider">
        <span>Field of view {Math.round(tracer.fov)}°</span>
        <input
          type="range"
          min={30}
          max={85}
          step={1}
          value={tracer.fov}
          aria-label="Field of view"
          data-testid="tracer-fov"
          onChange={(event) => onTracer({ ...tracer, fov: Number(event.target.value) })}
        />
      </label>
      <p className="panel-hint" data-testid="tracer-impact">
        Impact {tracer.impactTime == null ? 'not marked' : formatTime(tracer.impactTime)}. The line grows from that frame.
      </p>
      <div className="panel-actions">
        <button type="button" className="btn" data-testid="tracer-detect" disabled={busy} onClick={onDetect}>
          {busy ? 'Finding impact…' : 'Detect impact'}
        </button>
        <button type="button" className="btn" data-testid="tracer-mark" onClick={onMarkImpact}>
          Mark impact
        </button>
      </div>
      <button type="button" className="text-btn" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
