import { useRef, useState } from 'react';

export function Scrubber({
  value,
  max,
  onScrub,
  testId = 'scrubber',
}: {
  value: number;
  max: number;
  onScrub: (time: number) => void;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? value;
  const pct = max > 0 ? Math.min(1, Math.max(0, shown / max)) : 0;

  function timeFrom(clientX: number) {
    const el = ref.current;
    if (!el || !(max > 0)) return 0;
    const rect = el.getBoundingClientRect();
    const pad = 10;
    const span = Math.max(1, rect.width - pad * 2);
    const t = (clientX - rect.left - pad) / span;
    return Math.min(max, Math.max(0, t * max));
  }

  return (
    <div
      ref={ref}
      className="scrubber"
      data-testid={testId}
      role="slider"
      aria-label="Scrub video"
      aria-valuemin={0}
      aria-valuemax={Math.round((max || 0) * 1000) / 1000}
      aria-valuenow={Math.round(shown * 1000) / 1000}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        const time = timeFrom(event.clientX);
        setDragValue(time);
        onScrub(time);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        const time = timeFrom(event.clientX);
        setDragValue(time);
        onScrub(time);
      }}
      onPointerUp={() => {
        dragging.current = false;
        setDragValue(null);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setDragValue(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onScrub(Math.min(max, shown + (max > 0 ? max / 40 : 0.05)));
        if (event.key === 'ArrowLeft') onScrub(Math.max(0, shown - (max > 0 ? max / 40 : 0.05)));
      }}
    >
      <div className="scrubber-track">
        <div className="scrubber-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="scrubber-thumb" style={{ left: `calc(10px + (100% - 20px) * ${pct})` }} />
    </div>
  );
}
