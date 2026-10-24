import { test, expect } from '@playwright/test';
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
    let signedIn = false;
    const user = { id: 'test-account', name: 'Devan' };
    await page.route('**/api/me', route => route.fulfill({ json: { user: signedIn ? user : null } }));
    await page.route('**/api/auth/google', route => { signedIn = true; return route.fulfill({ json: { user } }); });
    await page.route('**/api/sync', route => route.fulfill({ json: { cursor: 1, changes: [], hasMore: false } }));
    await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.google = { accounts: { id: {
        initialize(options) { window.testGoogleClient = options.client_id; window.testGoogleCallback = options.callback; },
        renderButton(parent, options) {
          const button = document.createElement('button');
          button.textContent = 'G'; button.setAttribute('aria-label', 'Sign in with Google');
          button.style.cssText = 'width:40px;height:40px';
          button.onclick = () => window.testGoogleCallback({ credential: 'test-token' });
          parent.append(button);
        }, disableAutoSelect() {}
      } } };
    ` }));
    await page.goto(process.env.TRAIL_URL ?? 'http://127.0.0.1:4173');
    const account = page.locator('.toolbar .account-control');
    await expect(account).toBeHidden();
    release();
    await expect(account.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { testGoogleClient: string }).testGoogleClient)).toBe('test-client');
    await page.getByRole('button', { name: 'Layers', exact: true }).click();
    await expect(page.locator('.account-control')).toHaveCount(1);
    await expect(account).toBeVisible();
    await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/fixed-${width}.png` : testInfo.outputPath(`fixed-${width}.png`) });
    await account.getByRole('button', { name: 'Sign in with Google' }).click();
    const avatar = account.getByRole('button', { name: /Account: Devan/ });
    await expect(avatar).toBeVisible();
    await avatar.click();
    await expect(account.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(account.getByRole('button', { name: 'Delete account' })).toBeVisible();
    await expect(account.getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(account.getByRole('link', { name: 'Terms' })).toBeVisible();
    await page.screenshot({ path: process.env.FHM_SCREENSHOT_DIR ? `${process.env.FHM_SCREENSHOT_DIR}/fixed-account-${width}.png` : testInfo.outputPath(`fixed-account-${width}.png`) });
    await context.close();
  });
}
