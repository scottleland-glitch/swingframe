export type Pt = { x: number; y: number };

export type ShotField =
  | 'ballSpeed'
  | 'vla'
  | 'hla'
  | 'spin'
  | 'spinAxis'
  | 'sideSpin'
  | 'clubPath'
  | 'faceToTarget'
  | 'faceToPath'
  | 'carry'
  | 'apex'
  | 'curve';

/** Where a shot number came from. Measured values are kept; the model only fills blanks. */
export type ShotSource = 'screen' | 'typed' | 'model';

/**
 * Launch-monitor numbers in US units.
 * Direction fields are negative to the left and positive to the right.
 * Launch direction (HLA) is the ball's start line. It is not club path.
 * Spin axis 0 is pure backspin.
 */
export interface ShotData {
  ballSpeed: number | null;
  /** Vertical launch angle, degrees. */
  vla: number | null;
  /** Horizontal launch angle, degrees. Negative left, positive right. */
  hla: number | null;
  /** Total spin, rpm. */
  spin: number | null;
  /** Spin axis, degrees. Negative draw, positive fade. */
  spinAxis: number | null;
  /** Side spin, rpm. Negative left, positive right. */
  sideSpin: number | null;
  /** Club path, degrees. Negative left, positive right. */
  clubPath: number | null;
  /** Face angle relative to the target, degrees. Negative left, positive right. */
  faceToTarget: number | null;
  /** Face angle relative to the path, degrees. Negative closed, positive open. */
  faceToPath: number | null;
  /** Carry, yards. */
  carry: number | null;
  /** Apex, feet. */
  apex: number | null;
  /** Lateral curve at landing, yards. Negative left, positive right. */
  curve: number | null;
  sources: Partial<Record<ShotField, ShotSource>>;
}

/** Data uses launch numbers. Manual is a curve through three taps. Older swings are data. */
export type TracerMode = 'data' | 'manual';

/** Right-handed down-the-line: a draw bows right and finishes left of that bow. */
export type ShotShape = 'draw' | 'straight' | 'fade';

/** Camera and timing used to draw the tracer on this swing. */
export interface TracerCalibration {
  ball: Pt | null;
  /** A point on the aim line, in video coordinates. Direction of the intended line only, not the landing. */
  target: Pt | null;
  /**
   * True while Down the Line is still offering that aim point.
   * A check, a drag, or a tap accepts it. Older swings leave this off.
   */
  aimSuggested?: boolean;
  /** A spot on the ground near where the ball lands, in video coordinates. Sets the landing height, not the sideways finish. */
  ground?: Pt | null;
  /** Impact, in seconds of the video. Null until it is detected or marked. */
  impactTime: number | null;
  /** Tripod height, meters. */
  cameraHeight: number;
  /** Distance from the ball to the camera, meters. Behind the ball down the line, or to the side when face on. */
  cameraDistance: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** When set, ball, aim, landing ground, impact, numbers, and camera sliders do not change. */
  locked?: boolean;
  /** Ball, aim point, and aim line. Off unless this swing saved them on. */
  showAim?: boolean;
  /** Flight line. Missing or true shows it, so an older swing keeps its tracer. */
  showTracer?: boolean;
  /** Which tracer this swing uses. Missing means the launch-number tracer. */
  mode?: TracerMode;
  /** Draw, straight, or fade. Prefills the manual curve and breaks a tie when the taps are in a line. */
  shape?: ShotShape | null;
  /** Manual trace, in video coordinates. The curve passes through these three. */
  manualStart?: Pt | null;
  manualApex?: Pt | null;
  manualFinish?: Pt | null;
  /** True after Lock in guided setup. Older swings leave this off and are not sent back through that step. */
  setupDone?: boolean;
}

export type ViewAngle = 'dtl' | 'face';

export type Tool =
  | 'select'
  | 'line'
  | 'pen'
  | 'angle'
  | 'circle'
  | 'box'
  | 'hline'
  | 'vline'
  | 'erase';

export type Drawing =
  | { id: string; type: 'line'; color: string; a: Pt; b: Pt }
  | { id: string; type: 'pen'; color: string; points: Pt[] }
  | { id: string; type: 'angle'; color: string; a: Pt; v: Pt; b: Pt }
  | { id: string; type: 'circle'; color: string; c: Pt; r: number }
  | { id: string; type: 'box'; color: string; x: number; y: number; w: number; h: number; rot?: number }
  | { id: string; type: 'hline'; color: string; y: number }
  | { id: string; type: 'vline'; color: string; x: number };

/** Files this app created in the user's Google Drive. */
export interface DriveLink {
  folderId: string;
  videoId: string;
  thumbId: string | null;
  metaId: string;
  backedUpAt: number;
}

export interface SwingMeta {
  id: string;
  view: ViewAngle;
  /** User-facing day, YYYY-MM-DD in local time. */
  date: string;
  club: string;
  notes: string;
  createdAt: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  /** Assumed frames per second, used only for frame-step size. */
  fps: number;
  /** How many times slower than real life the clip plays. Missing: 1, or fps over 30 for a 120 or 240 fps clip. */
  slowMo?: number | null;
  /** Playback window, in seconds. Missing means the whole clip. */
  trimIn?: number | null;
  trimOut?: number | null;
  /** Mirror the picture. Drawings stay in the video's own coordinates. */
  mirrored?: boolean;
  mimeType: string;
  fileName: string;
  byteSize: number;
  thumbnail: Blob | null;
  drawings: Drawing[];
  /** Set after a successful backup. Absent means it has never been backed up. */
  drive?: DriveLink | null;
  /** False after Free up space removes the local video. Absent means the video should still be here. */
  videoKept?: boolean;
  /** True until the user taps Keep. A draft is a new swing still being annotated. */
  draft?: boolean;
  /** Launch-monitor numbers for the shot tracer. */
  shot?: ShotData | null;
  /** Ball, target, impact, and camera nudge for the tracer. */
  tracer?: TracerCalibration | null;
}

export type Route = { name: 'welcome' } | { name: 'library' } | { name: 'player'; id: string };
