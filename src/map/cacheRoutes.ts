/** Service-worker runtime-cache URL patterns (used by vite.config.ts; tested against real endpoint URLs). */
export const CACHE_ROUTES = {
  parcels: /^https:\/\/services3\.arcgis\.com\/n6uYoouQZW75n5WI\/arcgis\/rest\/services\/Wisconsin_Statewide_Parcels_DB\/FeatureServer\/0\/query\?/,
  nhd: /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSHydroCached\/MapServer\/tile\//,
  nwi: /^https:\/\/fwspublicservices\.wim\.usgs\.gov\/wetlandsmapservice\/rest\/services\/Wetlands\/MapServer\/export\?/,
  usgsTopo: /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSTopo\/MapServer\/tile\//,
  usgsImagery: /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\/MapServer\/tile\//,
  hillshade: /^https:\/\/elevation\.nationalmap\.gov\/arcgis\/rest\/services\/3DEPElevation\/ImageServer\/exportImage/,
  padus: /^https:\/\/edits\.nationalmap\.gov\/arcgis\/rest\/services\/PAD-US\/.*\/export/,
  /** Versioned vector tiles, fonts and sprites are immutable. */
  openfreemapTiles: /^https:\/\/tiles\.openfreemap\.org\/(planet\/.+|fonts\/|sprites\/|natural_earth\/)/,
  /** Style + TileJSON change when OpenFreeMap publishes a new planet build. */
  openfreemapStyles: /^https:\/\/tiles\.openfreemap\.org\/(styles\/[^/]+|planet)$/,
};
