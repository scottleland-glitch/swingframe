import type { RefObject } from 'react';
import { DRAW_COLORS } from '../constants';
import type { Tool } from '../types';
import { Icon, type IconName } from './Icons';

const TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: 'select', label: 'Move', icon: 'select' },
  { id: 'line', label: 'Line', icon: 'line' },
  { id: 'pen', label: 'Draw', icon: 'pen' },
  { id: 'angle', label: 'Angle', icon: 'angle' },
  { id: 'circle', label: 'Circle', icon: 'circle' },
  { id: 'box', label: 'Box', icon: 'box' },
  { id: 'hline', label: 'Level', icon: 'hline' },
  { id: 'vline', label: 'Plumb', icon: 'vline' },
  { id: 'erase', label: 'Erase', icon: 'erase' },
];

export function DrawToolbar({
  tool,
  color,
  hint,
  canUndo,
  hasSelection,
  canClear,
  onTool,
  onColor,
  onUndo,
  onDelete,
  onClear,
  zoom,
}: {
  tool: Tool;
  color: string;
  hint?: string;
  canUndo: boolean;
  hasSelection: boolean;
  canClear: boolean;
  onTool: (tool: Tool) => void;
  onColor: (color: string) => void;
  onUndo: () => void;
  onDelete: () => void;
  onClear: () => void;
  zoom?: {
    labelRef: RefObject<HTMLSpanElement | null>;
    onZoomOut: () => void;
    onZoomIn: () => void;
    onFit: () => void;
  };
}) {
  return (
    <div className="draw-tools">
      <div className="tool-scroll">
        <div className="colors" role="group" aria-label="Drawing color">
          {DRAW_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className="swatch"
              style={{ background: swatch }}
              aria-label={`Color ${swatch}`}
              aria-pressed={color === swatch}
              data-testid={`color-${swatch.slice(1)}`}
              onClick={() => onColor(swatch)}
            />
          ))}
        </div>
        <div className="tools" role="toolbar" aria-label="Drawing tools">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="icon-btn tool-btn"
              aria-label={item.label}
              title={item.label}
              aria-pressed={tool === item.id}
              data-testid={`tool-${item.id}`}
              onClick={() => onTool(item.id)}
            >
              <Icon name={item.icon} />
            </button>
          ))}
        </div>
      </div>
      {hint ? <p className="hint">{hint}</p> : null}
      <div className="edit-row">
        <div className="edit-group">
          <button type="button" className="icon-btn" aria-label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete selected drawing"
            disabled={!hasSelection}
            onClick={onDelete}
          >
            <Icon name="trash" />
          </button>
          <button type="button" className="text-btn" disabled={!canClear} onClick={onClear}>
            Clear
          </button>
        </div>
        {zoom ? (
          <div className="edit-group">
            <button type="button" className="icon-btn" aria-label="Zoom out" onClick={zoom.onZoomOut}>
              <Icon name="zoomOut" />
            </button>
            <span className="zoom-label" ref={zoom.labelRef}>
              100%
            </span>
            <button type="button" className="icon-btn" aria-label="Zoom in" onClick={zoom.onZoomIn}>
              <Icon name="zoomIn" />
            </button>
            <button type="button" className="text-btn" aria-label="Fit video" onClick={zoom.onFit}>
              Fit
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
