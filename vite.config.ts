import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { CACHE_ROUTES } from './src/map/cacheRoutes';

const DAY = 60 * 60 * 24;

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
  // MapLibre alone is ~1 MB minified; it is precached once, so a single chunk is fine.
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1600 },
  plugins: [
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
        description: 'Offline-first hunting and camping map.',
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
        // App shell, including the MapLibre worker module.
        globIgnores: ['**/worker-*.js', '**/lab-*.js', '**/ort-*.js', 'lidar/**'],
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Keep cache names stable across branding changes to retain offline assets.
        runtimeCaching: [
          { urlPattern: ({ url }: { url: URL }) => url.origin === globalThis.location.origin && url.pathname.startsWith('/assets/') && /\.m?js$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'lidar-v4-modules-v1' } },
          { urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/lidar/'), handler: 'CacheFirst', options: { cacheName: 'lidar-v4-assets-v1' } },
          { urlPattern: /^https:\/\/dnrmaps\.wi\.gov\//, handler: 'NetworkOnly' },
          tileCache('parcels', CACHE_ROUTES.parcels, 4000),
          tileCache('tiles-nhd', CACHE_ROUTES.nhd, 3000),
          tileCache('tiles-nwi', CACHE_ROUTES.nwi, 3000),
          tileCache('tiles-usgs-topo', CACHE_ROUTES.usgsTopo, 4000),
          tileCache('tiles-usgs-imagery', CACHE_ROUTES.usgsImagery, 4000),
          tileCache('tiles-padus', CACHE_ROUTES.padus, 3000),
          tileCache('tiles-hillshade', CACHE_ROUTES.hillshade, 3000),
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
