/**
 * Seconds of the tracer to draw.
 * Before impact this is 0, so nothing is drawn. After the ball lands it stays at the flight time.
 * `extra` is video-time added once the clip has ended, already scaled by playback speed.
 */
export function tracerPlayhead(videoTime: number, impact: number | null, flightTime: number, extra = 0): number {
  if (impact == null || !(flightTime > 0)) return 0;
  const elapsed = videoTime - impact + Math.max(0, extra);
  if (!(elapsed > 0)) return 0;
  return Math.min(flightTime, elapsed);
}
