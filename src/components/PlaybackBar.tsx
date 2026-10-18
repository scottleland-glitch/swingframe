import { useEffect, useState, type RefObject } from 'react';
import { SPEEDS } from '../constants';
import { formatTime, speedLabel } from '../format';
import { Icon } from './Icons';
import { Scrubber } from './Scrubber';
import type { VideoEngine } from './VideoStage';

export function PlaybackBar({
  engine,
  fps,
  rate,
  onRate,
  loop,
  onLoop,
  muted,
  onMuted,
  onToggle,
  onStep,
  onScrub,
  showRates = true,
  showExtras = true,
  compact = false,
  testId = 'play',
}: {
  engine: RefObject<VideoEngine | null>;
  fps: number;
  rate: number;
  onRate: (rate: number) => void;
  loop: boolean;
  onLoop: () => void;
  muted: boolean;
  onMuted: () => void;
  onToggle: () => void;
  onStep: (dir: number) => void;
  onScrub: (time: number) => void;
  showRates?: boolean;
  showExtras?: boolean;
  compact?: boolean;
  testId?: string;
}) {
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

  const frameNo = Math.round(clock.time * Math.max(1, fps));

  return (
    <div className={compact ? 'playback compact' : 'playback'}>
      <div className="transport">
        <button
          type="button"
          className="step-btn"
          aria-label="Previous frame"
          data-testid={`${testId}-back`}
          onClick={() => onStep(-1)}
        >
          <Icon name="stepBack" />
        </button>
        <button
          type="button"
          className="play-btn"
          aria-label={clock.paused ? 'Play' : 'Pause'}
          data-testid={testId}
          onClick={onToggle}
        >
          <Icon name={clock.paused ? 'play' : 'pause'} />
        </button>
        <button
          type="button"
          className="step-btn"
          aria-label="Next frame"
          data-testid={`${testId}-forward`}
          onClick={() => onStep(1)}
        >
          <Icon name="stepForward" />
        </button>
        {showRates && (
          <div className="seg" role="group" aria-label="Playback speed">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={rate === speed}
                data-testid={`${testId}-speed-${speed}`}
                onClick={() => onRate(speed)}
              >
                {speedLabel(speed)}
              </button>
            ))}
          </div>
        )}
        {showExtras && (
          <div className="transport-extra">
            <button type="button" className="icon-btn" aria-pressed={loop} aria-label="Loop" onClick={onLoop}>
              <Icon name="loop" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={!muted}
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={onMuted}
            >
              <Icon name={muted ? 'mute' : 'unmute'} />
            </button>
          </div>
        )}
      </div>
      <Scrubber value={clock.time} max={clock.duration} onScrub={onScrub} testId={`${testId}-scrubber`} />
      <div className="time-row">
        <span className="time">
          {formatTime(clock.time)}
          <span className="faint"> / {formatTime(clock.duration)}</span>
        </span>
        <span className="time">frame {frameNo}</span>
      </div>
    </div>
  );
}
