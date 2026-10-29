import { useMemo, useRef, useState } from 'react';
import { formatTime } from '../format';
import type { ShotData, ShotField, TracerCalibration, ViewAngle } from '../types';
import { editShot, mergeScreen, simulateShot } from '../tracer/flight';
import { readShotScreenshot } from '../tracer/ocr';
import { withSide } from '../tracer/sign';

const FIELDS: { key: ShotField; label: string; unit: string; step: string; signed?: boolean }[] = [
  { key: 'ballSpeed', label: 'Ball speed', unit: 'mph', step: '0.1' },
  { key: 'vla', label: 'Launch angle', unit: '°', step: '0.1' },
  { key: 'spin', label: 'Total spin', unit: 'rpm', step: '1' },
  { key: 'spinAxis', label: 'Spin axis', unit: '°', step: '0.1', signed: true },
  { key: 'hla', label: 'Launch Direction (HLA)', unit: '°', step: '0.1', signed: true },
  { key: 'clubPath', label: 'Club path', unit: '°', step: '0.1', signed: true },
  { key: 'faceToTarget', label: 'Face angle', unit: '°', step: '0.1', signed: true },
];

const SOURCE_LABEL = { screen: 'screenshot', typed: 'typed', model: 'calculated' } as const;

function feet(meters: number): number {
  return meters / 0.3048;
}

function yards(meters: number): number {
  return meters / 0.9144;
}

function flightSummary(carryYd: number, apexFt: number, curveYd: number): string {
  const side = curveYd < -0.05 ? ' L' : curveYd > 0.05 ? ' R' : '';
  return `Carry ${carryYd.toFixed(0)} yds · Apex ${apexFt.toFixed(0)} ft · Curve ${Math.abs(curveYd).toFixed(1)}${side} yds`;
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
  onClear,
  canClear,
  exporting,
  onExport,
  onBack,
  numbersOnly,
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
  onClear: () => void;
  canClear: boolean;
  exporting: boolean;
  onExport: () => void;
  onBack: () => void;
  /** Five launch inputs and the screenshot reader. Nothing else. */
  numbersOnly?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ field: ShotField; text: string } | null>(null);
  const [pendingSide, setPendingSide] = useState<Partial<Record<ShotField, -1 | 1>>>({});
  const flight = useMemo(() => simulateShot(shot), [shot]);
  const locked = tracer.locked === true;
  const showAim = tracer.showAim === true;
  const showTracer = tracer.showTracer !== false;

  function sideFor(field: ShotField): -1 | 1 | 0 {
    const value = shot[field];
    if (typeof value === 'number' && value < 0) return -1;
    if (typeof value === 'number' && value > 0) return 1;
    return pendingSide[field] ?? 0;
  }

  function shown(field: ShotField, signed: boolean): string {
    const value = shot[field];
    if (value == null) return '';
    return signed ? String(Math.abs(value)) : String(value);
  }

  function commitSigned(field: ShotField, text: string, side: -1 | 1 | 0) {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed === '.') {
      if (trimmed === '') onShot(editShot(shot, field, null));
      return;
    }
    const magnitude = Number(trimmed);
    if (!Number.isFinite(magnitude)) return;
    onShot(editShot(shot, field, side < 0 ? withSide(magnitude, -1) : withSide(magnitude, 1)));
  }

  return (
    <div className="panel-page" data-testid={numbersOnly ? 'numbers-sheet' : 'tracer-panel'}>
      <h2>{numbersOnly ? 'Launch' : 'Tracer'}</h2>
      {!numbersOnly && (
        <p className="panel-hint">
          {view === 'face' ? 'Face On.' : 'Down the Line.'} Place the aim, ball, and horizon with the tracer button, or Manual trace for a drawn flight. Lock is the last setup step. Launch numbers are the 123 button.
        </p>
      )}
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
      {numbersOnly && (
      <button
        type="button"
        className="btn primary"
        data-testid="tracer-screenshot"
        disabled={reading}
        onClick={() => fileRef.current?.click()}
      >
        {reading ? 'Reading screenshot…' : 'Foresight screenshot'}
      </button>
      )}
      {(localNote || note) && <p className="tracer-status">{localNote || note}</p>}
      {numbersOnly && (
      <fieldset className="tracer-lock">
      <div className="tracer-grid">
        {FIELDS.map((field) => {
          const source = shot.sources[field.key];
          const signed = Boolean(field.signed);
          const side = sideFor(field.key);
          return (
            <div key={field.key} className="tracer-row">
              <span>
                {field.label}
                <em>
                  {field.unit}
                  {source ? ` · ${SOURCE_LABEL[source]}` : ''}
                </em>
              </span>
              {signed ? (
                <span className="tracer-signed">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft?.field === field.key ? draft.text : shown(field.key, true)}
                    aria-label={field.label}
                    data-testid={`tracer-${field.key}`}
                    onBlur={() => setDraft(null)}
                    onChange={(event) => {
                      const raw = event.target.value.trim();
                      const typedLeft = raw.startsWith('-');
                      const text = raw.replace(/[^0-9.]/g, '');
                      const nextSide = typedLeft ? -1 : side;
                      if (typedLeft) setPendingSide((prev) => ({ ...prev, [field.key]: -1 }));
                      setDraft({ field: field.key, text });
                      commitSigned(field.key, text, nextSide);
                    }}
                  />
                  <span className="tracer-sign">
                    <button
                      type="button"
                      aria-label={`${field.label} left`}
                      aria-pressed={side === -1}
                      data-testid={`tracer-${field.key}-l`}
                      onClick={() => {
                        setPendingSide((prev) => ({ ...prev, [field.key]: -1 }));
                        const value = shot[field.key];
                        if (typeof value === 'number') onShot(editShot(shot, field.key, withSide(value, -1)));
                      }}
                    >
                      L
                    </button>
                    <button
                      type="button"
                      aria-label={`${field.label} right`}
                      aria-pressed={side === 1}
                      data-testid={`tracer-${field.key}-r`}
                      onClick={() => {
                        setPendingSide((prev) => ({ ...prev, [field.key]: 1 }));
                        const value = shot[field.key];
                        if (typeof value === 'number') onShot(editShot(shot, field.key, withSide(value, 1)));
                      }}
                    >
                      R
                    </button>
                  </span>
                </span>
              ) : (
                <input
                  type="number"
                  inputMode="decimal"
                  step={field.step}
                  value={draft?.field === field.key ? draft.text : shown(field.key, false)}
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
              )}
            </div>
          );
        })}
      </div>
      {flight && (
        <p className="tracer-results" data-testid="tracer-results">
          {flightSummary(flight.carryYd, flight.apexFt, flight.curveYd)}
        </p>
      )}
      <p className="panel-hint">
        L and R are degrees left or right of the aim line. Launch Direction (HLA) is the start line. Enter club path and face angle (center strike) and the start line and spin axis are worked out for you, unless you type them. Spin axis curves the ball off that line, and the aim point is not the landing.
      </p>
      </fieldset>
      )}
      {numbersOnly && (
        <button type="button" className="btn primary" data-testid="numbers-done" onClick={onBack}>
          Done
        </button>
      )}
      {!numbersOnly && (
      <>
      <div className="panel-actions">
        <button
          type="button"
          className="btn"
          data-testid="tracer-show-aim"
          aria-pressed={showAim}
          onClick={() => onTracer({ ...tracer, showAim: !showAim })}
        >
          {showAim ? 'Hide aim point' : 'Show aim point'}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="tracer-show-line"
          aria-pressed={showTracer}
          onClick={() => onTracer({ ...tracer, showTracer: !showTracer })}
        >
          {showTracer ? 'Hide tracer' : 'Show tracer'}
        </button>
        <button
          type="button"
          className="btn"
          data-testid="tracer-lock"
          aria-pressed={locked}
          onClick={() => onTracer({ ...tracer, locked: !locked })}
        >
          {locked ? 'Unlock' : 'Lock'}
        </button>
      </div>
      <p className="panel-hint">
        {locked
          ? 'Locked. The ball, aim, landing ground, impact, and camera sliders stay put until you unlock. Launch numbers stay editable.'
          : 'Lock freezes the ball, aim, landing ground, and impact. Launch numbers stay editable.'}{' '}
        Show aim point draws the ball, the aim point, the landing ground, and the white aim line. Show tracer is the flight line. The same switches sit on the picture, including in full screen, and they are saved with this swing.
      </p>
      </>
      )}
      {!numbersOnly && (
      <fieldset className="tracer-lock" disabled={locked}>
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
        Impact {tracer.impactTime == null ? 'not set' : formatTime(tracer.impactTime)}. Flight{' '}
        {flight ? `${flight.flightTime.toFixed(1)}s` : '—'} until the ball is on the ground. Pause on the hit and tap Set impact time, here or on the bar above play. The line grows with playback, including slow motion, and stays up after it lands. If the clip ends first, it keeps going on the last frame.
      </p>
      <div className="panel-actions">
        <button type="button" className="btn primary" data-testid="tracer-mark" onClick={onMarkImpact}>
          Set impact time
        </button>
        <button type="button" className="btn" data-testid="tracer-detect" disabled={busy} onClick={onDetect}>
          {busy ? 'Finding impact…' : 'Detect from sound'}
        </button>
      </div>
      </fieldset>
      )}
      {!numbersOnly && (
      <>
      <button type="button" className="btn" data-testid="tracer-export" disabled={exporting} onClick={onExport}>
        {exporting ? 'Exporting…' : 'Export video'}
      </button>
      <p className="panel-hint">
        Export plays the clip at real speed and burns in the tracer, plus drawings if they are on screen. If the clip ends before the ball lands, the last frame holds until it does. The file stays on this phone.
      </p>
      <button type="button" className="btn danger" data-testid="tracer-clear" disabled={!canClear || locked} onClick={onClear}>
        Clear tracer
      </button>
      <button type="button" className="text-btn" onClick={onBack}>
        Back
      </button>
      </>
      )}
    </div>
  );
}
