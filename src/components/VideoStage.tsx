import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ZOOM_MAX, ZOOM_MIN } from '../constants';
import { paint } from '../draw';
import { uid } from '../format';
import { exitNativeFullscreen, lockInlinePlayback } from '../inlineVideo';
import {
  applyHandle,
  clamp,
  hitTest,
  pxDist,
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
    loop: boolean;
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
    loop,
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

  const layoutRef = useRef(layout);
  const zoomRef = useRef(zoom);
  const drawingsRef = useRef(drawings);
  const draftRef = useRef<Drawing | null>(null);
  const anglePtsRef = useRef<Pt[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const suppress = useRef(false);
  const draftFlag = useRef(false);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const selectedRef = useRef(selectedId);
  const fpsRef = useRef(fps);
  const rateRef = useRef(rate);
  const loopRef = useRef(loop);
  const mirroredRef = useRef(mirrored);
  const panModeRef = useRef(panMode);
  const trimInRef = useRef<number | null>(trimIn);
  const trimOutRef = useRef<number | null>(trimOut);
  const onSelectRef = useRef(onSelect);
  const onCommitRef = useRef(onCommit);
  const onDraftChangeRef = useRef(onDraftChange);
  const onZoomRef = useRef(onZoom);
  const manualRef = useRef(false);
  const manualTimer = useRef<number | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const apiRef = useRef<VideoEngine | null>(null);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node) lockInlinePlayback(node);
  }, []);

  drawingsRef.current = drawings;
  toolRef.current = tool;
  colorRef.current = color;
  selectedRef.current = selectedId;
  fpsRef.current = fps;
  loopRef.current = loop;
  mirroredRef.current = mirrored;
  panModeRef.current = panMode;
  trimInRef.current = trimIn;
  trimOutRef.current = trimOut;
  onSelectRef.current = onSelect;
  onCommitRef.current = onCommit;
  onDraftChangeRef.current = onDraftChange;
  onZoomRef.current = onZoom;
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
        if (loopRef.current) {
          node.currentTime = start;
          return;
        }
        node.currentTime = Math.max(start, end - 0.001);
        stopManual();
        void unlockWake();
        return;
      }
      if (node.currentTime >= dur - stepSize * 0.25) {
        if (loopRef.current) {
          node.currentTime = 0;
          return;
        }
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
      if (loopRef.current) {
        video.currentTime = start;
        return;
      }
      video.currentTime = Math.max(start, end - 0.001);
      pause();
      return;
    }
    if (video.currentTime < start) video.currentTime = start;
  }

  async function play() {
    const video = videoRef.current;
    if (!video) return;
    lockInlinePlayback(video);
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
      if (zoomRef.current.scale > 1.01) {
        dragRef.current = {
          kind: 'pan',
          x: event.clientX,
          y: event.clientY,
          ox: zoomRef.current.x,
          oy: zoomRef.current.y,
        };
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
    const url = URL.createObjectURL(blob);
    let cancelled = false;
    const onMeta = () => {
      if (cancelled) return;
      setVideoSize({ w: video.videoWidth, h: video.videoHeight });
      if (video.currentTime < 0.001 && video.duration > 0.1) {
        try {
          video.currentTime = Math.min(0.05, video.duration / 2);
        } catch {
          /* Some files are not seekable until the first play. */
        }
      }
    };
    const onErr = () => {
      if (cancelled) return;
      setMediaError('This browser could not play that video. iPhone Safari plays Camera Roll clips, including slo-mo.');
    };
    const onNativeFullscreen = (event: Event) => {
      event.preventDefault();
      exitNativeFullscreen(video);
    };
    const onTime = () => enforceTrim(video);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('resize', onMeta);
    video.addEventListener('error', onErr);
    video.addEventListener('webkitbeginfullscreen', onNativeFullscreen);
    video.addEventListener('timeupdate', onTime);
    // Attributes first. iOS latches the system player if src is set before them.
    lockInlinePlayback(video);
    video.src = url;
    video.playbackRate = rateRef.current;
    return () => {
      cancelled = true;
      stopManual();
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('resize', onMeta);
      video.removeEventListener('error', onErr);
      video.removeEventListener('webkitbeginfullscreen', onNativeFullscreen);
      video.removeEventListener('timeupdate', onTime);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    // rate is applied by the rate effect; the blob effect only needs the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    const over = overlayRef.current;
    const main = videoRef.current;
    if (!over || !main || !overlayBlob) return;
    const url = URL.createObjectURL(overlayBlob);
    lockInlinePlayback(over);
    over.src = url;
    over.muted = true;
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
    const onNativeFullscreen = (event: Event) => {
      event.preventDefault();
      exitNativeFullscreen(over);
    };
    over.addEventListener('webkitbeginfullscreen', onNativeFullscreen);
    main.addEventListener('timeupdate', sync);
    main.addEventListener('seeked', sync);
    main.addEventListener('play', sync);
    main.addEventListener('pause', sync);
    return () => {
      main.removeEventListener('timeupdate', sync);
      main.removeEventListener('seeked', sync);
      main.removeEventListener('play', sync);
      main.removeEventListener('pause', sync);
      over.removeEventListener('webkitbeginfullscreen', onNativeFullscreen);
      over.pause();
      over.removeAttribute('src');
      over.load();
      URL.revokeObjectURL(url);
    };
  }, [overlayBlob]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop;
  }, [loop]);

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
  }, [drawings, live, draft, anglePts, cursor, color, layout, selectedId]);

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
    undoDraft,
    hasDraft: () => anglePtsRef.current.length > 0 || draftRef.current != null,
    zoomBy,
    resetZoom: () => applyZoom({ scale: 1, x: 0, y: 0 }),
    getZoom: () => zoomRef.current.scale,
  };

  const angleHint =
    anglePts.length === 0 ? 'Tap the first point' : anglePts.length === 1 ? 'Tap the joint' : 'Tap the other end';

  return (
    <div
      ref={stageRef}
      className="stage"
      data-testid="stage"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size >= 2) {
          beginPinch();
          return;
        }
        beginGesture(event);
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size >= 2 && pinchRef.current) {
          movePinch();
          return;
        }
        if (suppress.current || pinchRef.current) return;
        moveGesture(event);
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        if (pinchRef.current) {
          if (pointers.current.size < 2) {
            pinchRef.current = null;
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
        pointers.current.delete(event.pointerId);
        pinchRef.current = null;
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
          className="inline-video"
          playsInline
          muted={muted}
          loop={loop}
          preload="metadata"
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          aria-label="Swing video"
          onClick={(event) => event.preventDefault()}
        />
        {overlayBlob && (
          <video
            ref={overlayRef}
            className="inline-video overlay-video"
            playsInline
            muted
            preload="metadata"
            controls={false}
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden="true"
          />
        )}
        <canvas ref={canvasRef} />
      </div>
      {tool === 'angle' && <div className="gesture-chip">{angleHint}</div>}
      {mediaError && <div className="stage-error">{mediaError}</div>}
    </div>
  );
});
