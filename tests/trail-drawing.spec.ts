import { test, expect } from '@playwright/test';
for (const mobile of [false, true]) {
  test(`box drawing ${mobile ? 'touch' : 'mouse'}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.TRAIL_URL ?? 'http://127.0.0.1:4173');
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('open-hunt-map');
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ view: { center: [-90.81941,44.51971], zoom: 14 } }, 'settings');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload();
    if (mobile) {
      await page.getByRole('button', { name: 'Layers', exact: true }).click();
      await page.getByRole('button', { name: 'Trail Finder layers', exact: true }).click();
      await page.getByRole('button', { name: 'Find trails', exact: true }).click();
    } else await page.getByRole('button', { name: 'Trail finder', exact: true }).click();
    await page.getByRole('button', { name: 'Draw box', exact: true }).click();
    const cdp = await context.newCDPSession(page);
    const touch = async (type: string, x: number, y: number) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }); };
    const x = mobile ? 130 : 700, y = mobile ? 180 : 250;
    if (mobile) { await touch('touchStart', x,y); await touch('touchMove',x+40,y+40); await touch('touchEnd',x+40,y+40); }
    else { await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+40,y+40,{steps:8}); await page.mouse.up(); }
    await expect(page.getByRole('button', { name: 'Draw box', exact: true })).toBeVisible();
    await expect(page.locator('.trail-box-size')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find trails', exact: true })).toBeEnabled();
    console.log({mobile, size:await page.locator('.trail-box-size').textContent(), errors});
    await page.getByRole('button',{name:'Draw box',exact:true}).click();
    for (const [a,b] of [[x,y],[x+40,y+40]]) { if(mobile) { await touch('touchStart',a,b); await touch('touchEnd',a,b); } else await page.mouse.click(a,b); await page.waitForTimeout(150); }
    await expect(page.getByRole('button',{name:'Draw box',exact:true})).toBeVisible();
    await expect(page.locator('.trail-box-size')).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('oversized default-zoom boxes stay compact and never query lidar', async ({ page }) => {
  const lidarRequests: string[] = [];
  page.on('request', r => { if (r.url().includes('usgs-lidar-public')) lidarRequests.push(r.url()); });
  await page.goto(process.env.TRAIL_URL ?? 'http://127.0.0.1:4173');
  await page.getByRole('button', { name: 'Trail finder', exact: true }).click();
  await page.getByRole('button', { name: 'Draw box', exact: true }).click();
  await page.mouse.move(500, 250); await page.mouse.down();
  await page.mouse.move(780, 530, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.trail-box-size')).toHaveText('>1 mi²');
  await expect(page.locator('.trail-box-size')).toHaveClass(/over/);
  await expect(page.getByRole('button', { name: 'Find trails', exact: true })).toBeDisabled();
  await page.waitForTimeout(600);
  expect(lidarRequests).toEqual([]);
});
