// npm run build && node scripts/capture-screenshots.mjs
// Uses only the real built app, real network tiles and the app's file import UI.
// Optional: FHM_CAPTURE_URL=https://freehuntingmap.com (no local server started).
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public/img/features');
const notes = process.env.FHM_NOTES_DIR ?? '/workspace/fhm-seo-notes';
const raw = join(notes, 'raw');
await mkdir(output, { recursive: true });
await mkdir(raw, { recursive: true });
const base = process.env.FHM_CAPTURE_URL ?? 'http://127.0.0.1:4181';
const server = process.env.FHM_CAPTURE_URL ? null : await preview({ preview: { host: '127.0.0.1', port: 4181, strictPort: true, proxy: { '/tiles/trails/': { target: 'https://freehuntingmap.com', changeOrigin: true } } } });
let browser;
const demo = {
  type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-90.8255, 44.5181] }, properties: { name: 'Demo parking', icon: 'truck', categoryName: 'Access', note: 'Illustrative data, not an access recommendation.' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-90.8154, 44.5228] }, properties: { name: 'Demo stand', icon: 'stand', categoryName: 'Scouting', note: 'Demo waypoint; confirm ownership and permission.' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-90.8188, 44.5207] }, properties: { name: 'Demo sign', icon: 'rub', categoryName: 'Scouting' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-90.8202, 44.5201] }, properties: { name: 'Demo camera', icon: 'trailcam', categoryName: 'Scouting', fov: { bearing: 55, angle: 65, range: 55 }, camera: 'Demo camera', note: 'Illustrative view cone; verify the actual view on site.' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-90.8255,44.5181],[-90.824,44.5185],[-90.8225,44.5193],[-90.8221,44.5198],[-90.8203,44.5202],[-90.8188,44.5207],[-90.8181,44.5213],[-90.8168,44.5219],[-90.8154,44.5228]] }, properties: { name: 'Demo scouting walk', categoryName: 'Access', note: 'Illustrative planned line, not a verified trail or legal access route.' } },
  ],
};

try {
  for (let i = 0; i < 80; i++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    if (i === 79) throw new Error('Preview did not start');
    await new Promise(r => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1120, height: 760 }, deviceScaleFactor: 2, geolocation: { latitude: 44.51971, longitude: -90.81941, accuracy: 10 }, permissions: ['geolocation'], reducedMotion: 'reduce' });
  const page = await context.newPage();
  const tiles = { ok: 0, failed: [] };
  page.on('response', response => {
    if (/nationalmap.gov.*(?:tile\/|exportImage|export\?)/.test(response.url())) {
      if (response.ok()) tiles.ok++;
      else tiles.failed.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', error => console.error(error.message));
  // Vite preview has no R2 binding. Its proxy forwards versioned trail
  // requests to the deployed Worker; no geometry is substituted.
  const trailResponses = [];
  const dataResponses = [];
  page.on('response', async response => {
    if (response.url().includes('pdi.scinet.usda.gov')) dataResponses.push({ url: response.url(), status: response.status(), type: response.headers()['content-type'] });
    if (new URL(response.url()).pathname.startsWith('/tiles/trails/')) {
      const bytes = await response.body().then(body => body.length).catch(() => 0);
      trailResponses.push({ source: 'https://freehuntingmap.com' + new URL(response.url()).pathname, status: response.status(), bytes });
    }
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'demo-scouting.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(demo)) });
  await page.getByText('5 new / 5', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.maplibregl-ctrl-geolocate').click();
  await page.waitForTimeout(3000);
  // Focusing an imported track uses the app's own fitBounds behavior.
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  for (const [name, color] of [['Access', '#4094cb'], ['Scouting', '#91b85b']]) {
    await page.getByRole('button', { name: `Category menu ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Recolor', exact: true }).click();
    await page.getByRole('textbox', { name: 'Category name', exact: true }).waitFor();
    await page.getByLabel('Category color', { exact: true }).fill(color);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Open Demo scouting walk', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForTimeout(2500);
  // Fit a little more surrounding terrain around the illustrative walk.
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await settle();
  if (tiles.ok < 3) throw new Error(`Too few real map tiles loaded (${tiles.ok}); refusing to capture a blank map`);

  async function settle() {
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  async function capture(name) {
    await settle();
    await page.screenshot({ path: join(raw, `${name}.png`), animations: 'disabled' });
    console.log(`Captured ${name}`);
  }
  await capture('map');
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Land & Access layers', exact: true }).click();
  await page.getByRole('switch', { name: 'State wildlife', exact: true }).check();
  await page.getByRole('switch', { name: 'Other public', exact: true }).check();
  await page.locator('.sheet-body').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Land & Access layers', exact: true }).click();
  await page.getByRole('button', { name: 'Terrain layers', exact: true }).click();
  await page.locator('.sheet-body').evaluate(el => { el.scrollTop = 0; });
  await capture('layers');
  await page.getByRole('button', { name: 'Land & Access layers', exact: true }).click();
  await page.getByRole('button', { name: 'Terrain layers', exact: true }).click();
  await page.getByRole('switch', { name: 'Other public', exact: true }).uncheck();
  await page.getByRole('radio', { name: 'Satellite', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await capture('saved');
  await page.getByRole('button', { name: 'Open Demo camera', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate and range', exact: true }).waitFor();
  await capture('trailcam');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await page.getByRole('button', { name: 'Open Demo scouting walk', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('radio', { name: 'Topo', exact: true }).click();
  await page.getByRole('switch', { name: 'Hillshade', exact: true }).check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Trail finder', exact: true }).click();
  await page.getByRole('button', { name: 'Draw box', exact: true }).waitFor();
  await capture('terrain');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('switch', { name: 'Hillshade', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await capture('share');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Conditions', exact: true }).click();
  await page.locator('.spinner').waitFor({ state: 'detached' });
  await page.locator('.now').waitFor({ timeout: 30000 });
  await capture('conditions');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.getByRole('button', { name: 'Agriculture layers', exact: true }).click();
  await page.getByRole('switch', { name: 'Crops (2025)', exact: true }).check();
  await page.getByRole('slider', { name: 'Crops (2025) opacity', exact: true }).fill('1');
  await page.getByRole('slider', { name: 'Crops (2025) opacity', exact: true }).dispatchEvent('input');
  await page.getByRole('switch', { name: 'Crops (2025)', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  // Runtime-cache requests can outlive the page's networkidle event.
  await page.waitForTimeout(8000);
  await capture('crops');
  if (!dataResponses.some(r => r.status === 200)) throw new Error('No real crop imagery loaded');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('switch', { name: 'Crops (2025)', exact: true }).uncheck();
  await page.getByRole('button', { name: 'My Data layers', exact: true }).click();
  await page.getByRole('switch', { name: 'Saved items', exact: true }).check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Layers', exact: true }).waitFor();
  await capture('offline');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'demo-trail-view.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[-91.19,46.02],[-91.09,46.09]] }, properties: { name: 'Demo forest view', note: 'Framing guide only; not a route.' } })) });
  await page.getByText('1 new / 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await page.getByRole('button', { name: 'Open Demo forest view', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.getByRole('radio', { name: 'Topo', exact: true }).click();
  await page.getByRole('button', { name: 'Land & Access layers', exact: true }).click();
  await page.getByRole('button', { name: 'Terrain layers', exact: true }).click();
  await page.getByRole('button', { name: 'Trails layers', exact: true }).click();
  await page.getByRole('switch', { name: 'Public trails', exact: true }).check();
  await capture('trails');
  await writeFile(join(notes, 'capture-trails.json'), JSON.stringify(trailResponses, null, 2));
  if (!trailResponses.some(r => r.status === 200 && r.bytes > 100)) throw new Error('No actual public trail geometry loaded');
  await writeFile(join(notes, 'capture-sources.json'), JSON.stringify({ center: [44.51971, -90.81941], trailsView: 'Chequamegon-Nicolet National Forest near Hayward, Wisconsin', trailResponses, dataResponses, tiles }, null, 2));
  await page.getByRole('button', { name: 'My Data layers', exact: true }).click();
  await page.getByRole('switch', { name: 'Saved items', exact: true }).check();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Also capture the real mobile interface at 390 × 844, 2× density.
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await page.getByRole('button', { name: 'Open Demo scouting walk', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await settle();
  await page.screenshot({ path: join(raw, 'mobile.png'), animations: 'disabled' });
  console.log(JSON.stringify(tiles));

  execFileSync('python3', ['-c', `
from PIL import Image
from pathlib import Path
raw, output = Path(${JSON.stringify(raw)}), Path(${JSON.stringify(output)})
for name in ['map','layers','saved','trailcam','trails','crops','terrain','share','conditions','offline']:
    im = Image.open(raw / (name+'.png')).convert('RGB')
    for width in [560,780,1120]:
        resized = im.resize((width, round(im.height*width/im.width)), Image.Resampling.LANCZOS)
        resized.save(output / f'{name}-{width}.webp', quality=65, method=6)
        resized.save(output / f'{name}-{width}.avif', quality=36, speed=6)
`]);
  const shot = (await readFile(join(raw, 'map.png'))).toString('base64');
  const og = await context.newPage();
  await og.setViewportSize({ width: 1200, height: 630 });
  await og.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#141a16;color:#eef2ed;font-family:system-ui;display:flex;width:1200px;height:630px;align-items:center;padding:55px;gap:40px}h1{font-size:66px;letter-spacing:-3px;line-height:1.03;margin:30px 0;color:#b9ddb1}p{font-size:25px;line-height:1.4}section{width:450px;flex-shrink:0}.map{width:600px;height:500px;object-fit:cover;border-radius:16px;border:1px solid #53634f}.logo{width:55px;height:55px}span{font-size:20px}</style></head><body><section><h1>Free Hunting<br>Map</h1><span>freehuntingmap.com</span></section><img class="map" src="data:image/png;base64,${shot}" alt=""></body></html>`);
  await og.screenshot({ path: join(raw, 'og.png'), scale: 'css' });
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(${JSON.stringify(join(raw, 'og.png'))}).convert('RGB'); im.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(${JSON.stringify(join(root, 'public/og.png'))}, optimize=True)`]);
} finally {
  await browser?.close();
  server?.httpServer.close();
}
