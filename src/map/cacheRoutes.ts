/** Service-worker runtime-cache URL patterns (used by vite.config.ts; tested against real endpoint URLs). */
export const CACHE_ROUTES = {
  usgsTopo: /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSTopo\/MapServer\/tile\//,
  usgsImagery: /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\/MapServer\/tile\//,
  padus: /^https:\/\/edits\.nationalmap\.gov\/arcgis\/rest\/services\/PAD-US\/.*\/export/,
  /** Versioned vector tiles, fonts and sprites are immutable. */
  openfreemapTiles: /^https:\/\/tiles\.openfreemap\.org\/(planet\/.+|fonts\/|sprites\/|natural_earth\/)/,
  /** Style + TileJSON change when OpenFreeMap publishes a new planet build. */
  openfreemapStyles: /^https:\/\/tiles\.openfreemap\.org\/(styles\/[^/]+|planet)$/,
};
