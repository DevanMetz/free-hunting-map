import { registerLayers, type IdentifyResult } from './layerRegistry';
import { PUBLIC_LANDS, publicLandExportUrl } from './publicLands';
import { identifyDeer, identifyPublicLand, parcelContent } from './inspect';
import { CACHE_ROUTES } from './cacheRoutes';
import { DEER_EXPORT, DEER_ATTR, NHD_TILES, NHD_ATTR, NWI_EXPORT, NWI_ATTR, PARCELS_ATTR, HILLSHADE_ATTR, HILLSHADE_EXPORT, PADUS_ATTR, SLOPE_EXPORT, ASPECT_EXPORT } from './sources';

const result = (lines: string[]): IdentifyResult | null => lines.length ? { title: lines[0], rows: lines.slice(1).map(line => ['', line]) } : null;
registerLayers([
  ...PUBLIC_LANDS.map(c => ({
    id: `padus-${c.id}`, category: 'land' as const, name: c.label, swatch: c.color, info: c.info,
    defaultOpacity: 1, minzoom: 5, attribution: PADUS_ATTR, cacheRoute: CACHE_ROUTES.padus,
    source: { kind: 'raster' as const, tiles: [publicLandExportUrl(c)], tileSize: 256, minzoom: 5 },
    identify: async (lng: number, lat: number, signal: AbortSignal) => result(await identifyPublicLand(lng, lat, [c.id], signal)),
  })),
  {
    id: 'parcels', category: 'land', name: 'Parcels (WI)', swatch: '#b0306a', defaultOpacity: 0.8,
    minzoom: 13, attribution: PARCELS_ATTR, cacheRoute: CACHE_ROUTES.parcels, layerIds: ['parcels-fill', 'parcels-line'],
    install(map, ctx) {
      if (map.getSource('parcels')) return;
      map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: PARCELS_ATTR });
      map.addLayer({ id: 'parcels-fill', type: 'fill', source: 'parcels', minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
      map.addLayer({ id: 'parcels-line', type: 'line', source: 'parcels', minzoom: 13, paint: {
        'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.6],
      } }, ctx.beforeId);
    },
    setVisible(map, on, ctx) {
      for (const id of ['parcels-fill', 'parcels-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      ctx.setParcelsEnabled(on);
    },
    setOpacity(map, opacity) { map.setPaintProperty('parcels-line', 'line-opacity', opacity); },
    async identify(_lng, _lat, _signal, map, point) {
      if (!map.getLayer('parcels-fill')) return null;
      const feature = map.queryRenderedFeatures(point, { layers: ['parcels-fill'] })[0];
      return feature ? result(parcelContent(feature.properties)) : null;
    },
  },
  { id: 'deer-units', category: 'land', name: 'Deer units (WI DNR)', defaultOpacity: 0.8, minzoom: 6,
    attribution: DEER_ATTR, source: { kind: 'raster', tiles: [DEER_EXPORT] }, cacheRoute: CACHE_ROUTES.deer,
    identify: async (lng, lat, signal) => result(await identifyDeer(lng, lat, signal)) },
  { id: 'water-nhd', category: 'water', name: 'Streams & lakes', swatch: '#509ccc', defaultOpacity: 1,
    attribution: NHD_ATTR, source: { kind: 'raster', tiles: [NHD_TILES], maxzoom: 16 }, cacheRoute: CACHE_ROUTES.nhd },
  { id: 'water-nwi', category: 'water', name: 'Wetlands', swatch: '#609d71', defaultOpacity: 0.7, minzoom: 11,
    attribution: NWI_ATTR, source: { kind: 'raster', tiles: [NWI_EXPORT], maxzoom: 16 }, cacheRoute: CACHE_ROUTES.nwi },
  { id: 'hillshade', category: 'terrain', name: 'Hillshade', defaultOpacity: 0.55, minzoom: 11,
    attribution: HILLSHADE_ATTR, source: { kind: 'raster', tiles: [HILLSHADE_EXPORT], minzoom: 11, maxzoom: 17 }, cacheRoute: CACHE_ROUTES.hillshade },
  { id: 'slope', category: 'terrain', name: 'Slope', defaultOpacity: 0.65, minzoom: 10,
    attribution: HILLSHADE_ATTR, source: { kind: 'raster', tiles: [SLOPE_EXPORT], maxzoom: 17 }, cacheRoute: CACHE_ROUTES.hillshade },
  { id: 'aspect', category: 'terrain', name: 'Aspect', defaultOpacity: 0.65, minzoom: 11,
    attribution: HILLSHADE_ATTR, source: { kind: 'raster', tiles: [ASPECT_EXPORT], maxzoom: 17 }, cacheRoute: CACHE_ROUTES.hillshade },
  { id: 'trail-finder', category: 'trailfinder', name: 'Find trails', defaultOpacity: 1, attribution: HILLSHADE_ATTR, action: 'trailfinder' },
]);
