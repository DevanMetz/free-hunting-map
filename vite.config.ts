import { version } from './package.json';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { trailsCacheMatch, CACHE_ROUTES } from './src/map/cacheRoutes';
import { layerRegistry } from './src/map/layerRegistry';
import './src/map/builtinLayers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildPages, generatedFiles } from './scripts/build-pages.mjs';

const DAY = 60 * 60 * 24;
export const NAVIGATION_FALLBACK_DENYLIST = [
  /^\/tiles(?:\/|$)/,
  /^\/api(?:\/|$)/,
  /^\/(?:privacy|terms|features|about|free-onx-alternative|guides|public-land|links|faq)(?:\.html)?(?:\/|$|\?)/,
  /^\/(?:robots\.txt|sitemap\.xml)(?:$|\?)/,
];

/** CacheFirst for map imagery so previously viewed areas work offline. */
const tileCache = (name: string, urlPattern: RegExp, maxEntries: number) => ({
  urlPattern,
  handler: 'CacheFirst' as const,
  options: {
    cacheName: name,
    expiration: { maxEntries, maxAgeSeconds: 90 * DAY, purgeOnQuotaError: true },
    cacheableResponse: { statuses: [0, 200] },
  },
});

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // MapLibre alone is ~1 MB minified; it is precached once, so a single chunk is fine.
  worker: { format: 'es' },
  server: { port: 5180, strictPort: true, proxy: { '/api': {
    target: 'http://localhost:8787',
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (outgoing, incoming) => {
        // Translate only this dev server's own browser Origin to the API origin.
        if (['http://localhost:5180', 'http://127.0.0.1:5180'].includes(incoming.headers.origin ?? '')) outgoing.setHeader('Origin', 'http://localhost:8787');
      });
    },
  }, '/tiles': { target: 'http://localhost:8787', changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 1600 },
  plugins: [
    {
      name: 'static-content',
      apply: 'build',
      async buildStart() { await buildPages(); },
      async generateBundle() {
        for (const fileName of await generatedFiles()) {
          this.emitFile({ type: 'asset', fileName, source: await readFile(resolve('.generated-pages', fileName)) });
        }
      },
    },
    {
      name: 'lidar-external-runtime',
      generateBundle(_options, bundle) {
        // The runtime always uses our gzip .bin asset; omit ORT's unused default.
        for (const [name] of Object.entries(bundle)) {
          if (/^assets\/ort-wasm-.*\.wasm$/.test(name)) delete bundle[name];
        }
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Free Hunting Map',
        short_name: 'Free Hunting Map',
        description: 'Free, open-source hunting maps with offline caching, waypoints, GPS tracks and GPX sharing.',
        theme_color: '#1f2e24',
        background_color: '#141a16',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // App shell, including the MapLibre worker module.
        globIgnores: ['**/worker-*.js', '**/lab-*.js', '**/ort-*.js', 'lidar/**'],
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webp,avif,webmanifest,txt,xml}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Workbox's precache matches cleanURLs (/about -> about.html) and
        // directoryIndex (/guides/ -> guides/index.html) before app navigation.
        navigateFallbackDenylist: NAVIGATION_FALLBACK_DENYLIST,
        // Keep cache names stable across branding changes to retain offline assets.
        runtimeCaching: [
          { urlPattern: ({ url }: { url: URL }) => url.origin === globalThis.location.origin && url.pathname.startsWith('/api/'), handler: 'NetworkOnly', method: 'GET' },
          { urlPattern: ({ url }: { url: URL }) => url.origin === globalThis.location.origin && url.pathname.startsWith('/api/'), handler: 'NetworkOnly', method: 'POST' },
          { urlPattern: ({ url }: { url: URL }) => url.origin === globalThis.location.origin && url.pathname.startsWith('/assets/') && /\.m?js$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'lidar-v4-modules-v1' } },
          { urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/lidar/'), handler: 'CacheFirst', options: { cacheName: 'lidar-v4-assets-v1' } },

          { urlPattern: trailsCacheMatch, handler: 'CacheFirst', options: {
            cacheName: 'tiles-trails-v1',
            expiration: { maxEntries: 10000, maxAgeSeconds: 365 * DAY, purgeOnQuotaError: true },
            cacheableResponse: { statuses: [200, 204] },
          } },
          tileCache('parcels', CACHE_ROUTES.parcels, 4000),
          tileCache('tiles-nhd', CACHE_ROUTES.nhd, 3000),
          tileCache('tiles-nwi', CACHE_ROUTES.nwi, 3000),
          tileCache('tiles-usgs-topo', CACHE_ROUTES.usgsTopo, 4000),
          tileCache('tiles-usgs-imagery', CACHE_ROUTES.usgsImagery, 4000),
          tileCache('tiles-padus', CACHE_ROUTES.padus, 3000),
          tileCache('tiles-hillshade', CACHE_ROUTES.hillshade, 3000),
          ...layerRegistry.cacheRoutes().map(pattern => tileCache('tiles-data-layers', pattern, 6000)),
          ...layerRegistry.cacheRoutes('NetworkFirst').map(urlPattern => ({
            urlPattern, handler: 'NetworkFirst' as const,
            options: { cacheName: 'live-data-layers', networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: DAY, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] } },
          })),
          tileCache('tiles-openfreemap', CACHE_ROUTES.openfreemapTiles, 4000),
          {
            urlPattern: CACHE_ROUTES.openfreemapStyles,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'openfreemap-styles', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
});
