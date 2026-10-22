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
  build: { chunkSizeWarningLimit: 1600 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Open Hunt Map',
        short_name: 'Hunt Map',
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
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
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
