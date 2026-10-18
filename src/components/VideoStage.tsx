import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ZOOM_MAX, ZOOM_MIN } from '../constants';
import { paint } from '../draw';
import { pointAboveFinger } from '../tracer/aimPoint';
import { paintTracer, type TracerMarks } from '../tracer/paintTracer';
import { Icon } from './Icons';
import type { TracerPoint } from '../tracer/project';
import { uid } from '../format';
import { exitIfNativeFullscreen, loadInlineSource, markInline, mediaErrorMessage, paintFirstFrame } from '../inlineVideo';
import { blobWithMime, mimeAttempts } from '../videoFile';
import {
  angleFromFingers,
  applyHandle,
  boxFromFingers,
  circleFromFingers,
  clamp,
  clampPt,
  hitTest,
  lineFromFingers,
  pxDist,
  transformDrawing,
  translateDrawing,
  type HandleName,
} from '../geometry';
import type { Drawing, Pt, Tool } from '../types';

export type VideoEngine = {
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  step: (dir: number) => void;
  setRate: (rate: number) => void;
  getTime: () => number;
  getDuration: () => number;
  getPaused: () => boolean;
  /** True when playback has stopped at the end of the clip or the trim. */
  getEnded: () => boolean;
  /** The frame on screen, scaled down. Used for aim detection without seeking. */
  captureFrame: () => HTMLCanvasElement | null;
  undoDraft: () => boolean;
  hasDraft: () => boolean;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  getZoom: () => number;
};

type Zoom = { scale: number; x: number; y: number };

type Drag =
  | { kind: 'draw'; anchor: Pt }
  | { kind: 'move'; id: string; start: Pt; orig: Drawing; moved: boolean; latest: Drawing[] | null }
  | { kind: 'handle'; id: string; handle: HandleName; orig: Drawing; latest: Drawing[] | null }
  | { kind: 'pan'; x: number; y: number; ox: number; oy: number }
  | { kind: 'angle'; x: number; y: number };

type Pinch = { startDist: number; startScale: number; localX: number; localY: number };

type TwoFinger =
  | { kind: 'place' }
  | {
      kind: 'adjust';
      id: string;
      orig: Drawing;
      pivot: Pt;
      startMid: Pt;
      startDist: number;
      startAng: number;
      latest: Drawing[] | null;
    };

export const VideoStage = forwardRef<
  VideoEngine,
  {
    blob: Blob;
    drawings: Drawing[];
    tool: Tool;
    color: string;
    selectedId: string | null;
    fps: number;
    rate: number;
    muted: boolean;
    mirrored?: boolean;
    panMode?: boolean;
    trimIn?: number | null;
    trimOut?: number | null;
    overlayBlob?: Blob | null;
    onSelect: (id: string | null) => void;
    onCommit: (next: Drawing[]) => void;
    onDraftChange?: (hasDraft: boolean) => void;
    onZoom?: (scale: number) => void;
    calibrate?: 'ball' | 'target' | 'ground' | null;
    onCalibrate?: (pt: Pt, phase: 'move' | 'up') => 'ball' | 'target' | 'ground' | null | void;
    /** Unconfirmed Down-the-line aim. Not drawn into exports. */
    aimSuggestion?: { point: Pt; toe?: [Pt, Pt]; parallel?: [Pt, Pt] } | null;
    /** video: any tap on the picture moves the suggestion. reticle: only a tap on the marker. */
    suggestDrag?: 'video' | 'reticle' | 'off';
    onSuggestAim?: (pt: Pt, phase: 'move' | 'up') => void;
    onConfirmAim?: () => void;
    immersive?: boolean;
    onExitImmersive?: () => void;
    tracerPath?: TracerPoint[] | null;
    tracerElapsed?: number | null;
    tracerMarks?: TracerMarks | null;
  }
>(function VideoStage(props, ref) {
  const {
    blob,
    drawings,
    tool,
    color,
    selectedId,
    fps,
    rate,
    muted,
    mirrored = false,
    panMode = false,
    trimIn = null,
    trimOut = null,
    overlayBlob = null,
    onSelect,
    onCommit,
    onDraftChange,
    onZoom,
    calibrate = null,
    onCalibrate,
    aimSuggestion = null,
    suggestDrag = 'off',
    onSuggestAim,
    onConfirmAim,
    immersive = false,
    onExitImmersive,
    tracerPath = null,
    tracerElapsed = null,
    tracerMarks = null,
  } = props;

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>({ scale: 1, x: 0, y: 0 });
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [anglePts, setAnglePts] = useState<Pt[]>([]);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [live, setLive] = useState<Drawing[] | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [reticle, setReticle] = useState<{ x: number; y: number; kind: 'ball' | 'target' | 'ground' } | null>(null);

  const layoutRef = useRef(layout);
  const zoomRef = useRef(zoom);
  const drawingsRef = useRef(drawings);
  const draftRef = useRef<Drawing | null>(null);
  const anglePtsRef = useRef<Pt[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const twoRef = useRef<TwoFinger | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const suppress = useRef(false);
  const draftFlag = useRef(false);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const selectedRef = useRef(selectedId);
  const fpsRef = useRef(fps);
  const rateRef = useRef(rate);
  const mirroredRef = useRef(mirrored);
  const panModeRef = useRef(panMode);
  const trimInRef = useRef<number | null>(trimIn);
  const trimOutRef = useRef<number | null>(trimOut);
  const onSelectRef = useRef(onSelect);
  const onCommitRef = useRef(onCommit);
  const onDraftChangeRef = useRef(onDraftChange);
  const onZoomRef = useRef(onZoom);
  const calibrateRef = useRef(calibrate);
  const onCalibrateRef = useRef(onCalibrate);
  const aimSuggestionRef = useRef(aimSuggestion);
  const suggestDragRef = useRef(suggestDrag);
  const onSuggestAimRef = useRef(onSuggestAim);
  const placingRef = useRef(false);
  const placingKind = useRef<'ball' | 'target' | 'ground' | 'suggest' | null>(null);
  const immersiveRef = useRef(immersive);
  const onExitImmersiveRef = useRef(onExitImmersive);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const manualRef = useRef(false);
  const manualTimer = useRef<number | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const apiRef = useRef<VideoEngine | null>(null);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node) {
      markInline(node);
      node.loop = false;
      node.onended = () => node.pause();
    }
  }, []);

  drawingsRef.current = drawings;
  toolRef.current = tool;
  colorRef.current = color;
  selectedRef.current = selectedId;
  fpsRef.current = fps;
  mirroredRef.current = mirrored;
  panModeRef.current = panMode;
  trimInRef.current = trimIn;
  trimOutRef.current = trimOut;
  onSelectRef.current = onSelect;
  onCommitRef.current = onCommit;
  onDraftChangeRef.current = onDraftChange;
  onZoomRef.current = onZoom;
  calibrateRef.current = calibrate;
  onCalibrateRef.current = onCalibrate;
  aimSuggestionRef.current = aimSuggestion;
  suggestDragRef.current = suggestDrag;
  onSuggestAimRef.current = onSuggestAim;
  immersiveRef.current = immersive;
  onExitImmersiveRef.current = onExitImmersive;
  layoutRef.current = layout;

  function flagDraft(nextDraft: Drawing | null, pts: Pt[]) {
    const has = nextDraft != null || pts.length > 0;
    if (has === draftFlag.current) return;
    draftFlag.current = has;
    onDraftChangeRef.current?.(has);
  }

  function publishDraft(next: Drawing | null) {
    draftRef.current = next;
    setDraft(next);
    flagDraft(next, anglePtsRef.current);
  }

  function publishAngle(pts: Pt[]) {
    anglePtsRef.current = pts;
    setAnglePts(pts);
    flagDraft(draftRef.current, pts);
  }

  function applyZoom(next: Zoom) {
    const stage = stageRef.current?.getBoundingClientRect();
    const box = layoutRef.current;
    const scale = clamp(next.scale, ZOOM_MIN, ZOOM_MAX);
    let x = next.x;
    let y = next.y;
    if (stage) {
      const maxX = Math.max(0, (box.w * scale - stage.width) / 2 + 32);
      const maxY = Math.max(0, (box.h * scale - stage.height) / 2 + 32);
      x = clamp(x, -maxX, maxX);
      y = clamp(y, -maxY, maxY);
    }
    const zoomNext = { scale, x, y };
    zoomRef.current = zoomNext;
    setZoom(zoomNext);
    onZoomRef.current?.(scale);
  }

  function stopManual() {
    if (manualTimer.current != null) {
      window.clearInterval(manualTimer.current);
      manualTimer.current = null;
    }
    manualRef.current = false;
  }

  async function lockWake() {
    try {
      if (wakeRef.current) return;
      wakeRef.current = await navigator.wakeLock.request('screen');
    } catch {
      wakeRef.current = null;
    }
  }

  async function unlockWake() {
    try {
      await wakeRef.current?.release();
    } catch {
      /* already released */
    }
    wakeRef.current = null;
  }

  function startManual(nextRate: number) {
    stopManual();
    const video = videoRef.current;
    if (!video) return;
    manualRef.current = true;
    void lockWake();
    const frames = Math.max(1, fpsRef.current || 30);
    const stepSize = 1 / frames;
    const interval = Math.max(20, (stepSize / Math.max(nextRate, 0.01)) * 1000);
    manualTimer.current = window.setInterval(() => {
      const node = videoRef.current;
      if (!node) return;
      const dur = Number.isFinite(node.duration) ? node.duration : 0;
      const end = trimOutRef.current;
      const start = trimInRef.current ?? 0;
      if (end != null && node.currentTime >= end - stepSize * 0.25) {
        node.currentTime = Math.max(start, end - 0.001);
        stopManual();
        void unlockWake();
        return;
      }
      if (node.currentTime >= dur - stepSize * 0.25) {
        stopManual();
        void unlockWake();
        return;
      }
      node.currentTime = Math.min(dur, node.currentTime + stepSize);
    }, interval);
  }

  // iOS has historically clamped very slow playbackRate values. If the
  // element refuses 0.25x or 0.1x, step frames on a timer instead.
  function applyRate(nextRate: number) {
    rateRef.current = nextRate;
    const video = videoRef.current;
    if (!video) return;
    const playing = manualRef.current || !video.paused;
    if (!playing) {
      video.playbackRate = nextRate;
      return;
    }
    stopManual();
    video.playbackRate = nextRate;
    if (nextRate < 0.5 && Math.abs(video.playbackRate - nextRate) > 0.05) {
      video.pause();
      startManual(nextRate);
      return;
    }
    if (video.paused) {
      void video.play().then(() => lockWake()).catch(() => undefined);
    }
  }

  function pause() {
    stopManual();
    videoRef.current?.pause();
    void unlockWake();
  }

  function playingOutsideTrim(time: number): boolean {
    const start = trimInRef.current ?? 0;
    const end = trimOutRef.current;
    if (time < start - 0.02) return true;
    if (end != null && end > start && time >= end - 0.02) return true;
    return false;
  }

  function enforceTrim(video: HTMLVideoElement) {
    const playing = manualRef.current || !video.paused;
    if (!playing || !playingOutsideTrim(video.currentTime)) return;
    const start = trimInRef.current ?? 0;
    const end = trimOutRef.current;
    if (end != null && end > start && video.currentTime >= end - 0.02) {
      video.currentTime = Math.max(start, end - 0.001);
      pause();
      return;
    }
    if (video.currentTime < start) video.currentTime = start;
  }

  async function play() {
    const video = videoRef.current;
    if (!video) return;
    stopManual();
    const nextRate = rateRef.current;
    video.playbackRate = nextRate;
    if (playingOutsideTrim(video.currentTime)) {
      video.currentTime = trimInRef.current ?? 0;
    }
    try {
      await video.play();
    } catch {
      throw new Error('Tap play once more to start the video.');
    }
    if (nextRate < 0.5 && Math.abs(video.playbackRate - nextRate) > 0.05) {
      video.pause();
      startManual(nextRate);
      return;
    }
    void lockWake();
  }

  function seek(time: number) {
    const video = videoRef.current;
    if (!video) return;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = dur > 0 ? clamp(time, 0, dur) : Math.max(0, time);
  }

  function step(dir: number) {
    const video = videoRef.current;
    if (!video) return;
    pause();
    const frames = Math.max(1, fpsRef.current || 30);
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    video.currentTime = clamp(video.currentTime + dir / frames, 0, dur || video.currentTime);
  }

  function zoomBy(factor: number) {
    const z = zoomRef.current;
    const scale = clamp(z.scale * factor, ZOOM_MIN, ZOOM_MAX);
    const localX = -z.x / z.scale;
    const localY = -z.y / z.scale;
    applyZoom({ scale, x: -localX * scale, y: -localY * scale });
  }

  function undoDraft() {
    if (anglePtsRef.current.length > 0) {
      publishAngle(anglePtsRef.current.slice(0, -1));
      setCursor(null);
      return true;
    }
    if (draftRef.current) {
      publishDraft(null);
      dragRef.current = null;
      return true;
    }
    return false;
  }

  function canvasRect() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return rect;
  }

  function normFromClient(clientX: number, clientY: number): Pt | null {
    const rect = canvasRect();
    if (!rect) return null;
    // The picture and the canvas share one CSS flip, so a tap on the
    // visual left is the right side of the unflipped video.
    const visualX = (clientX - rect.left) / rect.width;
    return {
      x: mirroredRef.current ? 1 - visualX : visualX,
      y: (clientY - rect.top) / rect.height,
    };
  }

  function placeReticle(clientX: number, clientY: number, phase: 'move' | 'up', kind: 'ball' | 'target' | 'ground' | 'suggest') {
    const rect = canvasRect();
    if (!rect) return;
    const placed = pointAboveFinger(clientX, clientY, rect, mirroredRef.current);
    const stage = stageRef.current?.getBoundingClientRect();
    if (stage && phase === 'move') {
      setReticle({
        x: placed.clientX - stage.left,
        y: placed.clientY - stage.top,
        kind: kind === 'suggest' ? 'target' : kind,
      });
    }
    if (kind === 'suggest') {
      onSuggestAimRef.current?.(placed.point, phase);
      return;
    }
    const next = onCalibrateRef.current?.(placed.point, phase);
    if (phase === 'up' && next !== undefined) calibrateRef.current = next ?? null;
  }

  function suggestionHit(clientX: number, clientY: number): boolean {
    const suggestion = aimSuggestionRef.current;
    const drag = suggestDragRef.current;
    if (!suggestion || drag === 'off' || calibrateRef.current) return false;
    const point = normFromClient(clientX, clientY);
    if (!point || !onVideo(clientX, clientY, point)) return false;
    if (drag === 'video') return true;
    const rect = canvasRect();
    if (!rect) return false;
    const visualX = mirroredRef.current ? 1 - suggestion.point.x : suggestion.point.x;
    const sx = rect.left + visualX * rect.width;
    const sy = rect.top + suggestion.point.y * rect.height;
    return Math.hypot(clientX - sx, clientY - sy) < 64;
  }

  function onVideo(clientX: number, clientY: number, p: Pt) {
    const rect = canvasRect();
    if (!rect) return false;
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom &&
      p.x >= -0.02 &&
      p.x <= 1.02 &&
      p.y >= -0.02 &&
      p.y <= 1.02
    );
  }

  const TWO_FINGER_TOOLS: Tool[] = ['line', 'pen', 'angle', 'circle', 'box', 'hline', 'vline'];

  function fingerPair(): { a: Pt; b: Pt; dist: number; ang: number; mid: Pt } | null {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    const a = normFromClient(pts[0].x, pts[0].y);
    const b = normFromClient(pts[1].x, pts[1].y);
    if (!a || !b) return null;
    return {
      a,
      b,
      dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
      ang: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function updatePlaceDraft(pair: { a: Pt; b: Pt; mid: Pt }) {
    const toolName = toolRef.current;
    const ink = colorRef.current;
    const rect = canvasRect();
    if (!rect) return;
    if (toolName === 'line') {
      const ends = lineFromFingers(pair.a, pair.b);
      publishDraft({ id: 'draft', type: 'line', color: ink, ...ends });
    } else if (toolName === 'circle') {
      const circle = circleFromFingers(pair.a, pair.b, rect.width, rect.height);
      publishDraft({ id: 'draft', type: 'circle', color: ink, ...circle });
    } else if (toolName === 'box') {
      const box = boxFromFingers(pair.a, pair.b);
      publishDraft({ id: 'draft', type: 'box', color: ink, ...box });
    } else if (toolName === 'angle') {
      const angle = angleFromFingers(pair.a, pair.b);
      publishDraft({ id: 'draft', type: 'angle', color: ink, ...angle });
    } else if (toolName === 'hline') {
      publishDraft({ id: 'draft', type: 'hline', color: ink, y: clamp((pair.a.y + pair.b.y) / 2, 0, 1) });
    } else if (toolName === 'vline') {
      publishDraft({ id: 'draft', type: 'vline', color: ink, x: clamp((pair.a.x + pair.b.x) / 2, 0, 1) });
    } else if (toolName === 'pen') {
      const mid = clampPt(pair.mid);
      const current = draftRef.current;
      if (!current || current.type !== 'pen') {
        publishDraft({ id: 'draft', type: 'pen', color: ink, points: [mid] });
        return;
      }
      const last = current.points[current.points.length - 1];
      if (last && pxDist(last, mid, rect.width, rect.height) < 2) return;
      if (current.points.length >= 1500) return;
      publishDraft({ ...current, points: [...current.points, mid] });
    }
  }

  function beginTwoFinger() {
    dragRef.current = null;
    publishAngle([]);
    setCursor(null);
    const pair = fingerPair();
    const rect = canvasRect();
    const toolName = toolRef.current;
    if (!pair || !rect) return;
    if (toolName === 'select') {
      const current = drawingsRef.current;
      const touch = (p: Pt) => hitTest(current, p, rect.width, rect.height, null);
      const hits = [touch(pair.mid), touch(pair.a), touch(pair.b)];
      const selected = selectedRef.current;
      const onSelected = selected != null && hits.some((hit) => hit?.id === selected);
      const id = onSelected ? selected : (hits.find((hit) => hit)?.id ?? null);
      const orig = id ? current.find((drawing) => drawing.id === id) : undefined;
      if (!orig || !id) {
        twoRef.current = null;
        return;
      }
      onSelectRef.current(id);
      twoRef.current = {
        kind: 'adjust',
        id,
        orig,
        pivot: pair.mid,
        startMid: pair.mid,
        startDist: pair.dist,
        startAng: pair.ang,
        latest: null,
      };
      return;
    }
    if (!TWO_FINGER_TOOLS.includes(toolName)) return;
    pause();
    publishDraft(null);
    twoRef.current = { kind: 'place' };
    updatePlaceDraft(pair);
  }

  function moveTwoFinger() {
    const pair = fingerPair();
    const rect = canvasRect();
    const two = twoRef.current;
    if (!pair || !rect || !two) return;
    if (two.kind === 'place') {
      updatePlaceDraft(pair);
      return;
    }
    const dx = pair.mid.x - two.startMid.x;
    const dy = pair.mid.y - two.startMid.y;
    const scale = pair.dist / two.startDist;
    let rot = pair.ang - two.startAng;
    if (rot > Math.PI) rot -= Math.PI * 2;
    if (rot < -Math.PI) rot += Math.PI * 2;
    const moved = transformDrawing(two.orig, two.pivot, scale, rot, dx, dy, rect.width, rect.height);
    const latest = drawingsRef.current.map((drawing) => (drawing.id === two.id ? moved : drawing));
    two.latest = latest;
    setLive(latest);
  }

  function finishTwoFinger() {
    const two = twoRef.current;
    twoRef.current = null;
    if (!two) return;
    if (two.kind === 'place') {
      finishDraw();
      return;
    }
    setLive(null);
    if (two.latest) onCommitRef.current(two.latest);
  }

  function beginPinch() {
    const pts = [...pointers.current.values()];
    const stage = stageRef.current?.getBoundingClientRect();
    if (pts.length < 2 || !stage) return;
    dragRef.current = null;
    publishDraft(null);
    setLive(null);
    const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const z = zoomRef.current;
    const relX = midX - stage.left - stage.width / 2;
    const relY = midY - stage.top - stage.height / 2;
    pinchRef.current = {
      startDist: dist,
      startScale: z.scale,
      localX: (relX - z.x) / z.scale,
      localY: (relY - z.y) / z.scale,
    };
  }

  function movePinch() {
    const pinch = pinchRef.current;
    const stage = stageRef.current?.getBoundingClientRect();
    const pts = [...pointers.current.values()];
    if (!pinch || !stage || pts.length < 2) return;
    const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    const midX = (pts[0].x + pts[1].x) / 2;
    const midY = (pts[0].y + pts[1].y) / 2;
    const relX = midX - stage.left - stage.width / 2;
    const relY = midY - stage.top - stage.height / 2;
    const scale = clamp(pinch.startScale * (dist / pinch.startDist), ZOOM_MIN, ZOOM_MAX);
    applyZoom({
      scale,
      x: relX - pinch.localX * scale,
      y: relY - pinch.localY * scale,
    });
  }

  function beginGesture(event: { clientX: number; clientY: number }) {
    const p = normFromClient(event.clientX, event.clientY);
    if (!p) return;
    if (panModeRef.current) {
      dragRef.current = {
        kind: 'pan',
        x: event.clientX,
        y: event.clientY,
        ox: zoomRef.current.x,
        oy: zoomRef.current.y,
      };
      return;
    }
    const active = toolRef.current;
    const rect = canvasRect();
    const drawingHere = rect != null && onVideo(event.clientX, event.clientY, p);

    if (TWO_FINGER_TOOLS.includes(active)) return;

    if (active === 'erase') {
      if (drawingHere && rect) {
        pause();
        const hit = hitTest(drawingsRef.current, p, rect.width, rect.height, null);
        if (hit) {
          onCommitRef.current(drawingsRef.current.filter((drawing) => drawing.id !== hit.id));
          onSelectRef.current(null);
        }
      }
      return;
    }

    if (active === 'select' || !drawingHere) {
      if (active === 'select' && drawingHere && rect) {
        const current = drawingsRef.current;
        const selected = selectedRef.current;
        if (selected) {
          const shape = current.find((d) => d.id === selected);
          if (shape) {
            const handleHit = hitTest([shape], p, rect.width, rect.height, shape.id);
            if (handleHit && handleHit.part !== 'body') {
              dragRef.current = {
                kind: 'handle',
                id: shape.id,
                handle: handleHit.part,
                orig: shape,
                latest: null,
              };
              return;
            }
          }
        }
        const hit = hitTest(current, p, rect.width, rect.height, null);
        if (hit) {
          onSelectRef.current(hit.id);
          const shape = current.find((d) => d.id === hit.id);
          if (shape) {
            dragRef.current = {
              kind: 'move',
              id: hit.id,
              start: p,
              orig: shape,
              moved: false,
              latest: null,
            };
          }
          return;
        }
        onSelectRef.current(null);
      }
      return;
    }

    if (active === 'angle') {
      pause();
      dragRef.current = { kind: 'angle', x: event.clientX, y: event.clientY };
      return;
    }

    onSelectRef.current(null);
    pause();
    const ink = colorRef.current;
    dragRef.current = { kind: 'draw', anchor: p };
    if (active === 'line') publishDraft({ id: 'draft', type: 'line', color: ink, a: p, b: p });
    else if (active === 'pen') publishDraft({ id: 'draft', type: 'pen', color: ink, points: [p] });
    else if (active === 'circle') publishDraft({ id: 'draft', type: 'circle', color: ink, c: p, r: 0 });
    else if (active === 'box') publishDraft({ id: 'draft', type: 'box', color: ink, x: p.x, y: p.y, w: 0, h: 0 });
    else if (active === 'hline') publishDraft({ id: 'draft', type: 'hline', color: ink, y: clamp(p.y, 0, 1) });
    else if (active === 'vline') publishDraft({ id: 'draft', type: 'vline', color: ink, x: clamp(p.x, 0, 1) });
  }

  function moveGesture(event: { clientX: number; clientY: number }) {
    const drag = dragRef.current;
    if (toolRef.current === 'angle' && anglePtsRef.current.length > 0) {
      const hover = normFromClient(event.clientX, event.clientY);
      if (hover) setCursor(hover);
    }
    if (!drag || drag.kind === 'angle') return;
    if (drag.kind === 'pan') {
      applyZoom({
        scale: zoomRef.current.scale,
        x: drag.ox + (event.clientX - drag.x),
        y: drag.oy + (event.clientY - drag.y),
      });
      return;
    }
    const p = normFromClient(event.clientX, event.clientY);
    const rect = canvasRect();
    if (!p || !rect) return;

    if (drag.kind === 'move') {
      if (pxDist(drag.start, p, rect.width, rect.height) > 2) drag.moved = true;
      const moved = translateDrawing(drag.orig, p.x - drag.start.x, p.y - drag.start.y);
      const latest = drawingsRef.current.map((d) => (d.id === drag.id ? moved : d));
      drag.latest = latest;
      setLive(latest);
      return;
    }
    if (drag.kind === 'handle') {
      const moved = applyHandle(drag.orig, drag.handle, p, rect.width, rect.height);
      const latest = drawingsRef.current.map((d) => (d.id === drag.id ? moved : d));
      drag.latest = latest;
      setLive(latest);
      return;
    }

    const current = draftRef.current;
    if (!current) return;
    if (current.type === 'line') publishDraft({ ...current, b: p });
    else if (current.type === 'pen') {
      const last = current.points[current.points.length - 1];
      if (last && pxDist(last, p, rect.width, rect.height) < 2) return;
      if (current.points.length >= 1500) return;
      publishDraft({ ...current, points: [...current.points, p] });
    } else if (current.type === 'circle') {
      publishDraft({ ...current, r: pxDist(current.c, p, rect.width, rect.height) / rect.width });
    } else if (current.type === 'box') {
      publishDraft({
        ...current,
        x: Math.min(drag.anchor.x, p.x),
        y: Math.min(drag.anchor.y, p.y),
        w: Math.abs(p.x - drag.anchor.x),
        h: Math.abs(p.y - drag.anchor.y),
      });
    } else if (current.type === 'hline') publishDraft({ ...current, y: clamp(p.y, 0, 1) });
    else if (current.type === 'vline') publishDraft({ ...current, x: clamp(p.x, 0, 1) });
  }

  function finishDraw() {
    const shape = draftRef.current;
    publishDraft(null);
    const rect = canvasRect();
    if (!shape || !rect) return;
    const commit = (drawing: Drawing) => {
      onCommitRef.current([...drawingsRef.current, drawing]);
      onSelectRef.current(drawing.id);
    };
    if (shape.type === 'line') {
      if (pxDist(shape.a, shape.b, rect.width, rect.height) < 8) return;
      commit({ ...shape, id: uid() });
    } else if (shape.type === 'pen') {
      if (shape.points.length < 2) return;
      commit({ ...shape, id: uid() });
    } else if (shape.type === 'circle') {
      if (shape.r * rect.width < 8) return;
      commit({ ...shape, id: uid() });
    } else if (shape.type === 'box') {
      if (shape.w * rect.width < 8 && shape.h * rect.height < 8) return;
      commit({ ...shape, id: uid() });
    } else if (shape.type === 'angle') {
      if (pxDist(shape.a, shape.v, rect.width, rect.height) < 8 && pxDist(shape.b, shape.v, rect.width, rect.height) < 8) {
        return;
      }
      commit({ ...shape, id: uid() });
    } else if (shape.type === 'hline' || shape.type === 'vline') {
      commit({ ...shape, id: uid() });
    }
  }

  function finishGesture(event: { clientX: number; clientY: number }) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === 'angle') {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 18) return;
      const p = normFromClient(event.clientX, event.clientY);
      if (!p || !onVideo(event.clientX, event.clientY, p)) return;
      const pts = [...anglePtsRef.current, { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }];
      if (pts.length >= 3) {
        const [a, v, b] = pts;
        onCommitRef.current([
          ...drawingsRef.current,
          { id: uid(), type: 'angle', color: colorRef.current, a, v, b },
        ]);
        publishAngle([]);
        return;
      }
      publishAngle(pts);
      return;
    }
    if (drag.kind === 'move') {
      setLive(null);
      if (drag.moved && drag.latest) onCommitRef.current(drag.latest);
      return;
    }
    if (drag.kind === 'handle') {
      setLive(null);
      if (drag.latest) onCommitRef.current(drag.latest);
      return;
    }
    if (drag.kind === 'draw') finishDraw();
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const types = mimeAttempts(blob.type);
    let cancelled = false;
    let url = '';
    let attempt = 0;
    let timer = 0;
    setMediaError(null);
    const showFrame = () => {
      if (cancelled) return;
      if (video.videoWidth > 0) setVideoSize({ w: video.videoWidth, h: video.videoHeight });
      if (video.readyState >= 2) paintFirstFrame(video);
    };
    const begin = () => {
      if (url) URL.revokeObjectURL(url);
      window.clearTimeout(timer);
      const typed = blobWithMime(blob, types[attempt] ?? 'video/mp4');
      url = URL.createObjectURL(typed);
      loadInlineSource(video, url);
      video.playbackRate = rateRef.current;
      timer = window.setTimeout(() => {
        if (cancelled || video.readyState >= 1 || video.error) return;
        if (attempt + 1 < types.length) {
          attempt += 1;
          begin();
          return;
        }
        setMediaError('This phone did not start loading that video.');
      }, 8000);
    };
    const onErr = () => {
      if (cancelled) return;
      if (attempt + 1 < types.length) {
        attempt += 1;
        begin();
        return;
      }
      setMediaError(mediaErrorMessage(video));
    };
    const onNativeFullscreen = () => {
      exitIfNativeFullscreen(video);
    };
    const onTime = () => enforceTrim(video);
    video.addEventListener('loadedmetadata', showFrame);
    video.addEventListener('loadeddata', showFrame);
    video.addEventListener('resize', showFrame);
    video.addEventListener('error', onErr);
    video.addEventListener('webkitbeginfullscreen', onNativeFullscreen);
    video.addEventListener('timeupdate', onTime);
    begin();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopManual();
      video.removeEventListener('loadedmetadata', showFrame);
      video.removeEventListener('loadeddata', showFrame);
      video.removeEventListener('resize', showFrame);
      video.removeEventListener('error', onErr);
      video.removeEventListener('webkitbeginfullscreen', onNativeFullscreen);
      video.removeEventListener('timeupdate', onTime);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
    };
    // rate is applied by the rate effect; the blob effect only needs the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    const over = overlayRef.current;
    const main = videoRef.current;
    if (!over || !main || !overlayBlob) return;
    const url = URL.createObjectURL(overlayBlob);
    const onFrame = () => paintFirstFrame(over);
    const onNativeFullscreen = () => {
      exitIfNativeFullscreen(over);
    };
    over.muted = true;
    over.addEventListener('loadeddata', onFrame);
    over.addEventListener('webkitbeginfullscreen', onNativeFullscreen);
    loadInlineSource(over, url);
    const sync = () => {
      const lead = videoRef.current;
      const follow = overlayRef.current;
      if (!lead || !follow) return;
      const leadDur = lead.duration;
      const followDur = follow.duration;
      if (leadDur > 0 && followDur > 0) {
        const target = (lead.currentTime / leadDur) * followDur;
        if (Math.abs(follow.currentTime - target) > 0.08) follow.currentTime = target;
      }
      if (lead.paused) follow.pause();
      else if (follow.paused) void follow.play().catch(() => undefined);
    };
    main.addEventListener('timeupdate', sync);
    main.addEventListener('seeked', sync);
    main.addEventListener('play', sync);
    main.addEventListener('pause', sync);
    return () => {
      main.removeEventListener('timeupdate', sync);
      main.removeEventListener('seeked', sync);
      main.removeEventListener('play', sync);
      main.removeEventListener('pause', sync);
      over.removeEventListener('loadeddata', onFrame);
      over.removeEventListener('webkitbeginfullscreen', onNativeFullscreen);
      over.pause();
      over.removeAttribute('src');
      over.load();
      URL.revokeObjectURL(url);
    };
  }, [overlayBlob]);

  useEffect(() => {
    if (!calibrate) setReticle(null);
  }, [calibrate]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
      videoRef.current.loop = false;
    }
  }, [muted]);

  useEffect(() => {
    applyRate(rate);
    // applyRate is recreated each render and reads refs; rerun only when the requested rate changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  useEffect(() => {
    return () => {
      stopManual();
      void unlockWake();
    };
    // unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const compute = () => {
      const rect = stage.getBoundingClientRect();
      const vw = videoSize.w || 9;
      const vh = videoSize.h || 16;
      const fit = Math.min(rect.width / vw, rect.height / vh);
      const w = Math.max(1, Math.floor(vw * (Number.isFinite(fit) ? fit : 1)));
      const h = Math.max(1, Math.floor(vh * (Number.isFinite(fit) ? fit : 1)));
      layoutRef.current = { w, h };
      setLayout({ w, h });
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [videoSize.w, videoSize.h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || layout.w < 2 || layout.h < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(layout.w * dpr));
    const bh = Math.max(1, Math.round(layout.h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, live ?? drawings, draft, anglePts, cursor, color, layout.w, layout.h, selectedId);
    paintTracer(ctx, tracerPath, layout.w, layout.h, tracerElapsed, tracerMarks);
  }, [drawings, live, draft, anglePts, cursor, color, layout, selectedId, tracerPath, tracerElapsed, tracerMarks]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => apiRef.current?.play() ?? Promise.resolve(),
      pause: () => apiRef.current?.pause(),
      seek: (time: number) => apiRef.current?.seek(time),
      step: (dir: number) => apiRef.current?.step(dir),
      setRate: (next: number) => apiRef.current?.setRate(next),
      getTime: () => apiRef.current?.getTime() ?? 0,
      getDuration: () => apiRef.current?.getDuration() ?? 0,
      getPaused: () => apiRef.current?.getPaused() ?? true,
      getEnded: () => apiRef.current?.getEnded() ?? false,
      captureFrame: () => apiRef.current?.captureFrame() ?? null,
      undoDraft: () => apiRef.current?.undoDraft() ?? false,
      hasDraft: () => apiRef.current?.hasDraft() ?? false,
      zoomBy: (factor: number) => apiRef.current?.zoomBy(factor),
      resetZoom: () => apiRef.current?.resetZoom(),
      getZoom: () => apiRef.current?.getZoom() ?? 1,
    }),
    [],
  );

  apiRef.current = {
    play,
    pause,
    seek,
    step,
    setRate: applyRate,
    getTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => {
      const dur = videoRef.current?.duration;
      return typeof dur === 'number' && Number.isFinite(dur) ? dur : 0;
    },
    getPaused: () => (manualRef.current ? false : (videoRef.current?.paused ?? true)),
    getEnded: () => {
      const video = videoRef.current;
      if (!video || manualRef.current || !video.paused) return false;
      const time = video.currentTime;
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      const trimEnd = trimOutRef.current;
      const start = trimInRef.current ?? 0;
      const end = trimEnd != null && trimEnd > start ? trimEnd : dur;
      return end > 0 && time >= end - 0.05;
    },
    undoDraft,
    hasDraft: () => anglePtsRef.current.length > 0 || draftRef.current != null,
    zoomBy,
    resetZoom: () => applyZoom({ scale: 1, x: 0, y: 0 }),
    getZoom: () => zoomRef.current.scale,
    captureFrame: () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth < 2 || video.videoHeight < 2) return null;
      const scale = Math.min(1, 640 / video.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas;
    },
  };

  const suggestionOnStage = (() => {
    if (!aimSuggestion) return null;
    const rect = canvasRef.current?.getBoundingClientRect();
    const stage = stageRef.current?.getBoundingClientRect();
    if (!rect || !stage || rect.width < 2 || rect.height < 2) return null;
    const visualX = mirrored ? 1 - aimSuggestion.point.x : aimSuggestion.point.x;
    const x = rect.left - stage.left + visualX * rect.width;
    const y = rect.top - stage.top + aimSuggestion.point.y * rect.height;
    const confirmX = x > rect.width * 0.72 ? x - 46 : x + 28;
    const confirmY = Math.max(8, y - 46);
    return { x, y, confirmX, confirmY };
  })();

  const gestureHint =
    tool === 'line'
      ? 'Two fingers. Each finger is one end of the line.'
      : tool === 'circle' || tool === 'box'
        ? 'Two fingers. Pinch to size, drag to place.'
        : tool === 'angle'
          ? 'Two fingers set the arms. The joint sits between them.'
          : tool === 'pen'
            ? 'Two fingers. The stroke follows between them.'
            : tool === 'hline'
              ? 'Two fingers place the level line.'
              : tool === 'vline'
                ? 'Two fingers place the plumb line.'
                : tool === 'select'
                  ? 'Two fingers move, pinch, or turn. Drag a handle to fine-tune.'
                  : null;

  return (
    <div
      ref={stageRef}
      className="stage"
      data-testid="stage"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (calibrateRef.current) {
          const p = normFromClient(event.clientX, event.clientY);
          if (p && onVideo(event.clientX, event.clientY, p)) {
            event.currentTarget.setPointerCapture(event.pointerId);
            placingRef.current = true;
            placingKind.current = calibrateRef.current;
            placeReticle(event.clientX, event.clientY, 'move', calibrateRef.current);
          }
          return;
        }
        if (suggestionHit(event.clientX, event.clientY)) {
          event.currentTarget.setPointerCapture(event.pointerId);
          placingRef.current = true;
          placingKind.current = 'suggest';
          placeReticle(event.clientX, event.clientY, 'move', 'suggest');
          return;
        }
        pressRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size >= 2) {
          if (panModeRef.current) beginPinch();
          else beginTwoFinger();
          return;
        }
        beginGesture(event);
      }}
      onPointerMove={(event) => {
        if (placingRef.current && placingKind.current) {
          placeReticle(event.clientX, event.clientY, 'move', placingKind.current);
          return;
        }
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size >= 2) {
          if (panModeRef.current && pinchRef.current) movePinch();
          else moveTwoFinger();
          return;
        }
        if (suppress.current || pinchRef.current || twoRef.current) return;
        moveGesture(event);
      }}
      onPointerUp={(event) => {
        if (placingRef.current && placingKind.current) {
          placeReticle(event.clientX, event.clientY, 'up', placingKind.current);
          placingRef.current = false;
          placingKind.current = null;
          setReticle(null);
          return;
        }
        const press = pressRef.current;
        pressRef.current = null;
        if (immersiveRef.current && press && !calibrateRef.current && pointers.current.size <= 1 && !twoRef.current && !pinchRef.current) {
          const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
          if (moved < 14) {
            pointers.current.delete(event.pointerId);
            dragRef.current = null;
            setCursor(null);
            onExitImmersiveRef.current?.();
            return;
          }
        }
        pointers.current.delete(event.pointerId);
        if (pinchRef.current) {
          if (pointers.current.size < 2) {
            pinchRef.current = null;
            suppress.current = true;
            dragRef.current = null;
          }
          return;
        }
        if (twoRef.current) {
          if (pointers.current.size < 2) {
            finishTwoFinger();
            suppress.current = true;
            dragRef.current = null;
          }
          return;
        }
        if (suppress.current) {
          if (pointers.current.size === 0) suppress.current = false;
          dragRef.current = null;
          setCursor(null);
          return;
        }
        finishGesture(event);
        setCursor(null);
      }}
      onPointerCancel={(event) => {
        if (placingRef.current) {
          placingRef.current = false;
          placingKind.current = null;
          setReticle(null);
        }
        pointers.current.delete(event.pointerId);
        pinchRef.current = null;
        twoRef.current = null;
        dragRef.current = null;
        publishDraft(null);
        setLive(null);
        setCursor(null);
        if (pointers.current.size === 0) suppress.current = false;
      }}
    >
      <div
        className="fit"
        data-mirrored={mirrored ? 'true' : 'false'}
        style={{
          width: layout.w,
          height: layout.h,
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${mirrored ? -zoom.scale : zoom.scale}, ${zoom.scale})`,
        }}
      >
        <video
          ref={attachVideo}
          playsInline
          muted={muted}
          loop={false}
          preload="auto"
          controls={false}
          aria-label="Swing video"
        />
        {overlayBlob && (
          <video
            ref={overlayRef}
            className="overlay-video"
            playsInline
            muted
            preload="auto"
            controls={false}
            aria-hidden="true"
          />
        )}
        <canvas ref={canvasRef} />
        {aimSuggestion && !reticle && (aimSuggestion.toe || aimSuggestion.parallel) && (
          <svg className="aim-guides" viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true">
            {aimSuggestion.toe && (
              <line
                x1={aimSuggestion.toe[0].x * layout.w}
                y1={aimSuggestion.toe[0].y * layout.h}
                x2={aimSuggestion.toe[1].x * layout.w}
                y2={aimSuggestion.toe[1].y * layout.h}
                stroke="rgba(255,255,255,0.45)"
                strokeWidth="1.5"
                strokeDasharray="4 5"
              />
            )}
            {aimSuggestion.parallel && (
              <line
                x1={aimSuggestion.parallel[0].x * layout.w}
                y1={aimSuggestion.parallel[0].y * layout.h}
                x2={aimSuggestion.parallel[1].x * layout.w}
                y2={aimSuggestion.parallel[1].y * layout.h}
                stroke="rgba(126,224,255,0.55)"
                strokeWidth="1.5"
                strokeDasharray="3 6"
              />
            )}
          </svg>
        )}
      </div>
      {reticle && (
        <div className="aim-reticle" data-testid="aim-reticle" data-kind={reticle.kind} style={{ left: reticle.x, top: reticle.y }}>
          <span className="aim-reticle-ring" />
          <span className="aim-reticle-label">{reticle.kind === 'ball' ? 'Ball' : reticle.kind === 'ground' ? 'Ground' : 'Aim'}</span>
        </div>
      )}
      {aimSuggestion && !reticle && suggestionOnStage && (
        <>
          <div className="aim-reticle" data-testid="aim-suggestion" data-kind="suggest" style={{ left: suggestionOnStage.x, top: suggestionOnStage.y }}>
            <span className="aim-reticle-ring" />
            <span className="aim-reticle-label">Aim</span>
          </div>
          <button
            type="button"
            className="aim-confirm"
            data-testid="aim-confirm"
            aria-label="Use this aim point"
            style={{ left: suggestionOnStage.confirmX, top: suggestionOnStage.confirmY }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onConfirmAim?.()}
          >
            <Icon name="check" />
          </button>
        </>
      )}
      {calibrate ? (
        <div className="gesture-chip" data-testid="tracer-hint">
          {calibrate === 'ball'
            ? 'Drag the ball. The crosshair sits above your finger.'
            : calibrate === 'ground'
              ? 'Drag the landing ground. The crosshair sits above your finger.'
              : 'Drag the aim point. The crosshair sits above your finger.'}
        </div>
      ) : (
        gestureHint && !panMode && <div className="gesture-chip">{gestureHint}</div>
      )}
      {mediaError && <div className="stage-error">{mediaError}</div>}
    </div>
  );
});
