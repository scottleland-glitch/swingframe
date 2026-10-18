import type { ShotData, ShotField, TracerCalibration } from '../types';
import { defaultTracer } from './project';

const SHOT_FIELDS: ShotField[] = [
  'ballSpeed',
  'vla',
  'hla',
  'spin',
  'spinAxis',
  'sideSpin',
  'clubPath',
  'faceToTarget',
  'faceToPath',
  'carry',
  'apex',
  'curve',
];

/** True when this swing has tracer numbers or calibration worth drawing or clearing. */
export function tracerIsSet(shot: ShotData | null | undefined, tracer: TracerCalibration | null | undefined): boolean {
  if (tracer?.ball || tracer?.target || tracer?.ground || tracer?.impactTime != null) return true;
  if (tracer) {
    const base = defaultTracer();
    if (tracer.cameraHeight !== base.cameraHeight || tracer.cameraDistance !== base.cameraDistance || tracer.fov !== base.fov) {
      return true;
    }
  }
  if (!shot) return false;
  return SHOT_FIELDS.some((field) => shot[field] != null);
}

export type UndoChoice = 'draft' | 'tracer' | 'drawing' | 'none';

/** Latest action wins: an open drawing stroke, then a tracer clear, then older drawings. */
export function chooseUndo(state: {
  hasDraft: boolean;
  hasTracerUndo: boolean;
  tracerStamp: number;
  drawingStamp: number;
  drawingSteps: number;
}): UndoChoice {
  if (state.hasDraft) return 'draft';
  if (state.hasTracerUndo && state.tracerStamp > state.drawingStamp) return 'tracer';
  if (state.drawingSteps > 0) return 'drawing';
  if (state.hasTracerUndo) return 'tracer';
  return 'none';
}
