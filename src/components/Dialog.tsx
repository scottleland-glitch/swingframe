import { useEffect, useRef } from 'react';

export function Dialog({
  title,
  body,
  confirmLabel,
  danger = false,
  alternateLabel,
  alternateDanger = false,
  onAlternate,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  alternateLabel?: string;
  alternateDanger?: boolean;
  onAlternate?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-root" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          {alternateLabel && onAlternate && (
            <button type="button" className={alternateDanger ? 'btn danger' : 'btn'} onClick={onAlternate}>
              {alternateLabel}
            </button>
          )}
          <button type="button" className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
