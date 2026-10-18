export type Pt = { x: number; y: number };

export type ViewAngle = 'dtl' | 'face';

export type Tool =
  | 'select'
  | 'line'
  | 'pen'
  | 'angle'
  | 'circle'
  | 'box'
  | 'hline'
  | 'vline';

export type Drawing =
  | { id: string; type: 'line'; color: string; a: Pt; b: Pt }
  | { id: string; type: 'pen'; color: string; points: Pt[] }
  | { id: string; type: 'angle'; color: string; a: Pt; v: Pt; b: Pt }
  | { id: string; type: 'circle'; color: string; c: Pt; r: number }
  | { id: string; type: 'box'; color: string; x: number; y: number; w: number; h: number }
  | { id: string; type: 'hline'; color: string; y: number }
  | { id: string; type: 'vline'; color: string; x: number };

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
  mimeType: string;
  fileName: string;
  byteSize: number;
  thumbnail: Blob | null;
  drawings: Drawing[];
}

export type Route =
  | { name: 'library'; picking?: boolean; picked?: string[] }
  | { name: 'player'; id: string }
  | { name: 'compare'; a: string; b: string };
