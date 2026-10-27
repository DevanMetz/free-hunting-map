import { startCommunityVotes } from './community/votes';
import { registerSW } from 'virtual:pwa-register';
import { Repo } from './storage/repo';
import { startUsage } from './usage';
import type { Settings } from './ui/settings';
import './styles.css';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  // Register the offline shell while the map and local data are loading. This
  // also leaves registration independent of map initialization failures.
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
  if (location.pathname !== '/admin/analytics') startUsage();
  if (location.pathname === '/admin/analytics') await (await import('./ui/analytics')).renderAnalytics(root);
  else {
    // Fetch the map UI while IndexedDB opens, rather than serializing its large
    // MapLibre and layer dependencies behind local storage initialization.
    const local = Repo.open().then(async repo => {
      const [settings] = await Promise.all([
        repo.getMeta<Partial<Settings>>('settings'),
        startCommunityVotes(repo),
      ]);
      return { repo, settings };
    });
    const [{ repo, settings }, { App }] = await Promise.all([
      local, import('./ui/app'), import('./map/builtinLayers'),
    ]);
    // Votes and settings are ready before the map installs its overlays.
    try {
      await App.start(root, repo, settings);
    } finally {
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
