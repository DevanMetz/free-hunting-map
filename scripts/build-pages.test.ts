// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import type { Window } from 'happy-dom';
import { buildPages, generatedFiles } from './build-pages.mjs';
import { NAVIGATION_FALLBACK_DENYLIST } from '../vite.config';

const root = resolve(process.cwd());
(window as unknown as Window).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
let temporary: string;
let result: Awaited<ReturnType<typeof buildPages>>;
const documents = new Map<string, Document>();
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'fhm-pages-'));
  result = await buildPages({ outDir: join(temporary, 'site'), requireAllStates: true });
  for (const file of (await generatedFiles(join(temporary, 'site'))).filter(file => file.endsWith('.html'))) {
    const path = '/' + (file.endsWith('/index.html') ? file.slice(0, -10) : file.slice(0, -5));
    documents.set(path, parse(await readFile(join(temporary, 'site', file), 'utf8')));
  }
  for (const path of ['/', '/privacy', '/terms']) {
    documents.set(path, parse(await readFile(join(root, path === '/' ? 'index.html' : `public${path}.html`), 'utf8')));
  }
});
afterAll(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });

describe('prerendered content', () => {
  it('builds all 50 states, six guides and required content pages', () => {
    expect(result.states).toBe(50);
    expect(result.pages).toHaveLength(63);
    for (const path of ['/features', '/about', '/free-onx-alternative', '/guides/', '/public-land/', '/links', '/faq', '/public-land/wisconsin']) expect(documents.has(path)).toBe(true);
    expect(result.pages.filter(page => page.path.startsWith('/guides/') && page.path !== '/guides/')).toHaveLength(6);
    expect(result.features).toEqual(['public-land', 'saved', 'trail-cameras', 'public-trails', 'data-layers', 'terrain', 'offline', 'share', 'conditions']);
  });

  it('uses unique metadata, apex canonicals, readable headings and valid structured data', () => {
    const titles = new Set<string>(), descriptions = new Set<string>(), canonicals = new Set<string>();
    for (const [path, doc] of documents) {
      const title = doc.title;
      const description = doc.querySelector('meta[name=description]')?.getAttribute('content');
      const canonical = doc.querySelector('link[rel=canonical]')?.getAttribute('href');
      expect(title, path).toBeTruthy();
      expect(description, path).toBeTruthy();
      expect(canonical, path).toBe(`https://freehuntingmap.com${path}`);
      expect(titles.has(title), path).toBe(false);
      expect(descriptions.has(description!), path).toBe(false);
      expect(canonicals.has(canonical!), path).toBe(false);
      titles.add(title); descriptions.add(description!); canonicals.add(canonical!);
      expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://freehuntingmap.com/og.png');
      if (path !== '/') {
        expect(doc.querySelectorAll('h1'), path).toHaveLength(1);
        expect(doc.querySelector('main')?.textContent?.length, path).toBeGreaterThan(300);
        expect(doc.querySelectorAll('script:not([type="application/ld+json"])'), path).toHaveLength(0);
      }
      for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
        const data = JSON.parse(script.textContent!);
        expect(data['@context']).toBe('https://schema.org');
        expect(data['@graph'].some((entry: { '@type': unknown }) => entry['@type'] === 'Person')).toBe(true);
      }
    }
    const faq = JSON.parse(documents.get('/faq')!.querySelector('script')!.textContent!);
    const questions = faq['@graph'].find((entry: { '@type': string }) => entry['@type'] === 'FAQPage').mainEntity;
    expect(questions).toHaveLength(documents.get('/faq')!.querySelectorAll('.faq-item').length);
    for (const question of questions) expect(documents.get('/faq')!.body.textContent).toContain(question.acceptedAnswer.text);
  });

  it('links to real internal pages, assets and anchors', async () => {
    for (const [path, doc] of documents) {
      for (const element of doc.querySelectorAll('[href], img[src], source[srcset], img[srcset]')) {
        const values = [element.getAttribute('href'), element.getAttribute('src'), ...(element.getAttribute('srcset') ?? '').split(',').map(item => item.trim().split(' ')[0])].filter(Boolean) as string[];
        for (const value of values) {
          if (!value.startsWith('/') && !value.startsWith('#')) continue;
          const url = new URL(value, `https://freehuntingmap.com${path}`);
          if (documents.has(url.pathname)) {
            if (url.hash) expect(documents.get(url.pathname)!.getElementById(url.hash.slice(1)), `${path}: ${value}`).toBeTruthy();
          } else {
            expect(await stat(join(root, `public${url.pathname}`)).then(s => s.isFile()).catch(() => false), `${path}: ${value}`).toBe(true);
          }
        }
      }
    }
  });

  it('includes every public page in the sitemap and real robot rules', async () => {
    const sitemap = new DOMParser().parseFromString(await readFile(join(temporary, 'site/sitemap.xml'), 'utf8'), 'application/xml');
    const urls = [...sitemap.querySelectorAll('loc')].map(node => node.textContent);
    expect(urls.sort()).toEqual([...documents.keys()].map(path => 'https://freehuntingmap.com' + path).sort());
    expect(new Set(urls).size).toBe(urls.length);
    expect(await readFile(join(temporary, 'site/robots.txt'), 'utf8')).toContain('Disallow: /admin\nDisallow: /api\n');
  });

  it('keeps content and API routes out of the app navigation fallback', () => {
    const denylist = NAVIGATION_FALLBACK_DENYLIST;
    for (const path of [...documents.keys()].filter(path => path !== '/').concat(['/tiles/trails/v1/12/1000/1400.mvt', '/tiles/trails/v1.pmtiles', '/api/me', '/privacy.html', '/terms.html', '/guides', '/public-land', '/robots.txt', '/sitemap.xml', '/features?ref=test', '/public-land/wisconsin?x=1'])) {
      expect(denylist.some(pattern => pattern.test(path)), path).toBe(true);
    }
    expect(denylist.some(pattern => pattern.test('/'))).toBe(false);
    expect(denylist.some(pattern => pattern.test('/admin/analytics'))).toBe(false);
  });

  it('escapes untrusted content and rejects incomplete state directories', async () => {
    const fixture = join(temporary, 'fixture');
    await mkdir(fixture);
    const state = { slug: 'wisconsin', name: 'Wisconsin', agency: '<unsafe> & agency', links: { agency: 'https://example.org/', regulations: 'https://example.org/rules', publicLand: 'https://example.org/maps', license: 'https://example.org/license' }, notes: ['A note with <script>alert(1)</script>.'] };
    await writeFile(join(fixture, 'states.json'), JSON.stringify([state]));
    await writeFile(join(fixture, 'links.json'), JSON.stringify([{ group: 'Maps', title: 'Official <map>', url: 'https://example.org/', description: 'Map & access' }]));
    await expect(buildPages({ outDir: join(temporary, 'bad'), contentDir: fixture, requireAllStates: true })).rejects.toThrow('Expected all 50 states');
    await buildPages({ outDir: join(temporary, 'fixture-site'), contentDir: fixture, requireAllStates: false });
    const html = await readFile(join(temporary, 'fixture-site/public-land/wisconsin.html'), 'utf8');
    expect(html).toContain('&lt;unsafe&gt; &amp; agency');
    expect(html).not.toContain('<script>alert');
  });
});
