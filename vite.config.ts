import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
          tileCache('tiles-usgs-topo', /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSTopo\/MapServer\/tile\//, 4000),
          tileCache('tiles-usgs-imagery', /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\/MapServer\/tile\//, 4000),
          tileCache('tiles-padus', /^https:\/\/edits\.nationalmap\.gov\/arcgis\/rest\/services\/PAD-US\/.*\/export/, 3000),
          // Versioned vector tiles, fonts and sprites are immutable.
          tileCache('tiles-openfreemap', /^https:\/\/tiles\.openfreemap\.org\/(planet\/.+|fonts\/|sprites\/|natural_earth\/)/, 4000),
          {
            // Style + TileJSON change when OpenFreeMap publishes a new planet build.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/(styles\/[^/]+|planet)$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'openfreemap-styles', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
});
