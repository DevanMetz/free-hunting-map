// With a preview running on 4180:
// CHROME_PATH=/usr/bin/google-chrome npx -y --package=lighthouse@12 -c 'node scripts/audit-pages.mjs'
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const run = promisify(execFile);
const output = join(process.env.FHM_NOTES_DIR ?? '/workspace/fhm-seo-notes', 'lighthouse');
await mkdir(output, { recursive: true });
const base = process.env.FHM_AUDIT_URL ?? 'http://127.0.0.1:4180';
const scores = [];
for (const mode of ['mobile', 'desktop']) {
  for (const path of ['/features', '/guides/', '/guides/offline-maps', '/public-land/wisconsin', '/faq']) {
    const file = join(output, `${path.slice(1).replaceAll('/', '-').replace(/-$/, '')}-${mode}.json`);
    await run('lighthouse', [base + path, '--quiet', '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage', '--only-categories=performance,accessibility,best-practices,seo', '--output=json', '--output-path=' + file, ...(mode === 'desktop' ? ['--preset=desktop'] : [])], { env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' }, timeout: 90000, maxBuffer: 1024 * 1024 });
    const report = JSON.parse(await readFile(file, 'utf8'));
    const score = { path, mode, ...Object.fromEntries(Object.entries(report.categories).map(([key, value]) => [key, Math.round(value.score * 100)])) };
    scores.push(score);
    console.log(JSON.stringify(score));
  }
}
await writeFile(join(output, 'scores.json'), JSON.stringify(scores, null, 2));
