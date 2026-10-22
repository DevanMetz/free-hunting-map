import { registerSW } from 'virtual:pwa-register';
import { Repo } from './storage/repo';
import { App } from './ui/app';
import './styles.css';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  const repo = await Repo.open();
  await App.start(root, repo);
  // Ask the browser not to evict our IndexedDB data under storage pressure.
  void navigator.storage?.persist?.();
  registerSW({ immediate: true });
}

void main();
