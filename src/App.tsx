import { useEffect, useState } from 'react';
import { AddSwingSheet } from './components/AddSwingSheet';
import { LibraryView } from './components/LibraryView';
import { PlayerView } from './components/PlayerView';
import { WelcomeView } from './components/WelcomeView';
import type { Route } from './types';

type Hist = { route: Route; adding: boolean };

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== 'object') return false;
  const name = (value as { name?: unknown }).name;
  if (name === 'welcome' || name === 'library') return true;
  if (name === 'player') return typeof (value as { id?: unknown }).id === 'string';
  return false;
}

function readHist(): Hist {
  const state = window.history.state as Partial<Hist> | null;
  if (state && isRoute(state.route)) return { route: state.route, adding: Boolean(state.adding) };
  return { route: { name: 'welcome' }, adding: false };
}

export function App() {
  const initial = readHist();
  const [route, setRoute] = useState<Route>(initial.route);
  const [adding, setAdding] = useState(initial.adding);
  const [version, setVersion] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isRoute((window.history.state as Partial<Hist> | null)?.route)) {
      window.history.replaceState({ route: { name: 'welcome' }, adding: false } satisfies Hist, '');
    }
    const onPop = (event: PopStateEvent) => {
      const state = event.state as Partial<Hist> | null;
      if (!state || !isRoute(state.route)) {
        setRoute({ name: 'welcome' });
        setAdding(false);
        return;
      }
      setRoute(state.route);
      setAdding(Boolean(state.adding));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(next: Route) {
    const hist: Hist = { route: next, adding: false };
    window.history.pushState(hist, '');
    setRoute(next);
    setAdding(false);
  }

  function back() {
    window.history.back();
  }

  function openAdd() {
    const hist: Hist = { route, adding: true };
    window.history.pushState(hist, '');
    setAdding(true);
  }

  function closeAdd() {
    const state = window.history.state as Partial<Hist> | null;
    if (state?.adding) window.history.back();
    else setAdding(false);
  }

  const libraryKey = route.name === 'library' ? String(version) : 'hidden';

  return (
    <div className="app-shell">
      {route.name === 'welcome' && (
        <WelcomeView onNewSession={openAdd} onHistory={() => navigate({ name: 'library' })} />
      )}
      {route.name === 'library' && (
        <LibraryView
          key={libraryKey}
          onOpen={(id) => navigate({ name: 'player', id })}
          onAdd={openAdd}
          onHome={() => navigate({ name: 'welcome' })}
        />
      )}
      {route.name === 'player' && (
        <PlayerView key={route.id} id={route.id} justSaved={savedId === route.id} onBack={back} onChanged={() => setVersion((value) => value + 1)} />
      )}
      {adding && (
        <AddSwingSheet
          onClose={closeAdd}
          onSaved={(id) => {
            setVersion((value) => value + 1);
            setSavedId(id);
            // Open the saved swing right away. Replace the add-sheet history entry so Back returns to where they started.
            const next: Route = { name: 'player', id };
            const state = window.history.state as Partial<Hist> | null;
            const hist: Hist = { route: next, adding: false };
            if (state?.adding) window.history.replaceState(hist, '');
            else window.history.pushState(hist, '');
            setRoute(next);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}
