import type { Pt, ShotData, TracerCalibration } from '../types';
import type { ToeLine } from './aimSuggest';

export type SetupPhase =
  | 'aim'
  | 'ball'
  | 'horizon'
  | 'start'
  | 'apex'
  | 'finish'
  | 'impact'
  | 'lock'
  | 'edit';

const LAUNCH_FIELDS = ['ballSpeed', 'vla', 'spin', 'spinAxis', 'hla'] as const;

/** True when this swing already has launch numbers, so setting impact should not ask again. */
export function launchIsSet(shot: ShotData | null | undefined): boolean {
  if (!shot) return false;
  return LAUNCH_FIELDS.some((field) => shot[field] != null);
}

function aimConfirmed(tracer: TracerCalibration): boolean {
  return tracer.target != null && tracer.aimSuggested !== true;
}

/**
 * Where the tracer button should land. A finished setup opens the markers
 * for dragging. Anything missing resumes that step instead of starting over.
 * Lock is the last guided step, and only after this version has started that flow.
 */
export function setupStep(tracer: TracerCalibration): SetupPhase {
  if (tracer.mode === 'manual') {
    if (!tracer.manualStart) return 'start';
    if (!tracer.manualApex) return 'apex';
    if (!tracer.manualFinish) return 'finish';
    if (tracer.impactTime == null) return 'impact';
    if (tracer.setupDone !== true) return 'lock';
    return 'edit';
  }
  if (!aimConfirmed(tracer)) return 'aim';
  if (!tracer.ball) return 'ball';
  if (!tracer.ground) return 'horizon';
  if (tracer.impactTime == null) return 'impact';
  if (tracer.mode === 'data' && tracer.setupDone !== true) return 'lock';
  return 'edit';
}

/** A starting ball near the toes, or the lower middle of the frame. */
export function ballGuess(feet: ToeLine | null): Pt {
  if (!feet) return { x: 0.5, y: 0.72 };
  const x = (feet.leftToe.x + feet.rightToe.x) / 2;
  const y = (feet.leftToe.y + feet.rightToe.y) / 2 - 0.04;
  return {
    x: Math.min(0.92, Math.max(0.08, x)),
    y: Math.min(0.9, Math.max(0.45, y)),
  };
}
