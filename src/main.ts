import { registerSW } from 'virtual:pwa-register';
import { Repo } from './storage/repo';
import { startUsage } from './usage';
import './styles.css';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  if (location.pathname !== '/admin/analytics') startUsage();
  if (location.pathname === '/admin/analytics') await (await import('./ui/analytics')).renderAnalytics(root);
  else { const repo = await Repo.open(); await (await import('./ui/app')).App.start(root, repo); }
  // Ask the browser not to evict our IndexedDB data under storage pressure.
  void navigator.storage?.persist?.();
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
}

void main();
