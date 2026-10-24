import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

for (const mobile of [false, true]) {
  test(`layers registry ${mobile ? 'phone' : 'desktop'}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    const url = process.env.LAYERS_URL ?? 'http://127.0.0.1:5199';
    await page.goto(url);
    await page.getByRole('button', { name: 'Layers', exact: true }).waitFor();
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('open-hunt-map');
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ view: { center: [-90.81941, 44.51971], zoom: 12 } }, 'settings');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Topo', exact: true })).toHaveAttribute('aria-checked', 'true');
    const slope = page.getByRole('switch', { name: 'Slope', exact: true });
    await slope.check();
    const slider = page.getByRole('slider', { name: 'Slope opacity' });
    await expect(slider).toBeVisible();
    await slider.fill('0.42');
    await expect(page.locator('[aria-label="Slope legend"]')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Toggle Terrain', exact: true })).toHaveAttribute('aria-checked', 'mixed');
    await page.getByRole('checkbox', { name: 'Toggle Terrain', exact: true }).click();
    await expect(slope).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'Toggle Terrain', exact: true }).click();
    await expect(slope).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Aspect', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Water layers', exact: true }).click();
    await page.getByRole('switch', { name: 'Wetlands', exact: true }).check();
    await page.waitForTimeout(700); // Repo settings persistence is debounced by 400ms.
    await page.reload();
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await expect(slope).toBeChecked();
    await expect(slider).toHaveValue('0.42');
    await expect(page.getByRole('switch', { name: 'Wetlands', exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Water layers', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await mkdir('/workspace/fhm-layers-scratch/shots', { recursive: true });
    await page.screenshot({ path: `/workspace/fhm-layers-scratch/shots/job1-${mobile ? 'phone' : 'desktop'}-top.png` });
    await page.locator('[aria-label="Slope legend"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/workspace/fhm-layers-scratch/shots/job1-${mobile ? 'phone' : 'desktop'}.png` });
    const overflow = await page.locator('.layers-panel').evaluate(el => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(slope).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Wetlands', exact: true })).not.toBeChecked();
    await page.getByRole('radio', { name: 'Satellite', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Satellite', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Usage analytics', exact: true })).toBeAttached();
    expect(errors).toEqual([]);
    await context.close();
  });
}
