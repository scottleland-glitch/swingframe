import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { DRAW_COLORS, FPS_OPTIONS, SPEEDS } from '../constants';
import { deleteSwing, getVideo, listSwings, releaseLocalVideo } from '../db';
import { backupSwing, downloadSwingVideo } from '../driveApi';
import { DRIVE_ENABLED } from '../driveConfig';
import { connectGoogle, googleConnected } from '../googleAuth';
import { cx, errorMessage, formatDate, formatRate, formatScrub, formatTime, viewLabel } from '../format';
import { withColor } from '../geometry';
import { detectImpactTime } from '../tracer/detect';
import { chooseUndo, tracerIsSet } from '../tracer/active';
import { emptyShot, simulateShot } from '../tracer/flight';
import { offerRecording, recordTracerVideo } from '../tracer/exportVideo';
import { parallelAim, straightAheadAim, type ToeLine } from '../tracer/aimSuggest';
import { detectFeet, frameAtTime } from '../tracer/pose';
import { defaultTracer, projectFlight } from '../tracer/project';
import { manualTrace, shapePoints } from '../tracer/manualTrace';
import type { TracerMarks } from '../tracer/paintTracer';
import { ballGuess, launchIsSet, previousStep, resetSetup, setupStep, showsPlacementReticle, type SetupPhase } from '../tracer/setup';
import { clipEndTime, holdSpan, nextHold, playClock, tracerPlayhead } from '../tracer/timing';
import type { Drawing, Pt, ShotData, ShotShape, SwingMeta, Tool, TracerCalibration } from '../types';
import { useSwing } from '../useSwing';
import { APP_VERSION } from '../version';
import { DetailsSheet } from './DetailsSheet';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icons';
import { Scrubber } from './Scrubber';
import { TracerPanel } from './TracerPanel';
import { VideoStage, type VideoEngine } from './VideoStage';

const HINTS: Record<Tool, string> = {
  select: 'Two fingers move, pinch, or turn a drawing. Drag a white handle with one finger to fine-tune.',
  line: 'Two fingers. Each finger is one end of the line. It extends across the frame.',
  pen: 'Two fingers. The stroke follows the point between them.',
  angle: 'Two fingers set the arms. The joint sits halfway between them.',
  circle: 'Two fingers. Pinch to size the circle, drag to place it.',
  box: 'Two fingers. Pinch to size the box, drag to place it.',
  hline: 'Two fingers place the level line.',
  vline: 'Two fingers place the plumb line.',
  erase: 'Tap a drawing to remove it.',
};

function showAimMarks(cal: TracerCalibration): TracerMarks | null {
  if (cal.showAim !== true) return null;
  if (cal.mode === 'manual' && cal.manualStart && cal.manualApex && cal.manualFinish) {
    return {
      ball: null,
      target: null,
      ground: null,
      manual: { start: cal.manualStart, apex: cal.manualApex, finish: cal.manualFinish },
    };
  }
  return { ball: cal.ball, target: cal.target, ground: cal.ground ?? null };
}

const DRAW_TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: 'select', label: 'Move', icon: 'select' },
  { id: 'box', label: 'Box', icon: 'box' },
  { id: 'circle', label: 'Circle', icon: 'circle' },
  { id: 'line', label: 'Line', icon: 'line' },
  { id: 'erase', label: 'Erase', icon: 'erase' },
  { id: 'angle', label: 'Angle', icon: 'angle' },
  { id: 'pen', label: 'Freehand', icon: 'pen' },
  { id: 'hline', label: 'Level', icon: 'hline' },
  { id: 'vline', label: 'Plumb', icon: 'vline' },
];

function useClock(engine: RefObject<VideoEngine | null>) {
  const [clock, setClock] = useState({ time: 0, duration: 0, paused: true });
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const api = engine.current;
      const time = api?.getTime() ?? 0;
      const duration = api?.getDuration() ?? 0;
      const paused = api?.getPaused() ?? true;
      setClock((prev) => {
        if (
          prev.paused === paused &&
          Math.abs(prev.time - time) < 0.0005 &&
          Math.abs(prev.duration - duration) < 0.0005
        ) {
          return prev;
        }
        return { time, duration, paused };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine]);
  return clock;
}

export function PlayerView({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { swing, blob, drawings, pastCount, load, saveError, commit, undo, patch, reload } = useSwing(id);
  const stageRef = useRef<VideoEngine>(null);
  const [tool, setTool] = useState<Tool>('line');
  const [color, setColor] = useState<string>(DRAW_COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(true);
  const [holding, setHolding] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmFree, setConfirmFree] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveNote, setDriveNote] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pinch, setPinch] = useState(false);
  const [panelPage, setPanelPage] = useState<'draw' | 'edit' | 'trim' | 'overlay' | 'tracer'>('draw');
  const [setupPhase, setSetupPhase] = useState<SetupPhase | null>(null);
  const [draftPoint, setDraftPoint] = useState<Pt | null>(null);
  const [feetTick, setFeetTick] = useState(0);
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [aimGuides, setAimGuides] = useState<{ toe: [Pt, Pt]; parallel: [Pt, Pt] } | null>(null);
  const [shot, setShot] = useState<ShotData | null>(null);
  const [tracerCal, setTracerCal] = useState<TracerCalibration | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [tracerNote, setTracerNote] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const exportAbort = useRef<AbortController | null>(null);
  const hydratedFor = useRef<string | null>(null);
  const aimEpoch = useRef(0);
  const feetRef = useRef<ToeLine | null>(null);
  const draftTouched = useRef(false);
  const draftRef = useRef<Pt | null>(null);
  const setupPhaseRef = useRef<SetupPhase | null>(null);
  const tracerPending = useRef<{ shot: ShotData; tracer: TracerCalibration } | null>(null);
  const tracerTimer = useRef<number | null>(null);
  const tracerRun = useRef(false);
  const holdRef = useRef(0);
  const flightRef = useRef(0);
  const rateRef = useRef(rate);
  const holdingRef = useRef(false);
  const parkedAt = useRef(0);
  const restartUntil = useRef(0);
  const atEndRef = useRef(false);
  const trimInRef = useRef<number | null>(null);
  const trimOutRef = useRef<number | null>(null);
  const [tracerHold, setTracerHold] = useState(0);
  const [tracerEngaged, setTracerEngaged] = useState(false);
  const [confirmTracer, setConfirmTracer] = useState(false);
  const [tracerUndoReady, setTracerUndoReady] = useState(false);
  const tracerUndo = useRef<{ shot: ShotData; tracer: TracerCalibration } | null>(null);
  const undoStamp = useRef(0);
  const tracerUndoStamp = useRef(0);
  const drawingUndoStamp = useRef(0);
  const barObserver = useRef<ResizeObserver | null>(null);
  const setBarNode = useCallback((node: HTMLDivElement | null) => {
    barObserver.current?.disconnect();
    barObserver.current = null;
    const screen = node?.parentElement;
    if (!node || !screen) return;
    const apply = () => {
      screen.style.setProperty('--player-bar-height', `${Math.ceil(node.getBoundingClientRect().height)}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    barObserver.current = observer;
  }, []);
  rateRef.current = rate;
  trimInRef.current = swing?.trimIn ?? null;
  trimOutRef.current = swing?.trimOut ?? null;
  const [others, setOthers] = useState<SwingMeta[]>([]);
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [overlayBlob, setOverlayBlob] = useState<Blob | null>(null);
  const clock = useClock(stageRef);
  const activeShot = shot ?? swing?.shot ?? emptyShot();
  const activeCal = tracerCal ?? swing?.tracer ?? defaultTracer();
  const shotRef = useRef(activeShot);
  const calRef = useRef(activeCal);
  shotRef.current = activeShot;
  calRef.current = activeCal;
  draftRef.current = draftPoint;
  setupPhaseRef.current = setupPhase;

  const rememberTracer = useCallback(
    (nextShot: ShotData, nextTracer: TracerCalibration, immediate = false) => {
      setShot(nextShot);
      setTracerCal(nextTracer);
      shotRef.current = nextShot;
      calRef.current = nextTracer;
      tracerPending.current = { shot: nextShot, tracer: nextTracer };
      if (tracerTimer.current) window.clearTimeout(tracerTimer.current);
      const write = () => {
        tracerTimer.current = null;
        const pending = tracerPending.current;
        tracerPending.current = null;
        if (!pending) return;
        void patch(pending).catch(() => setPlayError('Could not save the tracer.'));
      };
      if (immediate) write();
      else tracerTimer.current = window.setTimeout(write, 280);
    },
    [patch],
  );

  const carryMeters = useCallback(() => {
    const flight = simulateShot(shotRef.current);
    return flight ? flight.carryYd * 0.9144 : 140;
  }, []);

  const cameraOf = useCallback(() => {
    const cal = calRef.current;
    return {
      view: 'dtl' as const,
      height: cal.cameraHeight,
      distance: cal.cameraDistance,
      fov: cal.fov,
    };
  }, []);

  const seedFor = useCallback(
    (phase: SetupPhase): Pt | null => {
      const cal = calRef.current;
      if (phase === 'aim') {
        if (cal.target) return cal.target;
        return straightAheadAim({
          ball: cal.ball,
          groundY: cal.ground?.y ?? null,
          camera: cameraOf(),
          carryMeters: carryMeters(),
        });
      }
      if (phase === 'ball') {
        if (cal.ball) return cal.ball;
        return ballGuess(feetRef.current);
      }
      if (phase === 'horizon') {
        if (cal.ground) return cal.ground;
        const far = straightAheadAim({
          ball: cal.ball,
          groundY: null,
          camera: cameraOf(),
          carryMeters: carryMeters(),
        });
        return { x: 0.5, y: far.y };
      }
      if (phase === 'start') {
        if (cal.manualStart) return cal.manualStart;
        if (cal.ball) return cal.ball;
        return ballGuess(feetRef.current);
      }
      if (phase === 'apex' || phase === 'finish') {
        const origin = cal.manualStart ?? cal.ball ?? ballGuess(feetRef.current);
        const seeded = shapePoints(cal.shape ?? 'straight', origin);
        if (phase === 'apex') return cal.manualApex ?? seeded.apex;
        return cal.manualFinish ?? seeded.finish;
      }
      return null;
    },
    [cameraOf, carryMeters],
  );

  const enterStep = useCallback(
    (phase: SetupPhase) => {
      draftTouched.current = false;
      setupPhaseRef.current = phase;
      setSetupPhase(phase);
      const seed = seedFor(phase);
      draftRef.current = seed;
      setDraftPoint(seed);
      setAimGuides(null);
    },
    [seedFor],
  );

  useEffect(() => {
    if ((setupPhase !== 'aim' && setupPhase !== 'ball' && setupPhase !== 'start') || !swing || swing.id !== id || swing.view !== 'dtl') return;
    if (calRef.current.locked) return;
    const epoch = aimEpoch.current;
    let cancelled = false;
    void (async () => {
      const frames: HTMLCanvasElement[] = [];
      const live = stageRef.current?.captureFrame() ?? null;
      if (live) frames.push(live);
      const impact = calRef.current.impactTime;
      if (blob) {
        const at = impact != null ? Math.max(0, impact - 0.4) : (swing?.trimIn ?? 0.15);
        const address = await frameAtTime(blob, at);
        if (address) frames.push(address);
      }
      if (cancelled || aimEpoch.current !== epoch) return;
      let best: { feet: ToeLine; confidence: number } | null = null;
      for (const frame of frames) {
        const found = await detectFeet(frame, import.meta.env.BASE_URL);
        if (found && (!best || found.confidence > best.confidence)) best = found;
      }
      if (cancelled || aimEpoch.current !== epoch || !best) return;
      feetRef.current = best.feet;
      setFeetTick((tick) => tick + 1);
      if (draftTouched.current || calRef.current.locked) return;
      if (setupPhaseRef.current === 'aim' && calRef.current.ball) {
        const straight = straightAheadAim({
          ball: calRef.current.ball,
          groundY: calRef.current.ground?.y ?? null,
          camera: cameraOf(),
          carryMeters: carryMeters(),
        });
        const next = parallelAim({
          ball: calRef.current.ball,
          feet: best.feet,
          depthY: calRef.current.ground?.y ?? straight.y,
        });
        if (!next || draftTouched.current || setupPhaseRef.current !== 'aim') return;
        setAimGuides({ toe: next.toe, parallel: next.parallel });
        draftRef.current = next.point;
        setDraftPoint(next.point);
        return;
      }
      if (setupPhaseRef.current === 'ball' && !calRef.current.ball) {
        const guess = ballGuess(best.feet);
        draftRef.current = guess;
        setDraftPoint(guess);
      }
      if (setupPhaseRef.current === 'start' && !calRef.current.manualStart && !calRef.current.ball && !draftTouched.current) {
        const guess = ballGuess(best.feet);
        draftRef.current = guess;
        setDraftPoint(guess);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setupPhase, id, swing?.id, swing?.view, swing?.trimIn, blob, cameraOf, carryMeters]);

  useEffect(() => {
    if (draftTouched.current) return;
    const guessingBall = setupPhase === 'ball' && !calRef.current.ball;
    const guessingStart = setupPhase === 'start' && !calRef.current.manualStart && !calRef.current.ball;
    if (!guessingBall && !guessingStart) return;
    const next = ballGuess(feetRef.current);
    draftRef.current = next;
    setDraftPoint(next);
  }, [setupPhase, feetTick]);

  useEffect(() => {
    hydratedFor.current = null;
    feetRef.current = null;
    aimEpoch.current += 1;
    setAimGuides(null);
    draftTouched.current = false;
    draftRef.current = null;
    setupPhaseRef.current = null;
    setSetupPhase(null);
    setDraftPoint(null);
    setFeetTick(0);
    setNumbersOpen(false);
    setShapesOpen(false);
    tracerUndo.current = null;
    tracerUndoStamp.current = 0;
    drawingUndoStamp.current = 0;
    undoStamp.current = 0;
    setTracerUndoReady(false);
    setTracerEngaged(false);
    setConfirmTracer(false);
    setImmersive(false);
    exportAbort.current?.abort();
    tracerRun.current = false;
    holdRef.current = 0;
    parkedAt.current = 0;
    restartUntil.current = 0;
    atEndRef.current = false;
    holdingRef.current = false;
    setTracerHold(0);
    setHolding(false);
  }, [id]);

  useEffect(() => () => barObserver.current?.disconnect(), []);

  useEffect(() => {
    if (!swing || swing.id !== id) return;
    if (hydratedFor.current === id) return;
    hydratedFor.current = id;
    if (tracerPending.current) return;
    setShot(swing.shot ?? emptyShot());
    setTracerCal(swing.tracer ?? defaultTracer());
  }, [swing, id]);

  useEffect(() => {
    return () => {
      if (tracerTimer.current) window.clearTimeout(tracerTimer.current);
      const pending = tracerPending.current;
      tracerPending.current = null;
      if (pending) void patch(pending);
    };
  }, [patch]);

  const placedCal = useMemo(() => {
    if (!draftPoint || setupPhase == null || setupPhase === 'edit' || setupPhase === 'impact' || setupPhase === 'lock') return activeCal;
    if (setupPhase === 'aim') return { ...activeCal, target: draftPoint };
    if (setupPhase === 'ball') return { ...activeCal, ball: draftPoint };
    if (setupPhase === 'horizon') return { ...activeCal, ground: draftPoint };
    if (setupPhase === 'start') return { ...activeCal, mode: 'manual' as const, manualStart: draftPoint };
    if (setupPhase === 'apex') return { ...activeCal, mode: 'manual' as const, manualApex: draftPoint };
    return { ...activeCal, mode: 'manual' as const, manualFinish: draftPoint };
  }, [activeCal, draftPoint, setupPhase]);

  const projectFor = useCallback(
    (cal: TracerCalibration) => {
      if (cal.mode === 'manual') {
        if (!cal.manualStart || !cal.manualApex || !cal.manualFinish) return null;
        return manualTrace(cal.manualStart, cal.manualApex, cal.manualFinish, cal.shape ?? 'straight');
      }
      if (!swing?.view || !cal.ball || !cal.target) return null;
      const flight = simulateShot(activeShot);
      if (!flight) return null;
      return projectFlight(
        flight.samples,
        {
          view: swing.view,
          height: cal.cameraHeight,
          distance: cal.cameraDistance,
          fov: cal.fov,
        },
        cal.ball,
        cal.target,
        swing.videoWidth || 9,
        swing.videoHeight || 16,
        cal.ground,
      );
    },
    [swing?.view, swing?.videoWidth, swing?.videoHeight, activeShot],
  );

  const tracerPath = useMemo(() => projectFor(activeCal), [projectFor, activeCal]);
  const previewPath = useMemo(
    () => (placedCal === activeCal ? tracerPath : projectFor(placedCal)),
    [placedCal, activeCal, tracerPath, projectFor],
  );

  const tracerFlight = tracerPath?.length ? tracerPath[tracerPath.length - 1].t : 0;
  flightRef.current = tracerFlight;
  const tuningTracer =
    setupPhase === 'horizon' ||
    setupPhase === 'apex' ||
    setupPhase === 'finish' ||
    setupPhase === 'impact' ||
    setupPhase === 'lock' ||
    setupPhase === 'edit' ||
    numbersOpen ||
    (toolsOpen && panelPage === 'tracer');
  const clipEnd = clipEndTime(clock.duration, swing?.trimIn, swing?.trimOut);
  const playback = playClock({
    videoTime: clock.time,
    clipEnd,
    impact: activeCal.impactTime,
    flightTime: tracerFlight,
    hold: tracerHold,
  });
  const tracerElapsed = tuningTracer ? null : tracerPlayhead(playback.playbackTime, activeCal.impactTime, tracerFlight);
  const showPaused = clock.paused && !holding;

  const setHoldingFlag = useCallback((next: boolean) => {
    if (holdingRef.current === next) return;
    holdingRef.current = next;
    setHolding(next);
  }, []);

  const clearTracerHold = useCallback(() => {
    tracerRun.current = false;
    parkedAt.current = 0;
    restartUntil.current = 0;
    atEndRef.current = false;
    setHoldingFlag(false);
    if (holdRef.current !== 0) {
      holdRef.current = 0;
      setTracerHold(0);
    }
  }, [setHoldingFlag]);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const engine = stageRef.current;
      if (!engine || !tracerRun.current) {
        last = now;
        return;
      }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      const end = clipEndTime(engine.getDuration(), trimInRef.current, trimOutRef.current);
      // Play was just pressed at the end. Ignore the stale end position until the seek leaves it.
      if (restartUntil.current) {
        const time = engine.getTime();
        if (now < restartUntil.current && end > 0 && time >= end - 0.2) return;
        restartUntil.current = 0;
      }
      const impact = calRef.current.impactTime;
      const flight = flightRef.current;
      let videoTime = engine.getTime();
      // Once the picture has ended, a small clock flicker must not freeze the rest of the descent.
      if (atEndRef.current && restartUntil.current === 0 && end > 0 && videoTime >= end - 0.2) {
        videoTime = Math.max(videoTime, end);
      }
      const clockNow = playClock({
        videoTime,
        clipEnd: end,
        impact,
        flightTime: flight,
        hold: holdRef.current,
      });
      if (!clockNow.pictureDone) {
        if (atEndRef.current && restartUntil.current === 0 && end > 0 && engine.getTime() < end - 0.2) {
          engine.pause();
          if (now - parkedAt.current > 300) {
            parkedAt.current = now;
            engine.seek(Math.max(0, end - 0.001));
          }
          return;
        }
        atEndRef.current = false;
        parkedAt.current = 0;
        if (holdRef.current !== 0) {
          holdRef.current = 0;
          setTracerHold(0);
        }
        setHoldingFlag(false);
        return;
      }
      // Freeze the last frame. The element must not keep playing or wrap back to the start.
      atEndRef.current = true;
      if (!engine.getPaused()) engine.pause();
      if (engine.getTime() > end + 0.04 && now - parkedAt.current > 300) {
        parkedAt.current = now;
        engine.seek(Math.max(0, end - 0.001));
      }
      const cap = holdSpan(end, impact, flight);
      const next = nextHold(holdRef.current, dt, rateRef.current, end, impact, flight);
      if (!(cap > 0) || next >= cap - 1e-4) {
        const settled = cap > 0 ? cap : 0;
        if (Math.abs(holdRef.current - settled) > 1e-6) {
          holdRef.current = settled;
          setTracerHold(settled);
        }
        tracerRun.current = false;
        setHoldingFlag(false);
        return;
      }
      if (next > holdRef.current + 0.0001) {
        holdRef.current = next;
        setTracerHold(next);
      }
      setHoldingFlag(true);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [setHoldingFlag]);

  useEffect(() => {
    let cancel = false;
    void listSwings()
      .then((rows) => {
        if (!cancel) setOthers(rows.filter((row) => row.id !== id));
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [id]);

  useEffect(() => {
    if (!overlayId) {
      setOverlayBlob(null);
      return;
    }
    let cancel = false;
    void getVideo(overlayId)
      .then((video) => {
        if (!cancel) setOverlayBlob(video);
      })
      .catch(() => {
        if (!cancel) {
          setOverlayBlob(null);
          setPlayError('Could not load that swing for the overlay.');
        }
      });
    return () => {
      cancel = true;
    };
  }, [overlayId]);

  const toggle = useCallback(async () => {
    const engine = stageRef.current;
    if (!engine) return;
    const end = clipEndTime(engine.getDuration(), trimInRef.current, trimOutRef.current);
    const clockNow = playClock({
      videoTime: engine.getTime(),
      clipEnd: end,
      impact: calRef.current.impactTime,
      flightTime: flightRef.current,
      hold: holdRef.current,
    });
    const playing = tracerRun.current || !engine.getPaused();
    if (playing) {
      tracerRun.current = false;
      setHoldingFlag(false);
      engine.pause();
      return;
    }
    // Paused on the last frame with flight still to draw: keep that frame and finish the tracer.
    if (clockNow.pictureDone && clockNow.holding) {
      tracerRun.current = true;
      setHoldingFlag(true);
      return;
    }
    // The clip, including a finished hold, is over. Start again. The line stays hidden until impact.
    if (clockNow.pictureDone) {
      restartUntil.current = performance.now() + 500;
      atEndRef.current = false;
      engine.seek(trimInRef.current ?? 0);
      holdRef.current = 0;
      parkedAt.current = 0;
      setTracerHold(0);
      setHoldingFlag(false);
      tracerRun.current = true;
      try {
        await engine.play();
        setPlayError(null);
      } catch (err) {
        tracerRun.current = false;
        restartUntil.current = 0;
        setPlayError(err instanceof Error ? err.message : 'Could not play.');
      }
      return;
    }
    tracerRun.current = true;
    try {
      await engine.play();
      setPlayError(null);
    } catch (err) {
      tracerRun.current = false;
      setPlayError(err instanceof Error ? err.message : 'Could not play.');
    }
  }, [setHoldingFlag]);

  const step = useCallback((dir: number) => {
    clearTracerHold();
    stageRef.current?.step(dir);
  }, [clearTracerHold]);

  const scrub = useCallback((time: number) => {
    const engine = stageRef.current;
    if (!engine) return;
    clearTracerHold();
    engine.pause();
    engine.seek(time);
  }, [clearTracerHold]);

  const showImpactChip = tracerEngaged || tracerIsSet(activeShot, activeCal);
  const canUndo = pastCount > 0 || hasDraft || tracerUndoReady;

  const commitDrawings = useCallback(
    (next: Drawing[]) => {
      undoStamp.current += 1;
      drawingUndoStamp.current = undoStamp.current;
      commit(next);
    },
    [commit],
  );

  const restoreTracer = useCallback(() => {
    const prev = tracerUndo.current;
    if (!prev) return;
    tracerUndo.current = null;
    tracerUndoStamp.current = 0;
    setTracerUndoReady(false);
    setTracerEngaged(true);
    rememberTracer(prev.shot, prev.tracer, true);
  }, [rememberTracer]);

  const undoAll = useCallback(() => {
    if (stageRef.current?.undoDraft()) return;
    const choice = chooseUndo({
      hasDraft: false,
      hasTracerUndo: tracerUndo.current != null,
      tracerStamp: tracerUndoStamp.current,
      drawingStamp: drawingUndoStamp.current,
      drawingSteps: pastCount,
    });
    if (choice === 'tracer') {
      restoreTracer();
      return;
    }
    if (choice === 'drawing') {
      undo();
      setSelectedId(null);
      if (pastCount <= 1) drawingUndoStamp.current = 0;
    }
  }, [pastCount, restoreTracer, undo]);

  const leaveSetup = useCallback(() => {
    setupPhaseRef.current = null;
    setSetupPhase(null);
    draftRef.current = null;
    setDraftPoint(null);
    draftTouched.current = false;
    setAimGuides(null);
    setShapesOpen(false);
  }, []);

  const beginSetup = useCallback(
    (redo = false) => {
      stageRef.current?.pause();
      clearTracerHold();
      setToolsOpen(false);
      setHelpOpen(false);
      setImmersive(false);
      setNumbersOpen(false);
      setShapesOpen(false);
      setTracerEngaged(true);
      const cal = calRef.current;
      if (!redo && setupStep(cal) === 'edit') {
        draftTouched.current = false;
        draftRef.current = null;
        setDraftPoint(null);
        setAimGuides(null);
        setupPhaseRef.current = 'edit';
        setSetupPhase('edit');
        return;
      }
      enterStep(redo ? 'aim' : setupStep(cal));
    },
    [clearTracerHold, enterStep],
  );

  const confirmDraft = useCallback(
    (point: Pt) => {
      if (calRef.current.locked) return;
      const phase = setupPhaseRef.current;
      const cal = calRef.current;
      if (phase === 'aim') {
        aimEpoch.current += 1;
        setAimGuides(null);
        rememberTracer(shotRef.current, { ...cal, target: point, aimSuggested: false, mode: 'data' }, true);
        enterStep('ball');
        return;
      }
      if (phase === 'ball') {
        rememberTracer(shotRef.current, { ...cal, ball: point, mode: 'data' }, true);
        enterStep('horizon');
        return;
      }
      if (phase === 'horizon') {
        rememberTracer(shotRef.current, { ...cal, ground: point, mode: 'data' }, true);
        enterStep('impact');
        return;
      }
      if (phase === 'start') {
        rememberTracer(shotRef.current, { ...cal, mode: 'manual', manualStart: point, shape: cal.shape ?? 'straight' }, true);
        enterStep('apex');
        return;
      }
      if (phase === 'apex') {
        rememberTracer(shotRef.current, { ...cal, mode: 'manual', manualApex: point }, true);
        enterStep('finish');
        return;
      }
      if (phase === 'finish') {
        rememberTracer(shotRef.current, { ...cal, mode: 'manual', manualFinish: point }, true);
        enterStep('impact');
      }
    },
    [enterStep, rememberTracer],
  );

  const onSetupGesture = useCallback(
    (point: Pt, phase: 'move' | 'up' | 'tap') => {
      if (calRef.current.locked) return;
      if (phase === 'move') {
        draftTouched.current = true;
        aimEpoch.current += 1;
        setAimGuides(null);
        draftRef.current = point;
        setDraftPoint(point);
        return;
      }
      if (phase === 'tap') {
        const current = draftRef.current;
        if (current) confirmDraft(current);
        return;
      }
      confirmDraft(point);
    },
    [confirmDraft],
  );

  const setupBack = useCallback(() => {
    if (calRef.current.locked) return;
    const phase = setupPhaseRef.current;
    if (!phase) return;
    if (phase === 'start') rememberTracer(shotRef.current, { ...calRef.current, mode: 'data' }, true);
    const next = previousStep(phase, calRef.current.mode);
    if (next) enterStep(next);
  }, [enterStep, rememberTracer]);

  const startOver = useCallback(() => {
    if (calRef.current.locked) return;
    aimEpoch.current += 1;
    setAimGuides(null);
    rememberTracer(shotRef.current, resetSetup(calRef.current), true);
    enterStep('aim');
  }, [enterStep, rememberTracer]);

  const playTracer = useCallback(() => {
    const engine = stageRef.current;
    if (!engine) return;
    tracerRun.current = true;
    void engine.play().catch(() => {
      tracerRun.current = false;
    });
  }, []);

  const commitImpact = useCallback(
    (time: number) => {
      if (calRef.current.locked) return;
      rememberTracer(shotRef.current, { ...calRef.current, impactTime: time }, true);
      setTracerNote(null);
      setTracerEngaged(true);
      const phase = setupPhaseRef.current;
      if (phase != null && phase !== 'edit') enterStep('lock');
    },
    [enterStep, rememberTracer],
  );

  const commitLock = useCallback(() => {
    const cal = calRef.current;
    const next = { ...cal, locked: true, setupDone: true };
    rememberTracer(shotRef.current, next, true);
    const askNumbers = next.mode !== 'manual' && !launchIsSet(shotRef.current);
    leaveSetup();
    setTracerEngaged(true);
    if (askNumbers) {
      setToolsOpen(false);
      setNumbersOpen(true);
      return;
    }
    playTracer();
  }, [leaveSetup, playTracer, rememberTracer]);

  const pickShape = useCallback(
    (shape: ShotShape) => {
      if (calRef.current.locked) return;
      const cal = calRef.current;
      rememberTracer(shotRef.current, { ...cal, mode: 'manual', shape }, true);
      setShapesOpen(false);
      enterStep('start');
    },
    [enterStep, rememberTracer],
  );

  const markImpact = useCallback(() => {
    const time = stageRef.current?.getTime() ?? 0;
    commitImpact(time);
  }, [commitImpact]);

  const toggleAim = useCallback(() => {
    rememberTracer(shotRef.current, { ...calRef.current, showAim: calRef.current.showAim !== true }, true);
  }, [rememberTracer]);

  const toggleTracerLine = useCallback(() => {
    const showing = calRef.current.showTracer !== false;
    rememberTracer(shotRef.current, { ...calRef.current, showTracer: !showing }, true);
  }, [rememberTracer]);

  const toggleLock = useCallback(() => {
    const next = { ...calRef.current, locked: calRef.current.locked !== true };
    rememberTracer(shotRef.current, next, true);
  }, [rememberTracer]);

  const clearTracer = useCallback(() => {
    const prevShot = shotRef.current;
    const prevTracer = calRef.current;
    if (tracerTimer.current) window.clearTimeout(tracerTimer.current);
    tracerTimer.current = null;
    tracerPending.current = null;
    const blankShot = emptyShot();
    const blankTracer = defaultTracer();
    setShot(blankShot);
    setTracerCal(blankTracer);
    shotRef.current = blankShot;
    calRef.current = blankTracer;
    feetRef.current = null;
    aimEpoch.current += 1;
    setAimGuides(null);
    leaveSetup();
    setNumbersOpen(false);
    setFeetTick(0);
    clearTracerHold();
    setTracerEngaged(false);
    setTracerNote(null);
    void patch({ shot: null, tracer: null })
      .then(() => {
        undoStamp.current += 1;
        tracerUndoStamp.current = undoStamp.current;
        tracerUndo.current = { shot: prevShot, tracer: prevTracer };
        setTracerUndoReady(true);
      })
      .catch(() => {
        setShot(prevShot);
        setTracerCal(prevTracer);
        shotRef.current = prevShot;
        calRef.current = prevTracer;
        setTracerEngaged(true);
        setPlayError('Could not clear the tracer.');
      });
  }, [clearTracerHold, leaveSetup, patch]);

  const canClear = drawings.length > 0 || hasDraft;

  const clearAll = useCallback(() => {
    stageRef.current?.undoDraft();
    if (drawings.length > 0) commitDrawings([]);
    setSelectedId(null);
    setConfirmClear(false);
  }, [commitDrawings, drawings.length]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commitDrawings(drawings.filter((drawing) => drawing.id !== selectedId));
    setSelectedId(null);
  }, [commitDrawings, drawings, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === ' ') {
        event.preventDefault();
        void toggle();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        removeSelected();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeSelected, step, toggle, undoAll]);

  function chooseTool(next: Tool) {
    setTool(next);
    setPinch(false);
    setToolsOpen(false);
    setPanelPage('draw');
  }

  function openMenu(page: 'draw' | 'edit') {
    if (toolsOpen && panelPage === page) {
      setToolsOpen(false);
      return;
    }
    setPanelPage(page);
    setToolsOpen(true);
  }

  function cycleRate() {
    const index = SPEEDS.findIndex((speed) => speed === rate);
    const next = SPEEDS[(index + 1) % SPEEDS.length] ?? 1;
    setRate(next);
  }

  function onTimePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const engine = stageRef.current;
    if (!engine) return;
    clearTracerHold();
    engine.pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, time: engine.getTime(), duration: engine.getDuration() };
    const move = (ev: PointerEvent) => {
      const span = Math.max(origin.duration, 0.01);
      const next = Math.min(span, Math.max(0, origin.time + ((ev.clientX - origin.x) / 160) * span));
      engine.seek(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function runDrive(action: () => Promise<void>) {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      await action();
      await reload();
      onChanged();
    } catch (err) {
      setDriveNote(errorMessage(err, 'Google Drive did not finish.'));
    } finally {
      setDriveBusy(false);
    }
  }

  if (load.status === 'cloud' && swing) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
            <Icon name="back" />
          </button>
          <div className="titles">
            <h1>{swing.club || 'Swing'}</h1>
            <p>
              {viewLabel(swing.view, true)} · On Google Drive
            </p>
          </div>
        </header>
        <div className="empty">
          <h2>Video is on Drive</h2>
          <p>The card, thumbnail, and drawings are still on this phone. The video itself was removed to free space.</p>
          {driveNote && <p className="banner">{driveNote}</p>}
          {DRIVE_ENABLED ? (
            <button
              type="button"
              className="btn primary"
              data-testid="download-drive"
              disabled={driveBusy}
              onClick={() => {
                void runDrive(async () => {
                  await downloadSwingVideo(swing, setDriveNote);
                });
              }}
            >
              Download from Drive
            </button>
          ) : (
            <p>This copy of Swingframe does not have Google sign-in, so the video cannot be downloaded.</p>
          )}
          <button type="button" className="btn" onClick={onBack}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  if (load.status !== 'ready' || !swing || !blob) {
    const message =
      load.status === 'loading'
        ? 'Loading swing…'
        : load.status === 'error'
          ? load.message
          : load.status === 'missing'
            ? load.message
            : "This swing isn't on this phone.";
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
            <Icon name="back" />
          </button>
          <div className="titles">
            <h1>Swing</h1>
          </div>
        </header>
        <div className="empty">
          <p>{message}</p>
          <button type="button" className="btn" onClick={onBack}>
            Back to library
          </button>
        </div>
      </div>
    );
  }

  const fps = swing.fps || 60;
  const mirrored = Boolean(swing.mirrored);
  const trimIn = swing.trimIn ?? null;
  const trimOut = swing.trimOut ?? null;

  const startExport = () => {
    if (!blob || exportAbort.current) return;
    const controller = new AbortController();
    exportAbort.current = controller;
    setExporting(true);
    setExportProgress(0);
    void recordTracerVideo({
      blob,
      drawings,
      impactTime: activeCal.impactTime,
      flightTime: tracerFlight,
      clipStart: trimIn ?? 0,
      clipEnd: trimOut ?? swing.duration ?? 0,
      videoWidth: swing.videoWidth || 0,
      videoHeight: swing.videoHeight || 0,
      marks: showAimMarks(activeCal),
      tracerPath: activeCal.showTracer !== false ? tracerPath : null,
      signal: controller.signal,
      onProgress: (fraction) => setExportProgress(fraction),
    })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        const extension = result.mime.includes('webm') ? 'webm' : 'mp4';
        const offered = await offerRecording(result.blob, `swingframe-tracer.${extension}`);
        if (controller.signal.aborted) return;
        setTracerNote(offered === 'downloaded' ? `${result.note} A download started.` : result.note);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTracerNote(error instanceof Error ? error.message : 'Export failed.');
      })
      .finally(() => {
        if (exportAbort.current === controller) exportAbort.current = null;
        setExporting(false);
      });
  };

  const setupKind =
    setupPhase === 'ball' || setupPhase === 'start'
      ? 'ball'
      : setupPhase === 'horizon' || setupPhase === 'finish'
        ? 'ground'
        : 'target';
  const placingPoint = setupPhase != null && showsPlacementReticle(setupPhase);
  const playbackStep = setupPhase === 'impact' || setupPhase === 'lock';
  const numbersMissing = activeCal.mode !== 'manual' && activeCal.impactTime != null && !launchIsSet(activeShot);
  const setupHint =
    setupPhase === 'aim'
      ? 'Set aim point'
      : setupPhase === 'ball'
        ? 'Set ball position'
        : setupPhase === 'horizon'
          ? 'Set horizon'
          : setupPhase === 'start'
            ? 'Set start'
            : setupPhase === 'apex'
              ? 'Set apex'
              : setupPhase === 'finish'
                ? 'Set finish'
                : null;

  return (
    <div
      className={cx(
        'screen player-screen',
        immersive && 'is-immersive',
        setupPhase && 'is-setup',
        playbackStep && 'is-setup-playback',
        setupPhase === 'edit' && 'is-setup-edit',
      )}
    >
      <div className="stage-wrap player-stage">
        <VideoStage
          ref={stageRef}
          blob={blob}
          drawings={drawings}
          tool={tool}
          color={color}
          selectedId={selectedId}
          fps={fps}
          rate={rate}
          muted={muted}
          mirrored={mirrored}
          panMode={pinch}
          trimIn={trimIn}
          trimOut={trimOut}
          overlayBlob={overlayBlob}
          onSelect={setSelectedId}
          onCommit={commitDrawings}
          onDraftChange={setHasDraft}
          immersive={immersive}
          onExitImmersive={() => setImmersive(false)}
          setupMarker={
            draftPoint && placingPoint
              ? {
                  point: draftPoint,
                  kind: setupKind,
                  toe: setupPhase === 'aim' ? aimGuides?.toe : undefined,
                  parallel: setupPhase === 'aim' ? aimGuides?.parallel : undefined,
                }
              : null
          }
          onSetupGesture={onSetupGesture}
          freezeDraw={setupPhase != null}
          tracerPath={
            activeCal.showTracer !== false && (tuningTracer || activeCal.impactTime != null) ? previewPath : null
          }
          tracerElapsed={tracerElapsed}
          tracerMarks={setupPhase == null || setupPhase === 'edit' ? showAimMarks(activeCal) : null}
        />
      </div>

      {immersive && (
        <button type="button" className="immersive-exit" data-testid="exit-full-screen" aria-label="Exit full screen" onClick={() => setImmersive(false)}>
          Exit
        </button>
      )}
      {exporting && (
        <div className="export-banner" data-testid="export-progress" role="status">
          <p>Exporting… {Math.round(exportProgress * 100)}%</p>
          <button type="button" onClick={() => exportAbort.current?.abort()}>
            Cancel
          </button>
        </div>
      )}

      {setupPhase && (
        <div className="setup-chrome">
          <div className="setup-nav">
            <button type="button" className="setup-nav-btn" aria-label="Cancel setup" data-testid="setup-cancel" onClick={leaveSetup}>
              <Icon name="close" />
            </button>
            <button
              type="button"
              className="setup-nav-btn"
              aria-label="Back"
              data-testid="setup-back"
              disabled={activeCal.locked === true || previousStep(setupPhase, activeCal.mode) == null}
              onClick={setupBack}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="setup-nav-btn"
              aria-label="Start over"
              data-testid="setup-start-over"
              disabled={activeCal.locked === true}
              onClick={startOver}
            >
              <Icon name="restart" />
            </button>
          </div>
          {setupHint && (
            <p className="setup-hint" data-testid="setup-hint">
              {setupHint}
            </p>
          )}
          {playbackStep &&
            createPortal(
            <div
              className="setup-playback"
              data-testid="impact-transport"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {setupPhase === 'impact' ? (
                <button type="button" className="setup-impact" data-testid="set-impact-setup" onClick={markImpact}>
                  Set impact time
                </button>
              ) : (
                <button type="button" className="setup-impact" data-testid="setup-lock" onClick={commitLock}>
                  <Icon name="lock" />
                  Lock
                </button>
              )}
              <div className="setup-transport">
                <Scrubber className="slim" value={clock.time} max={clock.duration} onScrub={scrub} testId="impact-scrubber" />
                <div className="setup-transport-row">
                  <button type="button" className="bar-icon" aria-label="Previous frame" data-testid="impact-back" onClick={() => step(-1)}>
                    <Icon name="stepBack" />
                  </button>
                  <button
                    type="button"
                    className="bar-icon bar-play"
                    aria-label={showPaused ? 'Play' : 'Pause'}
                    data-testid="impact-play"
                    onClick={() => void toggle()}
                  >
                    <Icon name={showPaused ? 'play' : 'pause'} />
                  </button>
                  <button type="button" className="bar-icon" aria-label="Next frame" data-testid="impact-forward" onClick={() => step(1)}>
                    <Icon name="stepForward" />
                  </button>
                </div>
              </div>
            </div>,
              document.body,
            )}
          {setupPhase !== 'edit' && (
            <div className={cx('manual-pill', shapesOpen && 'is-open')} data-testid="manual-trace">
              <button
                type="button"
                data-testid="manual-trace-toggle"
                aria-expanded={shapesOpen}
                onClick={() => setShapesOpen((open) => !open)}
              >
                <Icon name="tracer" />
                {!shapesOpen && <span>Manual trace</span>}
              </button>
              {shapesOpen &&
                (['draw', 'straight', 'fade'] as const).map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    data-testid={`shape-${shape}`}
                    aria-label={shape === 'draw' ? 'Draw' : shape === 'straight' ? 'Straight' : 'Fade'}
                    aria-pressed={activeCal.mode === 'manual' && activeCal.shape === shape}
                    onClick={() => pickShape(shape)}
                  >
                    <Icon name={shape === 'draw' ? 'shapeDraw' : shape === 'straight' ? 'shapeStraight' : 'shapeFade'} />
                    <span>{shape === 'draw' ? 'Draw' : shape === 'straight' ? 'Straight' : 'Fade'}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      <button type="button" className="float-btn float-close" aria-label="Close" data-testid="close-player" onClick={onBack}>
        <Icon name="close" />
      </button>
      <button type="button" className="time-pill" data-testid="time-pill" aria-label="Drag sideways to scrub" onPointerDown={onTimePointerDown}>
        {formatScrub(playback.playbackTime)}
      </button>
      <button
        type="button"
        className="float-btn float-help"
        aria-label="Help and swing details"
        data-testid="help"
        onClick={() => setHelpOpen(true)}
      >
        <Icon name="help" />
      </button>

      {showImpactChip && (
        <div className="tracer-quick" data-testid="tracer-quick">
          <button
            type="button"
            aria-label="Show aim point"
            aria-pressed={activeCal.showAim === true}
            data-testid="quick-aim"
            onClick={toggleAim}
          >
            <Icon name="crosshair" />
          </button>
          <button
            type="button"
            aria-label="Show tracer"
            aria-pressed={activeCal.showTracer !== false}
            data-testid="quick-tracer"
            onClick={toggleTracerLine}
          >
            <Icon name="tracer" />
          </button>
          <button
            type="button"
            aria-label={activeCal.locked ? 'Unlock tracer' : 'Lock tracer'}
            aria-pressed={activeCal.locked === true}
            data-testid="quick-lock"
            onClick={toggleLock}
          >
            <Icon name={activeCal.locked ? 'lock' : 'unlock'} />
          </button>
        </div>
      )}

      {pinch && <p className="pinch-banner">Drag to pan. Use two fingers to zoom. Tap the pencil to draw.</p>}
      {(saveError || playError) && <p className="player-banner">{saveError || playError}</p>}

      <div className="player-bar" ref={setBarNode}>
        {showImpactChip && activeCal.locked !== true && (
          <button type="button" className="tracer-impact-chip" data-testid="set-impact-bar" onClick={markImpact}>
            Set impact time
            {activeCal.impactTime != null && <small>{formatTime(activeCal.impactTime)}</small>}
          </button>
        )}
        <Scrubber className="slim" value={clock.time} max={clock.duration} onScrub={scrub} testId="play-scrubber" />
        <div className="bar-meta">
          <button type="button" className="speed-pill" data-testid="speed-pill" aria-label="Playback speed" onClick={cycleRate}>
            {formatRate(rate)}
          </button>
          <button
            type="button"
            className="speed-pill"
            data-testid="full-screen"
            aria-label="Full screen"
            onClick={() => {
              setToolsOpen(false);
              setHelpOpen(false);
              setImmersive(true);
            }}
          >
            Full
          </button>
          <button
            type="button"
            className="color-dot"
            data-testid="color-dot"
            aria-label="Current drawing color"
            style={{ background: color }}
            onClick={() => {
              setPanelPage('draw');
              setToolsOpen(true);
            }}
          />
          {trimIn != null || trimOut != null ? (
            <span className="trim-readout">
              {trimIn != null ? formatTime(trimIn) : '0:00.0'} – {trimOut != null ? formatTime(trimOut) : 'end'}
            </span>
          ) : null}
        </div>
        <div className="bar-transport">
          <button type="button" className="bar-icon" aria-label="Previous frame" data-testid="play-back" onClick={() => step(-1)}>
            <Icon name="stepBack" />
          </button>
          <button
            type="button"
            className="bar-icon bar-play"
            aria-label={showPaused ? 'Play' : 'Pause'}
            data-testid="play"
            onClick={() => void toggle()}
          >
            <Icon name={showPaused ? 'play' : 'pause'} />
          </button>
          <button type="button" className="bar-icon" aria-label="Next frame" data-testid="play-forward" onClick={() => step(1)}>
            <Icon name="stepForward" />
          </button>
          <button
            type="button"
            className="bar-icon bar-undo"
            aria-label="Undo"
            data-testid="bar-undo"
            disabled={!canUndo}
            onClick={undoAll}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className={cx('bar-icon', toolsOpen && panelPage === 'draw' && 'is-on')}
            aria-label="Drawing tools"
            aria-pressed={toolsOpen && panelPage === 'draw'}
            data-testid="draw-toggle"
            onClick={() => openMenu('draw')}
          >
            <Icon name="draw" />
          </button>
          <button
            type="button"
            className={cx('bar-icon bar-tracer', setupPhase != null && 'is-on')}
            aria-label="Tracer"
            aria-pressed={setupPhase != null}
            data-testid="tracer-toggle"
            onClick={() => beginSetup()}
          >
            <Icon name="tracer" />
          </button>
          <button
            type="button"
            className={cx('bar-icon', numbersOpen && 'is-on', numbersMissing && 'needs-numbers')}
            aria-label="Launch numbers"
            aria-pressed={numbersOpen}
            data-testid="numbers-toggle"
            onClick={() => {
              setNumbersOpen((open) => !open);
              setToolsOpen(false);
              setHelpOpen(false);
            }}
          >
            <Icon name="numbers" />
          </button>
          <button
            type="button"
            className={cx('bar-icon bar-wrench', toolsOpen && (panelPage === 'edit' || panelPage === 'trim' || panelPage === 'overlay' || panelPage === 'tracer') && 'is-on')}
            aria-label="Edit tools"
            aria-pressed={toolsOpen && (panelPage === 'edit' || panelPage === 'trim' || panelPage === 'overlay')}
            data-testid="tools-toggle"
            onClick={() => openMenu('edit')}
          >
            <Icon name="wrench" />
          </button>
        </div>
      </div>

      {toolsOpen && (
        <div
          className={cx('tool-backdrop', panelPage === 'tracer' && 'is-tracer')}
          data-testid="tool-panel"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setToolsOpen(false);
          }}
        >
          <div
            className="tool-panel"
            role="dialog"
            aria-label={panelPage === 'draw' ? 'Drawing tools' : panelPage === 'tracer' ? 'Tracer' : 'Edit tools'}
          >
            {panelPage === 'draw' && (
              <>
                <h2>Drawing</h2>
                <p className="panel-hint">{HINTS[tool]}</p>
                <div className="tool-grid">
                  {DRAW_TOOLS.map((item) => (
                    <ToolButton
                      key={item.id}
                      icon={item.icon}
                      label={item.label}
                      pressed={tool === item.id && !pinch}
                      testId={`tool-${item.id}`}
                      onClick={() => chooseTool(item.id)}
                    />
                  ))}
                  <ToolButton icon="undo" label="Undo" testId="tool-undo" disabled={!canUndo} onClick={undoAll} />
                </div>
                <button
                  type="button"
                  className="btn danger panel-clear"
                  data-testid="tool-clear"
                  disabled={!canClear}
                  onClick={() => setConfirmClear(true)}
                >
                  Clear all
                </button>
                <h2>Colors</h2>
                <div className="color-row" role="group" aria-label="Drawing color">
                  {DRAW_COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className="color-choice"
                      style={{ background: swatch }}
                      aria-label={`Color ${swatch}`}
                      aria-pressed={color === swatch}
                      data-testid={`color-${swatch.slice(1)}`}
                      onClick={() => {
                        setColor(swatch);
                        if (!selectedId) return;
                        commit(drawings.map((drawing) => (drawing.id === selectedId ? withColor(drawing, swatch) : drawing)));
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {panelPage === 'edit' && (
              <>
                <h2>Edit</h2>
                <div className="tool-grid">
                  <ToolButton
                    icon="flip"
                    label="Flip"
                    pressed={mirrored}
                    testId="edit-flip"
                    onClick={() => {
                      void patch({ mirrored: !mirrored }).catch(() => setPlayError('Could not save the flip.'));
                    }}
                  />
                  <ToolButton
                    icon="trim"
                    label="Trim"
                    pressed={trimIn != null || trimOut != null}
                    testId="edit-trim"
                    onClick={() => setPanelPage('trim')}
                  />
                  <ToolButton
                    icon="pinch"
                    label="Pinch"
                    pressed={pinch}
                    testId="edit-pinch"
                    onClick={() => {
                      setPinch((value) => !value);
                      setToolsOpen(false);
                    }}
                  />
                  <ToolButton
                    icon="overlay"
                    label="Overlay"
                    pressed={overlayBlob != null}
                    testId="edit-overlay"
                    onClick={() => setPanelPage('overlay')}
                  />
                  <ToolButton icon="tracer" label="Tracer" testId="edit-tracer" onClick={() => setPanelPage('tracer')} />
                </div>
              </>
            )}

            {panelPage === 'trim' && (
              <div className="panel-page">
                <h2>Trim</h2>
                <p className="panel-hint">Paused at {formatScrub(clock.time)}. Playback stays between the two marks.</p>
                <div className="panel-actions">
                  <button
                    type="button"
                    className="btn"
                    data-testid="trim-start"
                    onClick={() => {
                      const time = stageRef.current?.getTime() ?? 0;
                      const nextOut = trimOut != null && trimOut <= time ? null : trimOut;
                      void patch({ trimIn: time, trimOut: nextOut }).catch(() => setPlayError('Could not save the trim.'));
                    }}
                  >
                    Set start
                  </button>
                  <button
                    type="button"
                    className="btn"
                    data-testid="trim-end"
                    onClick={() => {
                      const time = stageRef.current?.getTime() ?? 0;
                      const nextIn = trimIn != null && trimIn >= time ? null : trimIn;
                      void patch({ trimIn: nextIn, trimOut: time }).catch(() => setPlayError('Could not save the trim.'));
                    }}
                  >
                    Set end
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void patch({ trimIn: null, trimOut: null }).catch(() => setPlayError('Could not save the trim.'));
                    }}
                  >
                    Clear
                  </button>
                </div>
                <button type="button" className="text-btn" onClick={() => setPanelPage('edit')}>
                  Back
                </button>
              </div>
            )}

            {panelPage === 'tracer' && (
              <TracerPanel
                view={swing.view}
                shot={activeShot}
                tracer={activeCal}
                busy={impactBusy}
                note={tracerNote}
                onShot={(next) => rememberTracer(next, calRef.current, true)}
                onTracer={(next) => {
                  const prev = calRef.current;
                  const immediate =
                    Boolean(next.locked) !== Boolean(prev.locked) ||
                    (next.showAim === true) !== (prev.showAim === true) ||
                    (next.showTracer !== false) !== (prev.showTracer !== false);
                  rememberTracer(shotRef.current, next, immediate);
                }}
                onDetect={() => {
                  setImpactBusy(true);
                  setTracerNote(null);
                  void detectImpactTime(blob, calRef.current.ball)
                    .then((time) => {
                      if (time == null) {
                        setTracerNote('Could not find the hit. Pause on that frame and tap Set impact time.');
                        return;
                      }
                      clearTracerHold();
                      stageRef.current?.pause();
                      stageRef.current?.seek(time);
                      commitImpact(time);
                    })
                    .catch(() => setTracerNote('Could not find the hit. Pause on that frame and tap Set impact time.'))
                    .finally(() => setImpactBusy(false));
                }}
                onMarkImpact={markImpact}
                onClear={() => setConfirmTracer(true)}
                canClear={tracerIsSet(activeShot, activeCal)}
                exporting={exporting}
                onExport={startExport}
                onBack={() => setToolsOpen(false)}
              />
            )}

            {panelPage === 'overlay' && (
              <div className="panel-page">
                <h2>Overlay</h2>
                <p className="panel-hint">A second swing sits on top, half transparent, and follows this one.</p>
                <div className="overlay-list">
                  {others.length === 0 && <p className="panel-hint">Save another swing first.</p>}
                  {others.map((other) => (
                    <button
                      key={other.id}
                      type="button"
                      className={cx('overlay-choice', overlayId === other.id && 'is-on')}
                      data-testid={`overlay-${other.id}`}
                      onClick={() => {
                        setOverlayId(other.id);
                        setToolsOpen(false);
                        setPanelPage('edit');
                      }}
                    >
                      <strong>{other.club || 'Swing'}</strong>
                      <span>
                        {viewLabel(other.view)} · {formatDate(other.date)}
                      </span>
                    </button>
                  ))}
                </div>
                {overlayId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setOverlayId(null);
                      setToolsOpen(false);
                    }}
                  >
                    Remove overlay
                  </button>
                )}
                <button type="button" className="text-btn" onClick={() => setPanelPage('edit')}>
                  Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {numbersOpen && (
        <div
          className="tool-backdrop is-tracer is-numbers"
          data-testid="numbers-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setNumbersOpen(false);
          }}
        >
          <div className="tool-panel" role="dialog" aria-label="Launch numbers">
            <TracerPanel
              numbersOnly
              view={swing.view}
              shot={activeShot}
              tracer={activeCal}
              busy={impactBusy}
              note={tracerNote}
              onShot={(next) => rememberTracer(next, calRef.current, true)}
              onTracer={(next) => rememberTracer(shotRef.current, next, true)}
              onDetect={() => undefined}
              onMarkImpact={markImpact}
              onClear={() => setConfirmTracer(true)}
              canClear={tracerIsSet(activeShot, activeCal)}
              exporting={exporting}
              onExport={startExport}
              onBack={() => setNumbersOpen(false)}
            />
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Help">
          <header className="topbar">
            <button type="button" className="icon-btn" aria-label="Close help" onClick={() => setHelpOpen(false)}>
              <Icon name="close" />
            </button>
            <div className="titles">
              <h1>{swing.club || 'Swing'}</h1>
              <p>
                {viewLabel(swing.view)} · {formatDate(swing.date)}
              </p>
            </div>
          </header>
          <div className="sheet-body">
            <p className="tip">
              The video stays on this page. Tap the pencil for drawing tools. Place a drawing with two fingers. Undo is on the white bar, and Clear all is in the drawing menu.
              Drag the time at the top, or the bar above the buttons, to scrub. Frame step is the arrows. The tracer icon walks through aim, ball, and horizon. Manual trace, at the bottom left, draws a flight through start, apex, and finish. Only the circle for the current step is on the picture. The undo arrow brings the previous circle back. On Set impact time and on Lock, a white bar at the bottom has the scrubber, frame step, and play, and those buttons sit above it. No setup circles are on the picture then. Lock opens launch numbers only when they are still empty. A manual trace never asks for numbers. After Lock, the aim pill shows the points. Unlock with the pill, then the round arrow starts setup over. The 123 icon opens the numbers any time. Clear tracer removes the line. Undo puts it back.
            </p>
            {swing.notes ? <p className="note-block">{swing.notes}</p> : null}
            <div className="fps-row" role="group" aria-label="Frame step size">
              <span>Step</span>
              {FPS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cx('chip tiny', fps === option && 'is-on')}
                  aria-pressed={fps === option}
                  onClick={() => {
                    void patch({ fps: option }).catch(() => setPlayError('Could not save the frame rate.'));
                  }}
                >
                  {option}
                </button>
              ))}
              <span className="faint">fps</span>
            </div>
            <div className="panel-actions">
              <button type="button" className={cx('btn', !muted && 'primary')} onClick={() => setMuted((value) => !value)}>
                {muted ? 'Sound off' : 'Sound on'}
              </button>
            </div>
            {driveNote && <p className="banner">{driveNote}</p>}
            <p className="faint" data-testid="help-version">
              Version {APP_VERSION}
            </p>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={() => setDetails(true)}>
                Edit details
              </button>
              <button
                type="button"
                className="btn"
                data-testid="help-clear"
                disabled={!canClear}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </button>
              {DRIVE_ENABLED && !googleConnected() && (
                <button
                  type="button"
                  className="btn"
                  data-testid="help-drive-connect"
                  disabled={driveBusy}
                  onClick={() => {
                    setDriveBusy(true);
                    setDriveNote(null);
                    void connectGoogle()
                      .then(() => setDriveNote('Connected to Google Drive.'))
                      .catch((err: unknown) => setDriveNote(errorMessage(err, 'Google sign-in did not finish.')))
                      .finally(() => setDriveBusy(false));
                  }}
                >
                  Connect Google Drive
                </button>
              )}
              {DRIVE_ENABLED && (
                <button
                  type="button"
                  className="btn"
                  data-testid="backup-swing"
                  disabled={driveBusy}
                  onClick={() => {
                    void runDrive(async () => {
                      await backupSwing({ ...swing, drawings }, blob, setDriveNote);
                    });
                  }}
                >
                  Back up to Drive
                </button>
              )}
              {DRIVE_ENABLED && swing.drive?.videoId && (
                <button type="button" className="btn" data-testid="free-swing" disabled={driveBusy} onClick={() => setConfirmFree(true)}>
                  Free up space
                </button>
              )}
              <button type="button" className="btn danger" data-testid="delete-swing" onClick={() => setConfirmDelete(true)}>
                Delete swing
              </button>
            </div>
          </div>
        </div>
      )}

      {details && (
        <DetailsSheet
          swing={swing}
          onClose={() => setDetails(false)}
          onSave={async (next) => {
            await patch(next);
            onChanged();
          }}
        />
      )}
      {confirmDelete && (
        <Dialog
          title="Delete this swing?"
          body="The video, thumbnail, and drawings will be removed from this phone."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          confirmTestId="confirm-delete-swing"
          onConfirm={() => {
            setConfirmDelete(false);
            void deleteSwing(swing.id)
              .then(() => {
                onChanged();
                onBack();
              })
              .catch((err: unknown) => {
                setPlayError(err instanceof Error ? err.message : 'Could not delete the swing.');
              });
          }}
        />
      )}
      {confirmFree && swing.drive?.videoId && (
        <Dialog
          title="Free up space?"
          body="The video stays on Google Drive. This phone keeps the card, thumbnail, and drawings. You can download the video again."
          confirmLabel="Remove video"
          danger
          confirmTestId="confirm-free-swing"
          onCancel={() => setConfirmFree(false)}
          onConfirm={() => {
            setConfirmFree(false);
            void runDrive(async () => {
              await releaseLocalVideo(swing.id);
              setDriveNote('Removed the video from this phone.');
            });
          }}
        />
      )}
      {confirmTracer && (
        <Dialog
          title="Clear the tracer?"
          body="The shot numbers, ball, target, and impact time will be removed, and the line will disappear. Undo puts them back."
          confirmLabel="Clear tracer"
          danger
          confirmTestId="confirm-clear-tracer"
          onCancel={() => setConfirmTracer(false)}
          onConfirm={() => {
            setConfirmTracer(false);
            clearTracer();
          }}
        />
      )}
      {confirmClear && (
        <Dialog
          title="Clear all drawings?"
          body="Every drawing on this swing will be removed. Undo puts them back."
          confirmLabel="Clear all"
          danger
          confirmTestId="confirm-clear"
          onCancel={() => setConfirmClear(false)}
          onConfirm={clearAll}
        />
      )}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  pressed,
  disabled,
  testId,
  onClick,
}: {
  icon: IconName;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="panel-tool"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
