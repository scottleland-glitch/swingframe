import { useEffect, useState } from 'react';
import { AddSwingSheet } from './components/AddSwingSheet';
import { CompareView } from './components/CompareView';
import { LibraryView } from './components/LibraryView';
import { PlayerView } from './components/PlayerView';
import type { Route } from './types';

type Hist = { route: Route; adding: boolean };

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== 'object') return false;
  const name = (value as { name?: unknown }).name;
  if (name === 'library') return true;
  if (name === 'player') return typeof (value as { id?: unknown }).id === 'string';
  if (name === 'compare') {
    const pair = value as { a?: unknown; b?: unknown };
    return typeof pair.a === 'string' && typeof pair.b === 'string';
  }
  return false;
}

function readHist(): Hist {
  const state = window.history.state as Partial<Hist> | null;
  if (state && isRoute(state.route)) return { route: state.route, adding: Boolean(state.adding) };
  return { route: { name: 'library' }, adding: false };
}

export function App() {
  const initial = readHist();
  const [route, setRoute] = useState<Route>(initial.route);
  const [adding, setAdding] = useState(initial.adding);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!isRoute((window.history.state as Partial<Hist> | null)?.route)) {
      window.history.replaceState({ route: { name: 'library' }, adding: false } satisfies Hist, '');
    }
    const onPop = (event: PopStateEvent) => {
      const state = event.state as Partial<Hist> | null;
      if (!state || !isRoute(state.route)) {
        setRoute({ name: 'library' });
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

  const libraryKey =
    route.name === 'library'
      ? `${version}-${route.picking ? 'pick' : 'browse'}-${(route.picked ?? []).join(',')}`
      : 'hidden';

  return (
    <div className="app-shell">
      {route.name === 'library' && (
        <LibraryView
          key={libraryKey}
          picking={Boolean(route.picking)}
          initialPicked={route.picked ?? []}
          onOpen={(id) => navigate({ name: 'player', id })}
          onCompare={(a, b) => navigate({ name: 'compare', a, b })}
          onAdd={openAdd}
        />
      )}
      {route.name === 'player' && (
        <PlayerView
          key={route.id}
          id={route.id}
          onBack={back}
          onCompare={(id) => navigate({ name: 'library', picking: true, picked: [id] })}
          onChanged={() => setVersion((value) => value + 1)}
        />
      )}
      {route.name === 'compare' && <CompareView key={`${route.a}:${route.b}`} a={route.a} b={route.b} onBack={back} />}
      {adding && (
        <AddSwingSheet
          onClose={closeAdd}
          onSaved={() => {
            setVersion((value) => value + 1);
            closeAdd();
          }}
        />
      )}
    </div>
  );
}
