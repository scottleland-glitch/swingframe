const RELOAD_FLAG = 'swingframe.sw-reloaded';

function stripUpdatedParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('updated')) return;
  url.searchParams.delete('updated');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', next);
}

/** Check for a new worker on launch and whenever the app becomes visible. Reload once when it takes over. */
export function startServiceWorkerUpdates(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  stripUpdatedParam();

  let skipReload = sessionStorage.getItem(RELOAD_FLAG) === '1';
  if (skipReload) sessionStorage.removeItem(RELOAD_FLAG);
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const reloadOnce = () => {
    if (!hadController || reloading) return;
    if (skipReload) {
      skipReload = false;
      return;
    }
    reloading = true;
    sessionStorage.setItem(RELOAD_FLAG, '1');
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'swingframe-updated') reloadOnce();
  });

  const scope = import.meta.env.BASE_URL || '/swingframe/';
  const script = `${scope}sw.js`;
  const refresh = () => {
    void navigator.serviceWorker
      .register(script, { scope, updateViaCache: 'none' })
      .then(async (registration) => {
        await registration.update();
        if (registration.waiting && navigator.serviceWorker.controller) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      })
      .catch(() => undefined);
  };
  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('pageshow', refresh);
}
