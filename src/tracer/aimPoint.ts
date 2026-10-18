import type { Pt } from '../types';

/** Pixels above the finger so the crosshair is not hidden by the touch. */
export const AIM_RETICLE_LIFT_PX = 72;

export interface FingerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The aim or ball point sits above the finger, clamped to the video.
 * `clientX` and `clientY` are where the crosshair is drawn.
 */
export function pointAboveFinger(
  fingerX: number,
  fingerY: number,
  rect: FingerRect,
  mirrored: boolean,
  lift = AIM_RETICLE_LIFT_PX,
): { clientX: number; clientY: number; point: Pt } {
  const clientX = Math.min(rect.right, Math.max(rect.left, fingerX));
  const clientY = Math.min(rect.bottom, Math.max(rect.top, fingerY - lift));
  const visualX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const visualY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return {
    clientX,
    clientY,
    point: {
      x: Math.min(1, Math.max(0, mirrored ? 1 - visualX : visualX)),
      y: Math.min(1, Math.max(0, visualY)),
    },
  };
}
