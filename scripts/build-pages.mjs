import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { features } from '../content/pages/features.mjs';
import { guides } from '../content/pages/guides.mjs';
import { questions } from '../content/pages/faq.mjs';
import { stateNotes } from '../content/pages/state-details.mjs';

// Vite bundles its config inside the shared node_modules symlink. Resolve from
// the project cwd so generation always reads this worktree, not that checkout.
export const ROOT = resolve(process.cwd());
export const ORIGIN = 'https://freehuntingmap.com';
export const DATE = '2026-10-24';
export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
export const cta = '<a class="button" href="/">Open the map <span aria-hidden="true">↗</span></a>';
export const header = `<a class="skip" href="#main">Skip to content</a><header class="site-header"><a class="brand" href="/features"><img src="/favicon.svg" width="32" height="32" alt="">Free Hunting Map</a><nav aria-label="Main"><a href="/">Map</a><a href="/features">Features</a><a href="/guides/">Guides</a><a href="/public-land/">Public land</a><a href="/faq">FAQ</a><a href="/about">About</a></nav></header>`;
export const footer = '<footer class="site-footer"><a class="brand" href="/features">Free Hunting Map</a><nav aria-label="Footer"><a href="/links">Links</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://github.com/DevanMetz/free-hunting-map">GitHub</a><a href="/about">About</a></nav></footer>';
const person = { '@type': 'Person', '@id': `${ORIGIN}/about#devan-metz`, name: 'Devan Metz', url: `${ORIGIN}/about` };
export const application = {
  '@type': ['WebApplication', 'SoftwareApplication'], '@id': `${ORIGIN}/#app`, name: 'Free Hunting Map', url: `${ORIGIN}/`,
  description: 'Free, open-source hunting maps with offline caching, waypoints, GPS tracks and GPX sharing.',
  applicationCategory: 'TravelApplication', operatingSystem: 'Web browser, Android, iOS', isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, license: 'https://opensource.org/license/mit', author: person,
};

export function screenshot(name, alt, { first = false, article = false } = {}) {
  const width = 1120, height = 760;
  const sizes = article ? '(max-width: 816px) calc(100vw - 2.5rem), 768px' : '(max-width: 700px) calc(100vw - 2.5rem), (max-width: 1248px) 50vw, 640px';
  const variants = [560, 780, 1120];
  const srcset = format => variants.map(size => `/img/features/${name}-${size}.${format} ${size}w`).join(', ');
  return `<picture><source type="image/avif" srcset="${srcset('avif')}" sizes="${sizes}"><img src="/img/features/${name}-${width}.webp" srcset="${srcset('webp')}" sizes="${sizes}" width="${width}" height="${height}" alt="${escape(alt)}" ${first ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

export function renderPage({ path, title, description, body, article, breadcrumbs = [], schema = [], wide = false }) {
  const canonical = ORIGIN + path;
  const graph = [{ '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'Free Hunting Map', url: `${ORIGIN}/`, publisher: person }, person, application,
    { '@type': article ? 'Article' : 'WebPage', '@id': canonical + '#page', url: canonical, name: title, description, isPartOf: { '@id': `${ORIGIN}/#website` },
      ...(article ? { headline: title, author: person, datePublished: DATE, dateModified: DATE, image: ORIGIN + '/og.png', mainEntityOfPage: canonical } : {}) }, ...schema];
  if (breadcrumbs.length) graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ name: 'Map', path: '/' }, ...breadcrumbs].map((entry, i) => ({ '@type': 'ListItem', position: i + 1, name: entry.name, item: ORIGIN + entry.path })) });
  const crumbs = breadcrumbs.length ? `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Map</a>${breadcrumbs.map((entry, i) => i === breadcrumbs.length - 1 ? `<span aria-current="page">${escape(entry.name)}</span>` : `<a href="${escape(entry.path)}">${escape(entry.name)}</a>`).join('')}</nav>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#1f2e24">
<title>${escape(title)} — Free Hunting Map</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="${article ? 'article' : 'website'}"><meta property="og:site_name" content="Free Hunting Map"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${ORIGIN}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Free Hunting Map with a real Wisconsin topo map, demo waypoints and a track.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="${ORIGIN}/og.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="stylesheet" href="/content.css">
<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script></head>
<body>${header}<main id="main"${wide ? ' class="wide"' : ''}>${crumbs}${body}</main>${footer}</body></html>\n`;
}

const cards = entries => `<ul class="cards">${entries.map(({ path, title, description }) => `<li><a href="${path}"><h2>${escape(title)}</h2></a><p>${escape(description)}</p></li>`).join('')}</ul>`;
const guideCards = () => cards(guides.map(g => ({ ...g, path: '/guides/' + g.slug })));
const comparison = `<div class="table-wrap"><table><caption>Free Hunting Map vs typical paid hunting apps</caption><thead><tr><th scope="col">Consideration</th><th scope="col">Free Hunting Map</th><th scope="col">Typical paid hunting apps</th></tr></thead><tbody>
<tr><th scope="row">Price</th><td>$0; no subscription</td><td>Check current subscriptions and included features</td></tr><tr><th scope="row">Source code</th><td>MIT open source</td><td>Check the product’s source-code license</td></tr><tr><th scope="row">Account</th><td>Optional; local map use without sign-in</td><td>Check each product's account requirements</td></tr><tr><th scope="row">Offline maps</th><td>Previously viewed tiles cached; test before leaving</td><td>Check download controls and plan limits</td></tr><tr><th scope="row">Your map data</th><td>GPX, GeoJSON and QR sharing</td><td>Check supported import and export formats</td></tr><tr><th scope="row">Organization</th><td>Categories, visibility controls and offline saved-item search</td><td>Check organization and search tools</td></tr><tr><th scope="row">Trail cameras</th><td>Pins with adjustable view cones and camera details</td><td>Check camera tools and plan limits</td></tr><tr><th scope="row">Trails</th><td>Regional federal-inventory pilot; WI, MN, MI, IA, IL</td><td>Check trail sources and regional coverage</td></tr><tr><th scope="row">Land data</th><td>PAD-US; Wisconsin parcels, not nationwide ownership</td><td>Check coverage, update dates and data sources</td></tr></tbody></table></div>`;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`Cannot read verified content at ${path}. Provide content/states.json and content/links.json before building. ${error.message}`); }
}

// The official-resource files are maintained separately from page presentation.
// Validate their structure rather than silently publishing missing state links.
export function normalizeStates(data) {
  const states = Array.isArray(data) ? data : data.states;
  if (!Array.isArray(states) || !states.length) throw new Error('states.json must contain a nonempty states array');
  const result = states.map(state => {
    const name = state.name ?? state.state;
    const slug = state.slug;
    const agencyName = state.agencyName ?? state.agency?.name ?? (typeof state.agency === 'string' ? state.agency : undefined);
    const pick = (...values) => values.find(value => typeof value === 'string' && /^https:\/\//.test(value));
    const links = [
      ['Wildlife agency', pick(state.agencyUrl, state.agency?.url, state.links?.agency, state.agency_url)],
      ['Hunting regulations', pick(state.regulationsUrl, state.regulations?.url, state.links?.regulations, state.regulations, state.regulations_url)],
      ['Public land and access maps', pick(state.publicLandUrl, state.publicLand?.url, state.links?.publicLand, state.links?.maps, state.mapsUrl, state.maps, state.public_land_url)],
      ['Licenses and permits', pick(state.licenseUrl, state.license?.url, state.links?.license, state.license, state.license_url)],
    ];
    if (!name || !agencyName || !/^[a-z]+(?:-[a-z]+)*$/.test(slug) || links.some(([, url]) => !url)) throw new Error(`Incomplete official links for ${name ?? slug}`);
    const suppliedNotes = state.notes ?? stateNotes[slug];
    const notes = Array.isArray(suppliedNotes) ? suppliedNotes : [suppliedNotes];
    if (!notes.length || notes.some(note => typeof note !== 'string' || !note.trim())) throw new Error(`Missing specific notes for ${name}`);
    return { name, slug, agencyName, links, notes };
  });
  if (new Set(result.map(s => s.slug)).size !== result.length) throw new Error('Duplicate state slug');
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeLinks(data) {
  let groups = Array.isArray(data) ? data : data.groups;
  if (Array.isArray(groups) && groups.every(entry => entry.url && entry.group)) {
    const grouped = new Map();
    for (const resource of groups) {
      if (!grouped.has(resource.group)) grouped.set(resource.group, []);
      grouped.get(resource.group).push(resource);
    }
    groups = [...grouped].map(([title, links]) => ({ title, links }));
  }
  if (!Array.isArray(groups) || !groups.length) throw new Error('links.json must contain a nonempty groups array');
  return groups.map(group => {
    const title = group.title ?? group.name ?? group.group;
    const links = group.links ?? group.resources;
    if (!title || !Array.isArray(links) || !links.length) throw new Error('Invalid official resource group');
    return { title, links: links.map(link => {
      const title = link.title ?? link.name ?? link.label;
      if (!title || !/^https:\/\//.test(link.url)) throw new Error('Invalid official resource');
      return { title, url: link.url, description: link.description ?? link.notes ?? '' };
    }) };
  });
}

export async function buildPages({ outDir = join(ROOT, '.generated-pages'), contentDir = process.env.FHM_CONTENT_DIR ?? join(ROOT, 'content'), requireAllStates = !process.env.FHM_CONTENT_DIR } = {}) {
  const states = normalizeStates(await readJson(join(contentDir, 'states.json')));
  const groups = normalizeLinks(await readJson(join(contentDir, 'links.json')));
  if (requireAllStates && states.length !== 50) throw new Error(`Expected all 50 states, received ${states.length}`);
  const active = [];
  for (const feature of features.filter(f => f.enabled)) {
    const present = await Promise.all(feature.requires.map(async ([path, needle]) => (await readFile(join(ROOT, path), 'utf8')).includes(needle)));
    if (present.every(Boolean)) active.push(feature);
    else throw new Error(`Feature ${feature.id} no longer matches the app; update its copy or disable the section in content/pages/features.mjs`);
  }
  const pages = [];
  const add = page => pages.push(page);
  add({ path: '/features', title: 'Free hunting maps, offline scouting and GPS tracks', description: 'Explore free, open-source hunting maps with offline caching, public land overlays, scouting pins, GPS tracks, lidar terrain and GPX sharing. No account required.', wide: true,
    body: `<section class="hero"><div><h1>Free Hunting Map</h1><p>Topo and aerial maps, public land, federal trails, categorized pins and trail camera views. Free, open source and usable without an account.</p>${cta}<p class="source-link"><a href="https://github.com/DevanMetz/free-hunting-map">View the MIT source on GitHub <span aria-hidden="true">↗</span></a></p></div><div class="hero-map">${screenshot('map', 'Free Hunting Map showing real Wisconsin topo imagery with imported demo scouting pins and a track.', { first: true })}</div></section>
<div class="feature-list">${active.map(f => `<section class="feature" id="${f.id}"><div class="feature-copy"><h2>${f.heading}</h2>${f.body}<a href="${f.href}">${f.link} <span aria-hidden="true">→</span></a></div><div class="feature-image">${screenshot(f.image, f.alt)}</div></section>`).join('')}</div>
<section class="comparison"><h2>Choose the tools you need</h2>${comparison}<p>Paid products differ. Compare the current plan, coverage and terms for any product you are considering. Free Hunting Map's data and access limits are explained in the <a href="/faq">FAQ</a>.</p><a href="/free-onx-alternative">Considering a free onX alternative?</a></section>
<section class="start"><h2>Make your next scouting plan</h2>${cta}<nav aria-label="Explore"><a href="/guides/">Read the guides</a><a href="/public-land/">Find your state</a></nav></section>` });
  add({ path: '/about', title: 'About', description: 'Free Hunting Map is a free MIT open-source map made by Devan Metz. Learn about local storage, optional sync, map sources and attribution.',
    body: `<h1>About Free Hunting Map</h1><p>Free Hunting Map is a free, open-source web map for planning hunts and keeping field observations. Devan Metz makes and maintains the project. It runs in a browser and can be installed on a phone as a progressive web app.</p>
<h2>Free to use and inspect</h2><p>The code is released under the MIT license. Browse it, report an issue or contribute on <a href="https://github.com/DevanMetz/free-hunting-map">GitHub</a>. There is no subscription and core map use does not require an account.</p>
<h2>Scouting tools</h2><p>Organize pins and tracks into categories, control their visibility and search saved data offline. Trail cam pins have draggable view cones and camera records. Layers groups public land, federal trails, vegetation, crops, water, terrain and fire datasets with opacity controls and legends.</p>
<h2>Your data on your device</h2><p>Saved pins and tracks live in your browser's local database. Viewed map tiles are cached for offline use. Optional Google sign-in syncs map items, saved lidar candidates and map preferences. Tile and weather providers receive network requests for the area you use.</p><p>The app has no ads and does not sell personal data. Optional anonymous usage analytics can be disabled in Layers and respects Do Not Track and Global Privacy Control. Read the <a href="/privacy">privacy policy</a> for storage, analytics, hosting and deletion details.</p>
<h2>Data sources and attribution</h2><dl class="sources">
<dt>Topo and aerial imagery</dt><dd><a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>, including USGS orthoimagery. USGS public-domain data; attribution requested.</dd>
<dt>Streets and labels</dt><dd><a href="https://openfreemap.org/">OpenFreeMap</a> and <a href="https://www.openmaptiles.org/">OpenMapTiles</a>, using © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> data under ODbL. Map attribution is shown in the app.</dd>
<dt>Public land</dt><dd>USGS GAP <a href="https://doi.org/10.5066/P96WBCHS">PAD-US 4.1</a> fee lands, public domain. Manager categories are a research aid, not hunting permission or a boundary survey.</dd>
<dt>Public trails</dt><dd>USFS, BLM, NPS and USGS federal public-domain inventories, including Forest Service motor routes. The regional pilot covers Wisconsin, Minnesota, Michigan, Iowa and Illinois plus nearby territory within its bounds; it is not a complete trail or access inventory.</dd>
<dt>Cover, crops and terrain</dt><dd>USGS Annual NLCD land cover (2025); USFS tree canopy (2025), forest type (2018), broad forest ownership and LCMS vegetation loss (1985–2024); USGS/USFS LANDFIRE vegetation (2024); USDA NASS crops (2025), NRCS SSURGO soils; EPA ecoregions; USGS contours and elevation. Federal public-domain data, with coverage and vintage varying by layer.</dd>
<dt>Fire</dt><dd>USFS wildfire hazard potential, NIFC current fire records and NIFC historic perimeters. Federal data; current feeds are refreshed online and can fall back to cached views.</dd>
<dt>Hillshade and lidar</dt><dd><a href="https://www.usgs.gov/3d-elevation-program">USGS 3DEP</a> public-domain elevation and point clouds. Trail finder coverage is limited to WI_Clark_2018 and WI_12County_9_B22.</dd>
<dt>Wisconsin parcels</dt><dd>Wisconsin Statewide Parcels V12, State Cartographer's Office, served through ArcGIS. Public-domain data; Wisconsin coverage only, visible at closer zoom levels.</dd>
<dt>Water</dt><dd>USGS National Hydrography Dataset and US Fish and Wildlife Service National Wetlands Inventory and USGS/USDA watershed boundaries. Springs, streams and lake identification use USGS NHD. Public-domain federal data.</dd>
<dt>Wisconsin deer units</dt><dd>Wisconsin DNR map service; agency terms apply. Viewed imagery is cached; tap identification requires a connection.</dd>
<dt>Weather</dt><dd><a href="https://open-meteo.com/">Open-Meteo</a>; weather data under CC BY 4.0, with service terms for non-commercial use. Attribution appears in Conditions.</dd>
<dt>Sun and moon</dt><dd>Calculated locally with <a href="https://github.com/mourner/suncalc">SunCalc</a> (BSD-2-Clause). Civil twilight is not a statement of legal hunting hours.</dd></dl>
<p>Map imagery, source datasets and libraries retain their own terms. See the repository's <a href="https://github.com/DevanMetz/free-hunting-map#data-sources">data-source documentation</a> for service details.</p><p>Maps can be incomplete or outdated. Confirm access and rules with official sources and read the <a href="/terms">terms</a>.</p>${cta}` });
  add({ path: '/free-onx-alternative', title: 'Looking for a free onX alternative?', description: 'Consider Free Hunting Map for offline scouting, public land, waypoints and GPX files. Understand its Wisconsin parcel coverage and offline caching limits.',
    body: `<h1>Looking for a free onX alternative?</h1><p>If you want hunting maps without another subscription, start by listing the tools and coverage you actually need. Free Hunting Map costs $0, is MIT open source and works without an account. It may suit a scouting workflow built around topo maps, saved spots and portable files.</p>${cta}
<h2>What Free Hunting Map gives you</h2><ul><li>Topo, aerial imagery and street basemaps, with public-land manager overlays from PAD-US.</li><li>Named waypoints, notes, drawn tracks, distance measurement and GPS recording while the app stays visible.</li><li>Colored categories, visibility controls, offline saved-item search, and trail cam pins with adjustable view cones.</li><li>Federal trails in the WI, MN, MI, IA and IL regional pilot; vegetation, 2025 crops, soils, water, terrain and fire layers with varying coverage.</li><li>Automatic caching of viewed map tiles, plus local saved map data for offline use.</li><li>GPX and GeoJSON import/export, QR sharing and supported Google Takeout saved-place import.</li><li>Optional Google sign-in for cross-device sync; downloaded maps stay device-specific.</li></ul>
<h2>Check these limits before switching</h2><p><strong>Land ownership:</strong> Free Hunting Map's parcel overlay is Wisconsin-only. It does not offer nationwide private landowner data. Public-land polygons do not determine hunting permission or legal access. Verify boundaries with current official sources and the land manager.</p>
<p><strong>Offline preparation:</strong> the app caches tiles you view. It has no bulk region downloader or guarantee that an entire hunt unit is saved. Review every needed basemap and zoom level, then test offline on your phone.</p><p><strong>Field use:</strong> browser GPS recording can pause in the background. Carry a backup map and navigation tools. The experimental lidar Trail finder has limited Wisconsin coverage and produces unverified candidates.</p>
<h2>Compare your own workflow</h2>${comparison}<p>For onX features and membership terms, consult <a href="https://www.onxmaps.com/hunt/app">onX's own product information</a>. This page describes Free Hunting Map and does not claim feature parity with another product.</p>
<h2>Try a small scouting plan first</h2><p>Save a parking pin, draw a short planned track and export it. Prepare that area offline and test it near home. The <a href="/features">feature tour</a>, <a href="/guides/offline-maps">offline guide</a> and <a href="/public-land/">official state resources</a> can help you decide whether the workflow fits.</p><p>onX is a trademark of its owner. Free Hunting Map is an independent project and is not affiliated with or endorsed by onX.</p>${cta}` });
  add({ path: '/guides/', title: 'Hunting map and scouting guides', description: 'Practical guides to topo maps, public hunting land, offline preparation, lidar terrain, trail camera planning and GPX or Google Takeout imports.', wide: true,
    body: `<h1>Map and scouting guides</h1>${guideCards()}<p>Planning a trip? Find <a href="/public-land/">official resources for your state</a>, or explore <a href="/features">what the map can do</a>.</p>` });
  for (const guide of guides) add({ path: '/guides/' + guide.slug, title: guide.title, description: guide.description, article: true,
    breadcrumbs: [{ name: 'Guides', path: '/guides/' }, { name: guide.title, path: '/guides/' + guide.slug }],
    body: `<article><h1>${escape(guide.title)}</h1><p class="byline">By Devan Metz · <time datetime="${DATE}">October 24, 2026</time></p><div class="article-image">${screenshot(guide.image, guide.alt, { first: true, article: true })}</div>${guide.body}<div class="article-end">${cta}<a href="/guides/">All guides</a></div></article>` });
  add({ path: '/public-land/', title: 'Public hunting land resources by state', description: 'Find official wildlife agencies, hunting regulations, public-land maps, access programs and license information for all 50 US states.', wide: true,
    body: `<h1>Public hunting land by state</h1><p>Choose a state for official wildlife, access and licensing resources. Use agency maps and current property rules to confirm a place to hunt and a legal way in.</p><ul class="state-list">${states.map(state => `<li><a href="/public-land/${state.slug}">${escape(state.name)}</a></li>`).join('')}</ul><h2>Research the property, then plan the walk</h2><p>Public ownership alone does not make land open to hunting. Seasons, permits, closures and access routes can differ by property. Read the <a href="/guides/finding-public-hunting-land">public-land guide</a> before relying on a map polygon.</p>${cta}` });
  for (const state of states) add({ path: '/public-land/' + state.slug, title: `${state.name} public hunting land and official maps`, description: `Find ${state.name} hunting regulations, public-land access maps and licenses from ${state.agencyName}. Plan with official sources and Free Hunting Map.`,
    breadcrumbs: [{ name: 'Public land', path: '/public-land/' }, { name: state.name, path: '/public-land/' + state.slug }],
    body: `<h1>${escape(state.name)} public hunting land</h1><p>Start with ${escape(state.agencyName)} for current hunting rules, licenses and access information in ${escape(state.name)}.</p><h2>Official ${escape(state.name)} resources</h2><ul class="resource-list">${state.links.map(([label, url]) => `<li><a href="${escape(url)}">${escape(label)} <span aria-hidden="true">↗</span></a></li>`).join('')}</ul><h2>Planning a hunt in ${escape(state.name)}</h2>${state.notes.map(note => `<p>${escape(note)}</p>`).join('')}
<h2>Check the property and the route</h2><p>Read the property's current rules, closures and permit requirements. Confirm parking and every part of the approach; a public parcel can be surrounded by private land. A road or path visible on imagery is not proof of public access. Resolve uncertain boundaries with the managing agency.</p>
<h2>Use with Free Hunting Map</h2><p>Open Layers and enable relevant PAD-US public-land manager categories. Compare topo and aerial imagery, mark verified parking and save notes for the spots you plan to check. PAD-US is a planning aid, not a legal boundary or hunting-permission map; parcel coverage in the app is limited to Wisconsin.</p><p>View your approach at the zoom levels you need and <a href="/guides/offline-maps">test the cached map offline</a> before leaving. Keep official property maps and rules with your trip materials.</p>${cta}<p><a href="/guides/finding-public-hunting-land">How to verify public hunting access</a> · <a href="/public-land/">All states</a> · <a href="/faq">Map FAQ</a></p>` });
  add({ path: '/links', title: 'Official hunting, land and map resources', description: 'Useful official resources for public-land research, hunting access, maps, elevation and outdoor trip preparation, grouped by topic.',
    body: `<h1>Official resources</h1>${groups.map(group => `<section><h2>${escape(group.title)}</h2><ul class="resource-list">${group.links.map(link => `<li><a href="${escape(link.url)}">${escape(link.title)} <span aria-hidden="true">↗</span></a>${link.description ? `<p>${escape(link.description)}</p>` : ''}</li>`).join('')}</ul></section>`).join('')}<p>Find local rules through the <a href="/public-land/">state directory</a>, then use the <a href="/guides/">guides</a> to plan your map workflow.</p>` });
  add({ path: '/faq', title: 'Frequently asked questions', description: 'Answers about free hunting maps, offline caching, property lines, GPS accuracy, file backups, phone installation and optional Google sync.',
    schema: [{ '@type': 'FAQPage', mainEntity: questions.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })) }],
    body: `<h1>Frequently asked questions</h1>${questions.map(([q, a]) => `<section class="faq-item"><h2>${escape(q)}</h2><p>${escape(a)}</p></section>`).join('')}<nav class="related" aria-label="More answers"><a href="/guides/offline-maps">Offline preparation</a><a href="/guides/gpx-google-maps-import">Backups and imports</a><a href="/privacy">Privacy policy</a><a href="/about">About and source code</a></nav>${cta}` });

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const page of pages) {
    const file = join(outDir, page.path.endsWith('/') ? page.path.slice(1) + 'index.html' : page.path.slice(1) + '.html');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, renderPage(page));
  }
  const urls = ['/', ...pages.map(page => page.path), '/privacy', '/terms'];
  await writeFile(join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(path => `  <url><loc>${ORIGIN}${path}</loc><lastmod>${DATE}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  await writeFile(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  return { pages, urls, features: active.map(f => f.id), states: states.length };
}

export async function generatedFiles(dir = join(ROOT, '.generated-pages')) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => entry.isDirectory() ? (await generatedFiles(join(dir, entry.name))).map(path => entry.name + '/' + path) : [entry.name]))).flat();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildPages();
  console.log(`Generated ${result.pages.length} content pages (${result.states} states); feature sections: ${result.features.join(', ')}`);
}
