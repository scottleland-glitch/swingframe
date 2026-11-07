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
  | 'flight1'
  | 'flight2'
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
 * True for a swing set up with an aim point, before the ball was marked in flight.
 * Those keep the aim line and their old steps. Every new setup marks the ball instead.
 */
export function usesAimLine(tracer: TracerCalibration): boolean {
  if (tracer.mode === 'manual') return false;
  if (tracer.flightMarks && tracer.flightMarks.length > 0) return false;
  return aimConfirmed(tracer);
}

/** Which flight mark a step places: 0 for the 2nd ball position, 1 for the 3rd. */
export function flightMarkIndex(phase: SetupPhase | null): number | null {
  if (phase === 'flight1') return 0;
  if (phase === 'flight2') return 1;
  return null;
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
  if (usesAimLine(tracer)) {
    if (!tracer.ball) return 'ball';
    if (!tracer.ground) return 'horizon';
    if (tracer.impactTime == null) return 'impact';
    if (tracer.mode === 'data' && tracer.setupDone !== true) return 'lock';
    return 'edit';
  }
  if (!tracer.ball) return 'ball';
  if (!tracer.ground) return 'horizon';
  if (tracer.impactTime == null) return 'impact';
  const marks = tracer.flightMarks?.length ?? 0;
  if (marks < 1) return 'flight1';
  if (marks < 2) return 'flight2';
  if (tracer.setupDone !== true) return 'lock';
  return 'edit';
}

/**
 * Guided setup draws one circle: the point for this step.
 * Impact, Lock, and a finished edit draw none. Back returns to the previous step, which shows that circle again.
 */
export function showsPlacementReticle(phase: SetupPhase): boolean {
  return (
    phase === 'aim' ||
    phase === 'ball' ||
    phase === 'horizon' ||
    phase === 'flight1' ||
    phase === 'flight2' ||
    phase === 'start' ||
    phase === 'apex' ||
    phase === 'finish'
  );
}

/**
 * The step before this one. Ball is the first step. A swing still on the aim line starts at aim instead.
 * `aimLine` is usesAimLine for this swing.
 */
export function previousStep(phase: SetupPhase, mode: TracerCalibration['mode'], aimLine = false): SetupPhase | null {
  switch (phase) {
    case 'ball':
      return aimLine ? 'aim' : null;
    case 'horizon':
      return 'ball';
    case 'start':
      return 'ball';
    case 'apex':
      return 'start';
    case 'finish':
      return 'apex';
    case 'impact':
      return mode === 'manual' ? 'finish' : 'horizon';
    case 'flight1':
      return 'impact';
    case 'flight2':
      return 'flight1';
    case 'lock':
      return mode === 'manual' || aimLine ? 'impact' : 'flight2';
    case 'edit':
      return mode === 'manual' ? 'finish' : aimLine ? 'horizon' : 'flight2';
    default:
      return null;
  }
}

/** Clears the placed tracer points so guided setup can begin again at the ball. Launch numbers stay. */
export function resetSetup(tracer: TracerCalibration): TracerCalibration {
  return {
    ...tracer,
    ball: null,
    target: null,
    aimSuggested: false,
    flightMarks: null,
    ground: null,
    manualStart: null,
    manualApex: null,
    manualFinish: null,
    shape: null,
    mode: undefined,
    impactTime: null,
    setupDone: false,
    locked: false,
  };
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
