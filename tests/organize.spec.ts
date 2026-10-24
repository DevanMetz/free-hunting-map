import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const baseURL = process.env.TRAIL_URL ?? 'http://localhost:5180';
const screenshotDir = process.env.FHM_SCREENSHOT_DIR ?? '/workspace/fhm-notes/organize';
const live = process.env.FHM_ORGANIZE_LIVE === '1';
const shot = process.env.FHM_SHOT_PREFIX ?? (live ? 'live-' : '');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
async function records(page: Page, store = 'items'): Promise<any[]> {
  return page.evaluate(store => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('open-hunt-map');
    request.onsuccess = () => { const db = request.result, tx = db.transaction(store); const all = tx.objectStore(store).getAll(); all.onsuccess = () => { resolve(all.result); db.close(); }; all.onerror = () => reject(all.error); };
    request.onerror = () => reject(request.error);
  }), store);
}
async function organize(page: Page): Promise<void> {
  if (await page.locator('[data-panel="list"]').isVisible()) return;
  await page.getByRole('button', { name: 'Organize', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeVisible();
}
async function createCategory(page: Page, name: string): Promise<void> {
  await organize(page);
  await page.getByRole('button', { name: 'New category', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New category', exact: true });
  await dialog.getByRole('textbox', { name: 'Category name' }).fill(name);
  await dialog.getByLabel('Category color').fill('#4ba97a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function createPin(page: Page, name: string, cam = false): Promise<void> {
  await page.getByRole('button', { name: 'Drop pin', exact: true }).click();
  if (cam) await page.getByRole('radio', { name: 'Trail cam', exact: true }).click();
  await page.locator('.maplibregl-canvas').click({ position: { x: (await page.viewportSize())!.width > 760 ? 800 : 240, y: 260 } });
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
}
async function saveItem(page: Page): Promise<void> {
  await page.locator('#sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#sheet')).not.toBeVisible();
}

for (const width of [1440, 390]) {
  test(`organize and trail cameras at ${width}px${live ? ' live offline' : ''}`, async ({ browser }) => {
    test.setTimeout(live ? 180000 : 120000);
    mkdirSync(screenshotDir, { recursive: true });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, serviceWorkers: live ? 'allow' : 'block' });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    if (!live) {
      await page.route('**/api/**', route => route.fulfill({ json: route.request().url().endsWith('/config') ? { googleClientId: '' } : { user: null } }));
      await page.route(/^https:\/\/(?!freehuntingmap\.com)/, route => route.request().url().endsWith('/planet') ? route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'], vector_layers: [] } }) : /\.pbf/.test(route.request().url()) ? route.fulfill({ body: Buffer.alloc(0), contentType: 'application/x-protobuf' }) : route.fulfill({ body: png, contentType: 'image/png' }));
    }
    await page.goto(baseURL);
    await expect(page.getByRole('button', { name: 'Organize', exact: true })).toBeVisible();
    await createCategory(page, 'North woods');
    await createCategory(page, 'Creek');
    await page.getByRole('button', { name: 'Category menu Creek', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit category' }).getByRole('textbox', { name: 'Category name' }).fill('Creek bend');
    await page.getByRole('dialog', { name: 'Edit category' }).getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Category menu Creek bend', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit category' }).getByRole('textbox', { name: 'Category name' }).fill('Creek');
    await page.getByRole('dialog', { name: 'Edit category' }).getByRole('button', { name: 'Save', exact: true }).click();
    const categories = (await records(page, 'records')).filter(r => r.kind === 'category');
    const north = categories.find(c => c.name === 'North woods'), creek = categories.find(c => c.name === 'Creek');
    expect(north).toBeTruthy(); expect(creek).toBeTruthy();
    await createPin(page, 'North stand');
    await page.getByLabel('Category', { exact: true }).selectOption(north.id);
    await saveItem(page);
    await createPin(page, 'Creek crossing');
    await page.getByLabel('Category', { exact: true }).selectOption(':new');
    const inlineCategory = page.getByRole('dialog', { name: 'New category', exact: true });
    await inlineCategory.getByRole('textbox', { name: 'Category name' }).fill('Temporary');
    await inlineCategory.getByRole('button', { name: 'Save', exact: true }).click();
    await saveItem(page); await organize(page);
    await page.getByRole('button', { name: 'Category menu Temporary', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete category' }).getByRole('button', { name: 'Keep items in Uncategorized' }).click();
    await expect(page.locator('.category-group[data-category=""]').getByRole('button', { name: 'Open Creek crossing' })).toBeVisible();
    await page.getByRole('button', { name: 'Draw track', exact: true }).click();
    await page.locator('.maplibregl-canvas').click({ position: { x: width > 760 ? 700 : 120, y: 220 } });
    await page.locator('.maplibregl-canvas').click({ position: { x: width > 760 ? 750 : 170, y: 270 } });
    await page.locator('#sheet').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Creek trail'); await saveItem(page);
    await context.grantPermissions(['geolocation']);
    const location = (await records(page)).find(i => i.name === 'North stand').coord;
    await context.setGeolocation({ longitude: location[0], latitude: location[1], accuracy: 5 });
    await page.getByRole('button', { name: 'Record GPS track', exact: true }).click();
    await expect(page.locator('.rec-chip')).toBeVisible();
    await page.waitForTimeout(300);
    await context.setGeolocation({ longitude: location[0] + .001, latitude: location[1] + .001, accuracy: 5 });
    await expect.poll(() => page.locator('.rec-chip').textContent()).not.toBe('0 ft');
    await page.getByRole('button', { name: 'Record GPS track', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Morning recording');
    await page.getByLabel('Category', { exact: true }).selectOption(north.id); await saveItem(page);
    await organize(page);
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select Creek crossing' }).check();
    await page.getByRole('checkbox', { name: 'Select Creek trail' }).check();
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.getByRole('dialog', { name: 'Move items' }).getByLabel('Category', { exact: true }).selectOption(creek.id);
    await page.getByRole('dialog', { name: 'Move items' }).getByRole('button', { name: 'Move', exact: true }).click();
    await expect.poll(async () => (await records(page)).filter(i => i.categoryId === creek.id)).toHaveLength(2);
    await page.getByRole('checkbox', { name: 'Select Creek crossing' }).check();
    await page.getByRole('checkbox', { name: 'Select Creek trail' }).check();
    await page.getByRole('button', { name: 'Hide selected', exact: true }).click();
    await expect.poll(async () => (await records(page)).filter(i => i.hidden)).toHaveLength(2);
    await page.getByRole('button', { name: 'Show selected', exact: true }).click();
    await expect.poll(async () => (await records(page)).filter(i => i.hidden)).toHaveLength(0);
    await page.getByRole('button', { name: 'Select items', exact: true }).click();
    await page.getByRole('button', { name: 'Hide category Creek', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Creek crossing' }).locator('..')).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Show category Creek', exact: true }).click();
    await page.getByRole('button', { name: 'Hide North stand', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open North stand' }).locator('..')).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Show North stand', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all pins', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open North stand' }).locator('..')).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Show all pins', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all trails', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Creek trail' }).locator('..')).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Show all trails', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all recordings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Morning recording' }).locator('..')).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Show all recordings', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all items', exact: true }).click();
    await expect.poll(async () => (await records(page)).filter(i => i.hidden)).toHaveLength(4);
    await page.getByRole('button', { name: 'Show all items', exact: true }).click();
    await expect.poll(async () => (await records(page)).filter(i => i.hidden)).toHaveLength(0);
    await page.getByRole('button', { name: 'Hide North stand', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all recordings', exact: true }).click();
    await expect(page.locator('.type-chip.is-off')).toHaveCount(1);
    await page.locator('.organize-filters').evaluate(row => { row.scrollLeft = 0; });
    await page.screenshot({ path: `${screenshotDir}/${shot}organize-${width}.png` });
    await page.getByRole('button', { name: 'Show all recordings', exact: true }).click();
    await page.getByRole('button', { name: 'Show North stand', exact: true }).click();
    await page.getByRole('button', { name: 'Open North stand' }).click();
    await page.getByRole('radio', { name: 'Stand', exact: true }).click();
    if (!(await page.locator('.item-details').evaluate(d => (d as HTMLDetailsElement).open))) await page.locator('.item-details > summary').click();
    await page.getByRole('button', { name: 'Use category style', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Pin', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: 'Stand', exact: true })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('radio', { name: 'Trail cam', exact: true }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Trail cam');
    await page.getByRole('button', { name: 'Use category style', exact: true }).click();
    await expect(page.locator('.sheet-title')).toHaveText('Waypoint');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await organize(page);
    await page.getByRole('searchbox').fill('Creek');
    await page.getByRole('button', { name: 'Trails', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Creek crossing' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open Creek trail' })).toBeVisible();
    await page.getByLabel('Filter category').selectOption(creek.id);
    await page.locator('.organize-filters').evaluate(row => { row.scrollLeft = 0; });
    await page.screenshot({ path: `${screenshotDir}/${shot}search-${width}.png` });
    await page.getByRole('button', { name: 'Open Creek trail' }).click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Creek trail');
    await saveItem(page);
    await createPin(page, 'Oak camera', true);
    await page.getByLabel('Category', { exact: true }).selectOption(north.id);
    if (width === 390) await page.locator('.item-details > summary').click();
    await page.getByRole('textbox', { name: 'Camera model' }).fill('Browning');
    if (width === 390) await page.locator('.item-details > summary').click();
    const tip = page.getByRole('button', { name: 'Rotate and range', exact: true });
    await expect(tip).toBeVisible();
    // Wait for the focus flight to finish before dragging an actual MapLibre marker.
    await page.waitForTimeout(1800);
    const box = (await tip.boundingBox())!;
    const before = Number(await page.getByRole('spinbutton', { name: 'Bearing °' }).inputValue());
    if (width === 390) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 22, y: box.y + 22 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 22 + i * 7, y: box.y + 22 + i * 3 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(box.x + 22, box.y + 22); await page.mouse.down(); await page.mouse.move(box.x + 92, box.y + 52, { steps: 12 }); await page.mouse.up();
    }
    await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Bearing °' }).inputValue())).not.toBe(before);
    const edge = page.getByRole('button', { name: 'Right field of view', exact: true });
    await edge.focus(); await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('spinbutton', { name: 'Angle °' })).toHaveValue('50');
    const bearing = Number(await page.getByRole('spinbutton', { name: 'Bearing °' }).inputValue());
    await page.getByRole('spinbutton', { name: 'Angle °' }).fill('60'); await page.getByRole('spinbutton', { name: 'Angle °' }).press('Tab');
    await expect(page.locator('.sheet-title')).toHaveText('Trail cam');
    await page.screenshot({ path: `${screenshotDir}/${shot}trailcam-${width}.png` });
    await saveItem(page);
    await expect(page.getByRole('button', { name: 'Rotate and range', exact: true })).toHaveCount(0);
    const savedCam = (await records(page)).find(i => i.name === 'Oak camera');
    expect(savedCam.fov.bearing).toBeCloseTo(bearing, 0); expect(savedCam.fov.angle).toBe(60);
    await organize(page);
    await page.getByRole('button', { name: 'Hide Oak camera', exact: true }).click();
    await page.getByRole('searchbox').fill('Browning');
    await page.getByRole('button', { name: 'Trail cams', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Oak camera' }).locator('..')).toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Open Oak camera' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Angle °' })).toHaveValue('60'); await saveItem(page);
    await expect.poll(async () => (await records(page)).find(i => i.name === 'Oak camera').hidden).toBe(false);
    await organize(page);
    await page.getByRole('button', { name: 'Hide all trail cams', exact: true }).click();
    await expect.poll(async () => (await records(page)).find(i => i.name === 'Oak camera').hidden).toBe(true);
    await expect(page.getByRole('button', { name: 'Open North stand' }).locator('..')).not.toHaveClass(/is-hidden/);
    await page.getByRole('button', { name: 'Show all trail cams', exact: true }).click();
    await expect.poll(async () => (await records(page)).find(i => i.name === 'Oak camera').hidden).toBe(false);
    await page.getByRole('button', { name: 'Hide category Creek', exact: true }).click();
    await page.getByRole('button', { name: 'Hide North stand', exact: true }).click();
    await page.getByRole('button', { name: 'Hide all trails', exact: true }).click();
    await expect.poll(async () => (await records(page, 'records')).find(r => r.kind === 'settings')?.preferences.showTrails).toBe(false);
    if (live) {
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30000 }).toBe(true);
      await context.setOffline(true);
    }
    await page.reload(); await organize(page);
    await expect(page.getByRole('button', { name: 'Open Oak camera' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open North stand' }).locator('..')).toHaveClass(/is-hidden/);
    await expect(page.getByRole('button', { name: 'Show category Creek', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show all trails', exact: true })).toBeVisible();
    expect((await records(page)).filter(i => !i.deleted)).toHaveLength(5);
    expect((await records(page, 'records')).filter(i => i.kind === 'category' && !i.deleted)).toHaveLength(2);
    await page.screenshot({ path: `${screenshotDir}/${live ? 'live-offline' : 'reload'}-${width}.png` });
    expect(errors).toEqual([]);
    await context.close();
  });
}
