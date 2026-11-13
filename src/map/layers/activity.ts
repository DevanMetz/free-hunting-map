import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { serviceUrl } from '../../serviceUrl';
import { registerLayer } from '../layerRegistry';
import { ACTIVITY_ZOOM, cellRing } from '../../scout/grid';

const ID = 'activity';
const PATH = `/tiles/activity/${ACTIVITY_ZOOM}`;

function tileKeys(west: number, south: number, east: number, north: number): string[] {
  const n = 2 ** ACTIVITY_ZOOM;
  const latY = (lat: number): number => {
    const rad = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
  };
  const x0 = Math.max(0, Math.floor((west + 180) / 360 * n));
  const x1 = Math.min(n - 1, Math.floor((east + 180) / 360 * n));
  const y0 = Math.max(0, latY(north));
  const y1 = Math.min(n - 1, latY(south));
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x}/${y}`);
  return keys;
}

type ActivityFeature = { type: 'Feature'; id?: string | number; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; properties: { count?: number } };
type ActivityCollection = { type: 'FeatureCollection'; features?: ActivityFeature[] };

const loaders = new WeakMap<MapLibreMap, { update: () => void; on: boolean }>();

function installLoader(map: MapLibreMap): void {
  if (loaders.has(map)) return;
  let controller: AbortController | undefined;
  const loader = { on: true, update: () => {
    controller?.abort();
    if (!loader.on || map.getZoom() < 5) return;
    const bounds = map.getBounds();
    const west = Math.max(-180, bounds.getWest());
    const east = Math.min(180, bounds.getEast());
    if (west >= east) return;
    const keys = tileKeys(west, Math.max(-85, bounds.getSouth()), east, Math.min(85, bounds.getNorth()));
    if (keys.length > 80) return;
    controller = new AbortController();
    const signal = controller.signal;
    void Promise.all(keys.map(async key => {
      try {
        const response = await fetch(serviceUrl(`${PATH}/${key}.geojson`), { signal, credentials: 'omit' });
        return response.ok ? await response.json() as ActivityCollection : null;
      } catch { return null; }
    })).then(collections => {
      if (signal.aborted) return;
      const features = new Map<string, ActivityFeature>();
      for (const collection of collections) for (const feature of collection?.features ?? []) {
        const id = String(feature.id ?? '');
        const ring = cellRing(id);
        const count = Number(feature.properties?.count);
        if (!ring || !Number.isFinite(count) || count < 1) continue;
        features.set(id, { type: 'Feature', id, properties: { count }, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
      (map.getSource(ID) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [...features.values()] });
    });
  } };
  loaders.set(map, loader);
  map.on('moveend', loader.update);
}

registerLayer({
  id: ID,
  category: 'land',
  name: 'Activity',
  swatch: '#e87826',
  defaultOn: false,
  defaultOpacity: 0.85,
  minzoom: 5,
  attribution: 'Free Hunting Map',
  cacheRoute: /\/tiles\/activity\/8\/\d+\/\d+\.geojson(?:\?|$)/,
  cacheStrategy: 'NetworkFirst',
  layerIds: [ID],
  install(map, ctx) {
    if (!map.getSource(ID)) map.addSource(ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Free Hunting Map' });
    if (!map.getLayer(ID)) map.addLayer({
      id: ID, type: 'fill', source: ID, minzoom: 5,
      paint: { 'fill-color': '#e87826', 'fill-opacity': ['*', 0.85, ['interpolate', ['linear'], ['get', 'count'], 1, 0.22, 8, 0.4, 20, 0.58]], 'fill-outline-color': '#e87826' },
    }, ctx.beforeId);
    installLoader(map);
  },
  setVisible(map, on) {
    if (map.getLayer(ID)) map.setLayoutProperty(ID, 'visibility', on ? 'visible' : 'none');
    const loader = loaders.get(map);
    if (loader) { loader.on = on; loader.update(); }
  },
  setOpacity(map, opacity) {
    if (map.getLayer(ID)) map.setPaintProperty(ID, 'fill-opacity', ['*', opacity, ['interpolate', ['linear'], ['get', 'count'], 1, 0.22, 8, 0.4, 20, 0.58]]);
  },
  async identify(_lng, _lat, _signal, map, point) {
    if (!map.getLayer(ID)) return null;
    const count = map.queryRenderedFeatures(point, { layers: [ID] })[0]?.properties?.count;
    return typeof count === 'number' && count > 0 ? { title: 'Activity', rows: [['Sightings', String(count)]] } : null;
  },
});
