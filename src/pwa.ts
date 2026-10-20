export type OfflineStatus = 'checking' | 'installing' | 'ready' | 'update-ready' | 'error' | 'unsupported' | 'development';

export interface OfflineState {
  supported: boolean;
  online: boolean;
  status: OfflineStatus;
  offlineReady: boolean;
  updateAvailable: boolean;
  version?: string;
  error?: string;
}

export interface OfflineControls {
  /** User-triggered only: activates the waiting worker, then reloads this page once. */
  applyUpdate: () => void;
  checkForUpdate: () => Promise<void>;
  dispose: () => void;
}

export async function registerOffline(onState: (state: OfflineState) => void): Promise<OfflineControls> {
  const supported = 'serviceWorker' in navigator && window.isSecureContext;
  let disposed = false;
  let reloading = false;
  let state: OfflineState = {
    supported,
    online: navigator.onLine,
    status: supported ? 'checking' : 'unsupported',
    offlineReady: false,
    updateAvailable: false,
  };
  const update = (patch: Partial<OfflineState>) => {
    state = { ...state, ...patch };
    if (!disposed) onState(state);
  };
  const cleanups: Array<() => void> = [];
  let registration: ServiceWorkerRegistration | undefined;
  const controls: OfflineControls = {
    applyUpdate() {
      if (!registration?.waiting || reloading) return;
      reloading = true;
      registration.waiting.postMessage({ type: 'WRIENG_ACTIVATE_UPDATE' });
    },
    async checkForUpdate() {
      if (!registration) return;
      try { await registration.update(); }
      catch (error) { update({ error: error instanceof Error ? error.message : String(error) }); }
    },
    dispose() {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    },
  };

  onState(state);
  if (!supported) return controls;
  if (import.meta.env.DEV) {
    update({ status: 'development' });
    return controls;
  }

  const connection = () => update({ online: navigator.onLine });
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  cleanups.push(() => {
    window.removeEventListener('online', connection);
    window.removeEventListener('offline', connection);
  });

  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (data?.type !== 'WRIENG_OFFLINE_STATUS') return;
    update({
      offlineReady: data.offlineReady === true,
      version: typeof data.version === 'string' ? data.version : undefined,
      status: registration?.waiting ? 'update-ready' : data.offlineReady ? 'ready' : 'installing',
      updateAvailable: Boolean(registration?.waiting),
    });
  };
  const query = () => navigator.serviceWorker.controller?.postMessage({ type: 'WRIENG_GET_OFFLINE_STATUS' });
  const controlled = () => {
    if (reloading) window.location.reload();
    else query();
  };
  navigator.serviceWorker.addEventListener('message', receive);
  navigator.serviceWorker.addEventListener('controllerchange', controlled);
  cleanups.push(() => {
    navigator.serviceWorker.removeEventListener('message', receive);
    navigator.serviceWorker.removeEventListener('controllerchange', controlled);
  });

  try {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
      scope: base.pathname,
      updateViaCache: 'none',
    });
    const waiting = () => update({ status: 'update-ready', updateAvailable: true });
    const installing = () => {
      const worker = registration?.installing;
      if (!worker) return;
      if (!state.offlineReady) update({ status: 'installing' });
      const changed = () => {
        if (worker.state === 'installed') {
          if (navigator.serviceWorker.controller) waiting();
          else query();
        } else if (worker.state === 'redundant') {
          update({ status: state.offlineReady ? 'ready' : 'error', error: '离线资源未完整保存，请联网后重试。' });
        }
      };
      worker.addEventListener('statechange', changed);
      cleanups.push(() => worker.removeEventListener('statechange', changed));
      changed();
    };
    registration.addEventListener('updatefound', installing);
    cleanups.push(() => registration?.removeEventListener('updatefound', installing));
    if (registration.waiting) waiting();
    installing();
    query();
    // An active worker might not yet control this newly opened page.
    registration.active?.postMessage({ type: 'WRIENG_GET_OFFLINE_STATUS' });
  } catch (error) {
    update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
  }
  return controls;
}
