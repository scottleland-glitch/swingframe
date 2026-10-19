import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '../version';
import { Icon } from './Icons';

const HERO = `${import.meta.env.BASE_URL}welcome/hero-stack.jpg`;

export function WelcomeView({ onNewSession, onHistory }: { onNewSession: () => void; onHistory: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="screen welcome" data-testid="welcome">
      <img className="welcome-hero" src={HERO} alt="" />
      <div className="welcome-fade" />
      <header className="welcome-head">
        <h1 className="welcome-word">Swingframe</h1>
        <p className="welcome-sub">Swing analysis and shot tracer</p>
        <p className="welcome-version" data-testid="welcome-version">
          Version {APP_VERSION}
        </p>
      </header>
      <div className="welcome-actions" ref={menuRef}>
        <button
          type="button"
          className="welcome-plus"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          data-testid="welcome-plus"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="plus" />
        </button>
        {menuOpen && (
          <div className="welcome-menu" role="menu" data-testid="welcome-menu">
            <button
              type="button"
              role="menuitem"
              data-testid="welcome-new"
              onClick={() => {
                setMenuOpen(false);
                onNewSession();
              }}
            >
              New session
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="welcome-history"
              onClick={() => {
                setMenuOpen(false);
                onHistory();
              }}
            >
              History
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
