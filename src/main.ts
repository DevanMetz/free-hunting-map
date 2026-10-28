import { startCommunityVotes } from './community/votes';
import { registerSW } from 'virtual:pwa-register';
import { Repo } from './storage/repo';
import { startUsage } from './usage';
import type { Settings } from './ui/settings';
import './styles.css';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  // Register independently of map initialization failures.
  const registerOfflineShell = () => {
    let controlled = !!navigator.serviceWorker?.controller;
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      if (controlled) location.reload();
      controlled = true;
    });
    registerSW({ immediate: true, onRegisteredSW(_url, registration) {
      const update = () => { if (navigator.onLine) void registration?.update().catch(() => {}); };
      window.addEventListener('online', update);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
      window.setInterval(update, 60 * 60 * 1000);
    } });
  };
  if (location.pathname === '/admin/analytics') {
    const analytics = import('./ui/analytics');
    registerOfflineShell();
    await (await analytics).renderAnalytics(root);
  }
  else {
    // Fetch the map UI while IndexedDB opens, rather than serializing its large
    // MapLibre and layer dependencies behind local storage initialization.
    const appCode = import('./ui/app');
    const layers = import('./map/builtinLayers');
    const local = Repo.open().then(async repo => {
      const items = Promise.all([repo.list(), repo.categories()] as const);
      // The UI may still be downloading when an IndexedDB read fails.
      void items.catch(() => {});
      const [settings, flushVotes] = await Promise.all([
        repo.getMeta<Partial<Settings>>('settings'),
        startCommunityVotes(repo),
      ]);
      return { repo, settings, items, flushVotes };
    });
    // Start the critical downloads and IndexedDB open before service worker
    // registration can schedule competing network and cache work.
    registerOfflineShell();
    // Analytics reads browser storage and starts network requests. Launch the
    // map's critical downloads and IndexedDB open before doing that work.
    startUsage();
    const [{ repo, settings, items, flushVotes }, { App }] = await Promise.all([local, appCode, layers]);
    // Votes and settings are ready before the map installs its overlays.
    try {
      await App.start(root, repo, settings, items);
    } finally {
      flushVotes();
      // Start even if map initialization fails; both services flush immediately.
      void import('./community/queue').then(({ startCommunityUploads }) => startCommunityUploads(repo))
        .catch(err => console.error('Community uploads could not start:', err));
      void import('./community/hikes').then(({ startCommunityHikes }) => startCommunityHikes(repo))
        .catch(err => console.error('Community hikes could not start:', err));
    }
  }
  // Ask the browser not to evict our IndexedDB data under storage pressure.
  void navigator.storage?.persist?.();
}

void main();
