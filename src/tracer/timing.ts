const END_SLOP = 0.05;
/** Only float error. A real slice of the descent, even a fiftieth of a second, is not "landed" yet. */
const LAND_SLOP = 0.001;

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

/** 0 before impact, 1 when the drawn line has reached the ground landing. */
export function tracerProgress(elapsed: number, flightTime: number): number {
  if (!(flightTime > 0) || !(elapsed > 0)) return 0;
  return Math.max(0, Math.min(1, elapsed / flightTime));
}

/** End of the picture. A trim out, when it is after the trim in, replaces the file duration. */
export function clipEndTime(duration: number, trimIn: number | null | undefined, trimOut: number | null | undefined): number {
  const start = trimIn != null && trimIn > 0 ? trimIn : 0;
  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (trimOut != null && trimOut > start) return trimOut;
  return dur;
}

/** How long the last frame has to stay up so the ball can land. Zero when the flight fits in the clip. */
export function holdSpan(clipEnd: number, impact: number | null, flightTime: number): number {
  if (impact == null || !(flightTime > 0)) return 0;
  return Math.max(0, impact + flightTime - Math.max(0, clipEnd));
}

export interface PlayClock {
  /** Time on the pill and the tracer. After the picture ends this is the clip end plus the hold. */
  playbackTime: number;
  /** Hold seconds that count. A hold stored before the picture ended is dropped. */
  hold: number;
  /** The playhead is on the last frame of the clip or the trim. */
  pictureDone: boolean;
  /** The picture is done and the ball has not landed yet. */
  holding: boolean;
  /** The picture is done and the flight is included. */
  landed: boolean;
}

/**
 * One clock for the pill, the tracer, and the post-clip hold.
 * Time past the clip end is ignored, so a video clock that keeps running cannot skip the hold or finish the flight early.
 */
export function playClock(input: {
  videoTime: number;
  clipEnd: number;
  impact: number | null;
  flightTime: number;
  hold: number;
}): PlayClock {
  const end = Math.max(0, input.clipEnd);
  const videoTime = Number.isFinite(input.videoTime) ? input.videoTime : 0;
  const pictureDone = end > 0 && videoTime >= end - END_SLOP;
  const hasFlight = input.impact != null && input.flightTime > 0;
  const land = hasFlight ? (input.impact as number) + input.flightTime : end;
  const cap = hasFlight ? Math.max(0, land - end) : 0;
  const hold = pictureDone ? Math.min(cap, Math.max(0, input.hold)) : 0;
  // A finished hold is the landing time itself, so the last drawn point is the ground sample.
  const playbackTime = pictureDone && hasFlight && hold >= cap - 1e-6 ? land : (pictureDone ? end : videoTime) + hold;
  const remaining = land - playbackTime;
  const holding = pictureDone && hasFlight && remaining > LAND_SLOP;
  const landed = pictureDone && hasFlight && remaining <= LAND_SLOP;
  return { playbackTime, hold, pictureDone, holding, landed };
}

/** Advance the post-clip hold by one frame, scaled by playback speed, and never past the landing. */
export function nextHold(
  hold: number,
  dt: number,
  rate: number,
  clipEnd: number,
  impact: number | null,
  flightTime: number,
): number {
  const cap = holdSpan(clipEnd, impact, flightTime);
  const step = dt > 0 && rate > 0 ? dt * rate : 0;
  return Math.min(cap, Math.max(0, hold) + step);
}
