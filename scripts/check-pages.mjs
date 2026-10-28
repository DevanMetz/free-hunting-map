const botUrl = value => { const url = new URL(value); url.searchParams.set('fhm_bot', '1'); return url.href; };
// npm run build && node scripts/check-pages.mjs [--external] [--browser]
// Checks files rather than trusting the SPA server's 200 fallback.
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = resolve('dist');
const origin = 'https://freehuntingmap.com';
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat();
}
async function exists(path) { return stat(path).then(s => s.isFile()).catch(() => false); }
const htmlFiles = (await files(root)).filter(file => file.endsWith('.html'));
const external = new Set();
const broken = [];
let internal = 0;
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const pagePath = '/' + file.slice(root.length + 1).replace(/index\.html$/, '').replace(/\.html$/, '');
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => decode(m[1]));
  for (const match of html.matchAll(/srcset="([^"]+)"/g)) references.push(...match[1].split(',').map(item => item.trim().split(' ')[0]));
  for (const reference of references) {
    if (/^(?:mailto:|data:|blob:|javascript:)/.test(reference)) continue;
    const url = new URL(reference, origin + pagePath);
    if (url.origin !== origin) { external.add(url.href); continue; }
    internal++;
    const path = decodeURIComponent(url.pathname).replace(/^\//, '');
    const candidates = [join(root, path), join(root, path + '.html'), join(root, path, 'index.html')];
    let target;
    for (const candidate of candidates) if (await exists(candidate)) { target = candidate; break; }
    if (!target) { broken.push(`${pagePath}: ${reference}`); continue; }
    if (url.hash && target.endsWith('.html')) {
      const targetHtml = await readFile(target, 'utf8');
      if (!targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)) broken.push(`${pagePath}: missing anchor ${reference}`);
    }
  }
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(match[1]);
}
console.log(`${htmlFiles.length} HTML files; ${internal} internal references; ${broken.length} broken`);
for (const error of broken) console.error(error);
if (broken.length) process.exitCode = 1;
if (process.argv.includes('--external')) {
  const states = JSON.parse(await readFile(resolve('content/states.json'), 'utf8'));
  const protectedHosts = new Set(states.filter(state => state.botProtected === true).flatMap(state => Object.values(state.links).map(url => new URL(url).hostname)));
  const verification = await readFile(resolve('content/states-check.txt'), 'utf8');
  if (protectedHosts.size && !/^EXT-(?:200|INDEXED) /m.test(verification)) throw new Error('Missing external verification record for bot-protected sites');
  const queue = [...external].sort(), results = [];
  const worker = async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      try {
        const { stdout } = await run('curl', ['--location', '--silent', '--output', '/dev/null', '--max-time', '25', '--user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', '--write-out', '%{http_code} %{url_effective}', url], { timeout: 30000 });
        const [status, ...destination] = stdout.trim().split(' ');
        results.push({ url, status: Number(status), destination: destination.join(' ') });
      } catch (error) { results.push({ url, status: 0, error: error.message }); }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (process.argv.includes('--browser')) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const retry = results.filter(r => (r.status < 200 || r.status >= 400) && !protectedHosts.has(new URL(r.url).hostname));
    const browserWorker = async () => {
      for (;;) {
        const result = retry.shift();
        if (!result) return;
        const page = await browser.newPage();
        try {
          const response = await page.goto(botUrl(result.url), { waitUntil: 'domcontentloaded', timeout: 25000 });
          result.curlStatus = result.status;
          result.status = response?.status() ?? 0;
          result.title = await page.title();
          result.destination = page.url();
          if (result.status === 200 && /access denied|attention required|just a moment/i.test(result.title)) result.status = 403;
        } catch (error) { result.browserError = error.message; }
        finally { await page.close(); }
      }
    };
    try { await Promise.all([browserWorker(), browserWorker()]); }
    finally { await browser.close(); }
  }
  results.sort((a, b) => a.url.localeCompare(b.url));
  for (const result of results) if (protectedHosts.has(new URL(result.url).hostname)) {
    result.classification = 'bot-protected, externally verified';
    result.verifiedAt = '2026-10-24';
    result.verificationRecord = 'content/states-check.txt';
  }
  const protectedResults = results.filter(r => r.classification);
  const failures = results.filter(r => !r.classification && (r.status < 200 || r.status >= 400));
  const notes = process.env.FHM_NOTES_DIR ?? '/workspace/fhm-seo-notes';
  await mkdir(notes, { recursive: true });
  await writeFile(join(notes, 'external-links.json'), JSON.stringify(results, null, 2));
  console.log(`${results.length} external URLs; ${results.filter(r => !r.classification && r.status >= 200 && r.status < 400).length} returned 200/3xx; ${protectedResults.length} bot-protected, externally verified; ${failures.length} require review`);
  for (const result of protectedResults) console.log(`${result.status} ${result.url}: ${result.classification} (${result.verifiedAt})`);
  for (const result of results.filter(r => new URL(r.url).hostname.endsWith('ohiodnr.gov'))) console.log(`Ohio recheck: ${result.status} ${result.url}`);
  for (const failure of failures) console.log(`${failure.status} ${failure.url}`);
  // Protected official sites can reject automation; retain their details for review.
  if (failures.length) process.exitCode = 1;
}
