export type IconName =
  | 'back'
  | 'play'
  | 'pause'
  | 'stepBack'
  | 'stepForward'
  | 'undo'
  | 'trash'
  | 'clear'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'mute'
  | 'unmute'
  | 'select'
  | 'line'
  | 'pen'
  | 'angle'
  | 'circle'
  | 'box'
  | 'hline'
  | 'vline'
  | 'camera'
  | 'photos'
  | 'check'
  | 'close'
  | 'plus'
  | 'dtl'
  | 'face'
  | 'wrench'
  | 'flip'
  | 'trim'
  | 'pinch'
  | 'overlay'
  | 'tracer'
  | 'erase'
  | 'help'
  | 'draw'
  | 'crosshair'
  | 'lock'
  | 'unlock'
  | 'numbers'
  | 'shapeDraw'
  | 'shapeStraight'
  | 'shapeFade';

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      {paths(name)}
    </svg>
  );
}

function paths(name: IconName) {
  switch (name) {
    case 'back':
      return <path d="M15 5 8 12l7 7" />;
    case 'play':
      return <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" />;
    case 'pause':
      return (
        <>
          <path d="M8 5v14" />
          <path d="M16 5v14" />
        </>
      );
    case 'stepBack':
      return (
        <>
          <path d="M7 6v12" />
          <path d="M18 6 9 12l9 6V6Z" fill="currentColor" stroke="none" />
        </>
      );
    case 'stepForward':
      return (
        <>
          <path d="M17 6v12" />
          <path d="M6 6l9 6-9 6V6Z" fill="currentColor" stroke="none" />
        </>
      );
    case 'undo':
      return <path d="M8 8H4v4M4.5 8.5A8 8 0 1 1 6 17" />;
    case 'trash':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M9 7V5h6v2" />
          <path d="M7 7l1 13h8l1-13" />
        </>
      );
    case 'clear':
      return (
        <>
          <path d="M5 7h14" />
          <path d="M8 7l1 12h6l1-12" />
          <path d="M4 4l16 16" />
        </>
      );
    case 'zoomIn':
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="M11 8.5v5M8.5 11h5M16 16l3.5 3.5" />
        </>
      );
    case 'zoomOut':
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="M8.5 11h5M16 16l3.5 3.5" />
        </>
      );
    case 'fit':
      return (
        <>
          <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
        </>
      );
    case 'mute':
      return (
        <>
          <path d="M4 10h3l4-3v10l-4-3H4v-4Z" fill="currentColor" stroke="none" />
          <path d="M16 10l4 4M20 10l-4 4" />
        </>
      );
    case 'unmute':
      return (
        <>
          <path d="M4 10h3l4-3v10l-4-3H4v-4Z" fill="currentColor" stroke="none" />
          <path d="M16 9.5a4 4 0 0 1 0 5M18.5 7.5a7 7 0 0 1 0 9" />
        </>
      );
    case 'select':
      return <path d="M6 4l5 16 2.2-6.2L20 11 6 4Z" />;
    case 'line':
      return (
        <>
          <path d="M5 19 19 5" />
          <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
        </>
      );
    case 'pen':
      return <path d="M4 16c2-1 3-4 5-5s4-1 6-3 4-5 5-6c0 2-1 4-2 5s-2 3-4 5-4 3-5 5-3 2-5 2c0-1 .2-2 0-3Z" />;
    case 'angle':
      return (
        <>
          <path d="M5 19 12 7l7 12" />
          <path d="M9.2 15.2a4 4 0 0 1 5.6 0" />
        </>
      );
    case 'circle':
      return (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </>
      );
    case 'box':
      return <rect x="5" y="6" width="14" height="12" rx="1.5" />;
    case 'hline':
      return (
        <>
          <path d="M3 12h18" strokeDasharray="3 2" />
          <path d="M4 8v8M20 8v8" />
        </>
      );
    case 'vline':
      return (
        <>
          <path d="M12 3v18" strokeDasharray="3 2" />
          <path d="M8 4h8M8 20h8" />
        </>
      );
    case 'camera':
      return (
        <>
          <path d="M4 8h3l1.5-2h7L17 8h3v10H4V8Z" />
          <circle cx="12" cy="13" r="3" />
        </>
      );
    case 'photos':
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="m4 15 4-3 3 2 4-4 5 4" />
        </>
      );
    case 'check':
      return <path d="m5 12 5 5 9-10" />;
    case 'close':
      return <path d="M6 6l12 12M18 6 6 18" />;
    case 'plus':
      return <path d="M12 5v14M5 12h14" />;
    case 'dtl':
      return (
        <>
          <path d="M6 20V6" />
          <path d="M6 16 18 8" />
          <circle cx="6" cy="16" r="1.3" fill="currentColor" stroke="none" />
        </>
      );
    case 'face':
      return (
        <>
          <circle cx="12" cy="6.5" r="2" />
          <path d="M12 9v6M8 12h8M9 20l3-5 3 5" />
        </>
      );
    case 'wrench':
      return (
        <path d="M14.5 6.5a3.5 3.5 0 0 0-4.8 4.1L4 16.3 7.7 20l5.7-5.7a3.5 3.5 0 0 0 4.1-4.8L15 12l-3-3 2.5-2.5Z" />
      );
    case 'flip':
      return (
        <>
          <path d="M12 4v16" />
          <path d="M7 8 4 12l3 4" />
          <path d="M17 8l3 4-3 4" />
        </>
      );
    case 'trim':
      return (
        <>
          <path d="M4 8v8M20 8v8" />
          <path d="M8 12h8" />
          <path d="M6 8h3M15 8h3M6 16h3M15 16h3" />
        </>
      );
    case 'pinch':
      return (
        <>
          <path d="M8 8 5 5M16 8l3-3M8 16l-3 3M16 16l3 3" />
          <circle cx="12" cy="12" r="2" />
        </>
      );
    case 'overlay':
      return (
        <>
          <rect x="4" y="6" width="10" height="12" rx="1.4" />
          <rect x="10" y="4" width="10" height="12" rx="1.4" />
        </>
      );
    case 'tracer':
      return (
        <>
          <path d="M4 18c3.5-1 5.5-9 8-9s3.2 7 8 5" />
          <circle cx="19" cy="14" r="1.5" fill="currentColor" stroke="none" />
        </>
      );
    case 'erase':
      return (
        <>
          <path d="M4 16.5 12 8l5 5-6.5 6.5H4v-3Z" />
          <path d="M14 18h6" />
        </>
      );
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2.8-1.2 1.6" />
          <path d="M12 17h.01" />
        </>
      );
    case 'draw':
      return (
        <>
          <path d="M14.2 3.6 19.8 9.2l-6.6 6.6-5.4.8.8-5.4 5.6-7.6Z" />
          <path d="M12.8 5 18.2 10.4" />
          <path d="M3 19.4c1.6-1.5 2.2.6 3.6-.2 1.2-.7 1.7.9 3.1.1 1.3-.8 1.9.8 3.3 0" />
        </>
      );
    case 'crosshair':
      return (
        <>
          <circle cx="12" cy="12" r="5.25" />
          <path d="M12 2.25v3.5M12 18.25v3.5M2.25 12h3.5M18.25 12h3.5" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="11" width="14" height="9" rx="1.6" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </>
      );
    case 'unlock':
      return (
        <>
          <rect x="5" y="11" width="14" height="9" rx="1.6" />
          <path d="M8 11V8a4 4 0 0 1 7.6-1.4" />
        </>
      );
    case 'numbers':
      return (
        <text x="12" y="16" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="sans-serif">
          123
        </text>
      );
    case 'shapeDraw':
      return <path d="M8 20C16 16 18 10 10 4" />;
    case 'shapeStraight':
      return <path d="M12 20C13 14 13 9 12 4" />;
    case 'shapeFade':
      return <path d="M16 20C8 16 6 10 14 4" />;
    default: {
      const never: never = name;
      return never;
    }
  }
}
