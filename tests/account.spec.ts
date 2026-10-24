import { test, expect, type Locator } from '@playwright/test';
async function expectClippedFrame(control: Locator) {
  expect(await control.evaluate(el => {
    const r = el.getBoundingClientRect();
    const frame = el.querySelector('iframe')!;
    const f = frame.getBoundingClientRect();
    return {
      covers: f.left <= r.left && f.right >= r.right && f.top <= r.top && f.bottom >= r.bottom,
      inside: [[1,22],[43,22],[22,1],[22,43],[22,22]].every(([x,y]) => document.elementFromPoint(r.x+x, r.y+y) === frame),
      outside: [[-1,22],[45,22],[22,-1],[22,45]].every(([x,y]) => document.elementFromPoint(r.x+x, r.y+y) !== frame),
    };
  })).toEqual({ covers: true, inside: true, outside: true });
}

for (const width of [1440, 390]) {
  test(`toolbar account at ${width}px with late configuration`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: width === 390 ? 844 : 900 } });
    const page = await context.newPage();
    let release!: () => void;
    const configReady = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/config', async route => {
      await configReady;
      await route.fulfill({ json: { googleClientId: 'test-client' } });
    });
    await context.route('https://accounts.google.com/test-popup', route => route.fulfill({ contentType: 'text/html', body: '<title>Google sign-in test</title>' }));
    let signedIn = false;
    const user = { id: 'test-account', name: 'Devan' };
    await page.route('**/api/me', route => route.fulfill({ json: { user: signedIn ? user : null } }));
    await page.route('**/api/auth/google', route => { signedIn = true; return route.fulfill({ json: { user } }); });
    await page.route('**/api/sync', route => route.fulfill({ json: { cursor: 1, changes: [], hasMore: false } }));
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.google = { accounts: { id: {
        initialize(options) { window.testGoogleClient = options.client_id; window.testGoogleCallback = options.callback; },
        renderButton(parent, options) {
          const frame = document.createElement('iframe');
          frame.title = 'Sign in with Google';
          frame.style.cssText = 'width:64px;height:44px;margin:-2px -12px;border:0;display:block;position:relative';
          frame.srcdoc = '<style>body{margin:0;padding:2px 12px}button{box-sizing:border-box}</style><button aria-label="Sign in with Google" style="width:40px;height:40px" onclick="window.open(&quot;https://accounts.google.com/test-popup&quot;);parent.testGoogleCallback({credential:&quot;test-token&quot;})">G</button>';
          const wrapper = document.createElement('div');
          wrapper.append(frame); parent.append(wrapper);
        }, disableAutoSelect() {}
      } } };
    ` }));
    await page.goto(process.env.TRAIL_URL ?? 'http://127.0.0.1:4173');
    const account = page.locator('.account-control');
    await expect(account).toBeHidden();
    release();
    await expect(account.locator('iframe')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { testGoogleClient: string }).testGoogleClient)).toBe('test-client');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await expect(page.locator('.account-control')).toHaveCount(1);
    await expect(account).toBeVisible();
    await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/fixed-${width}.png` : testInfo.outputPath(`fixed-${width}.png`) });

    const control = account.locator('.account-sign-in-control');
    const box = (await control.boundingBox())!;
    expect(box.width).toBe(44); expect(box.height).toBe(44);
    expect(await control.evaluate(el => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + 22, r.y + 22)?.tagName;
    })).toBe('IFRAME');
    await expectClippedFrame(control);
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    const glyph = control.locator('svg');
    await expect(glyph).toHaveAttribute('width', '20');
    await expect(glyph).toHaveAttribute('height', '20');
    expect(await glyph.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('fill'))))
      .toEqual(['#4285F4', '#34A853', '#FBBC05', '#EA4335']);
    const neighbor = page.locator('.toolbar > button').first();
    const neighborBox = (await neighbor.boundingBox())!;
    expect(neighborBox.width).toBe(box.width);
    expect(neighborBox.height).toBe(box.height);
    await expect(neighbor.locator('svg')).toHaveAttribute('height', '22');
    if (process.env.FHM_SCREENSHOT_DIR) {
      await page.mouse.move(100, 100);
      await page.screenshot({ path: `${process.env.FHM_SCREENSHOT_DIR}/color-${width}.png` });
      await page.screenshot({ path: `${process.env.FHM_SCREENSHOT_DIR}/color-${width}-crop.png`, clip: {
        x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16),
        width: Math.min(76, width - Math.max(0, box.x - 16)), height: 120,
      } });
    }
    // Tab enters Google's frame; focus-within paints the ring on the native control.
    await page.locator('.toolbar > button').last().focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      if (await control.evaluate(el => el.contains(document.activeElement))) break;
    }
    expect(await control.evaluate(el => el.contains(document.activeElement))).toBe(true);
    expect(await control.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    const popupPromise = page.waitForEvent('popup');
    await page.mouse.click(box.x + 22, box.y + 22, { delay: 100 });
    const popup = await popupPromise;
    expect(popup.url()).toMatch(/^https:\/\/accounts\.google\.com/);
    await popup.close();
    const avatar = account.getByRole('button', { name: /Account: Devan/ });
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveCSS('width', '44px');
    await expect(avatar).toHaveCSS('height', '44px');
    await avatar.click();
    await expect(account.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(account.getByRole('button', { name: 'Delete account' })).toBeVisible();
    await expect(account.getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(account.getByRole('link', { name: 'Terms' })).toBeVisible();
    await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/fixed-account-${width}.png` : testInfo.outputPath(`fixed-account-${width}.png`) });
    await page.setViewportSize({ width: width === 390 ? 1440 : 390, height: width === 390 ? 900 : 844 });
    await expect(page.locator('.account-control')).toHaveCount(1);
    await expect(account.getByRole('button', { name: /Account: Devan/ })).toBeVisible();
    await expect.poll(() => account.evaluate(el => el.parentElement?.classList.contains('toolbar')))
      .toBe(width === 390);
    await context.close();
  });
}

for (const width of [1440, 390]) {
  test(`real GIS popup at ${width}px`, async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    test.skip(!process.env.FHM_REAL_GIS, 'Requires network and the authorized localhost:5180 origin');
    // Full Chromium models cross-origin iframe input more faithfully than headless shell.
    const isolatedBrowser = await browser.browserType().launch({ channel: 'chromium' });
    try {
      const context = await isolatedBrowser.newContext({ serviceWorkers: 'block', viewport: { width, height: width === 390 ? 844 : 900 } });
      const page = await context.newPage();
      await page.goto('http://localhost:5180');
      const control = page.locator('.account-sign-in-control');
      const iframe = control.locator('iframe');
      await expect(iframe).toBeVisible({ timeout: 30000 });
      await iframe.contentFrame().getByRole('button').waitFor();
      const googleFrame = await (await iframe.elementHandle())!.contentFrame();
      await googleFrame!.waitForLoadState('load');
      const box = (await control.boundingBox())!;
      expect(box.width).toBe(44); expect(box.height).toBe(44);
      await expectClippedFrame(control);
      expect(await control.evaluate(el => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.x + 22, r.y + 22)?.tagName;
      })).toBe('IFRAME');

      const googleButton = iframe.contentFrame().getByRole('button');
      const hit = (await googleButton.boundingBox())!;
      expect(hit.x + hit.width / 2).toBeCloseTo(box.x + 22, 2);
      expect(hit.y + hit.height / 2).toBeCloseTo(box.y + 22, 2);
      const popupPromise = page.waitForEvent('popup');
      // Locator actionability also waits for the cross-origin frame's input surface.
      await googleButton.click({ delay: 100 });
      const popup = await popupPromise;
      await popup.waitForURL('https://accounts.google.com/**');
      await popup.close();
      // Clear returned popup focus for the default-state screenshot.
      await page.evaluate(() => {
        document.body.tabIndex = -1;
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.mouse.move(100, 100);
      await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/native-${width}.png` : testInfo.outputPath(`native-${width}.png`) });
      await page.mouse.move(box.x + 22, box.y + 22);
      await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/native-hover-${width}.png` : testInfo.outputPath(`native-hover-${width}.png`) });
      await page.locator('.toolbar > button').last().focus();
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        if (await control.evaluate(el => el.contains(document.activeElement))) break;
      }
      expect(await control.evaluate(el => el.contains(document.activeElement))).toBe(true);
      expect(await control.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/native-focus-${width}.png` : testInfo.outputPath(`native-focus-${width}.png`) });
      console.log(`Real GIS ${width}: 44x44 iframe center hit; Tab focus ring; popup ${new URL(popup.url()).origin}`);
    } finally {
      await isolatedBrowser.close();
    }
  });
}
