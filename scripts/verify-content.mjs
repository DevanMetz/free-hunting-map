// Run after npm run build. Starts and stops its own preview on port 4182.
// Verifies clean URLs offline and saves content review screenshots outside git.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const notes = process.env.FHM_NOTES_DIR ?? '/workspace/fhm-seo-notes';
const shots = join(notes, 'shots');
await mkdir(shots, { recursive: true });
const base = 'http://127.0.0.1:4182';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4182', '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    if (i === 99) throw new Error('Preview did not start');
    await new Promise(r => setTimeout(r, 200));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Layers', exact: true }).waitFor();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const records = [];
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('link', { name: 'Features', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Free Hunting Map', exact: true }).waitFor();
  records.push({ path: '/features', navigation: 'in-app Layers footer link', offline: false, title: await page.title() });
  for (const offline of [true, false]) {
    await context.setOffline(offline);
    for (const [path, heading] of [['/features', 'Free Hunting Map'], ['/public-land/wisconsin', 'Wisconsin public hunting land'], ['/guides/', 'Map and scouting guides'], ['/guides/offline-maps', 'Using offline hunting maps in the woods'], ['/faq', 'Frequently asked questions'], ['/', null]]) {
      const response = await page.goto(base + path, { waitUntil: 'networkidle' });
      if (!response?.ok()) throw new Error(`${offline ? 'Offline' : 'Online'} ${path}: ${response?.status()}`);
      if (heading) await page.getByRole('heading', { level: 1 }).filter({ hasText: heading }).waitFor();
      else await page.getByRole('button', { name: 'Layers', exact: true }).waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`Horizontal overflow: ${path}`);
      records.push({ path, offline, status: response.status(), title: await page.title() });
    }
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const path of ['/features', '/guides/offline-maps', '/public-land/wisconsin']) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      // Bring lazy images through the viewport, then return to the top.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise(r => setTimeout(r, 80)); }
        scrollTo(0, 0);
        await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
      });
      await page.screenshot({ path: join(shots, `${path.slice(1).replaceAll('/', '-')}-${width}.png`), fullPage: true });
    }
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noJs.newPage();
  for (const path of ['/features', '/guides/', '/guides/offline-maps', '/public-land/wisconsin', '/faq']) {
    const response = await staticPage.goto(base + path);
    if (!response?.ok() || !await staticPage.getByRole('heading', { level: 1 }).isVisible()) throw new Error(`Content unavailable without JavaScript: ${path}`);
    records.push({ path, javaScript: false, status: response.status(), title: await staticPage.title() });
  }
  await noJs.close();
  await writeFile(join(notes, 'offline-check.json'), JSON.stringify(records, null, 2));
  console.log('Clean content URLs and / passed online and offline; content works without JavaScript; six review screenshots saved.');
} finally { await browser?.close(); server.kill('SIGTERM'); }
