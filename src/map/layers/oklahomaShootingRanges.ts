import type { Feature, FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes } from './hazards';
import { fetchJson, record } from './raster';
import { text } from './arcgis';

const service = 'https://www.wildlifedepartment.com/server/rest/services/PublicWILMA/WILMAFeatures/MapServer/3';
const atlas = 'https://www.wildlifedepartment.com/hunting/wma/shooting-ranges';
const id = 'oklahoma-shooting-ranges', circles = `${id}-points`, minzoom = 10;
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();

function points(data: unknown): Feature<Point>[] {
  const features = record(data).features;
  if (!Array.isArray(features)) throw new Error('Invalid recreation sites response');
  return features.flatMap(value => {
    const f = record(value), geometry = record(f.geometry), c = geometry.coordinates;
    if (f.type !== 'Feature' || geometry.type !== 'Point' || !Array.isArray(c) || c.length < 2 ||
      typeof c[0] !== 'number' || !Number.isFinite(c[0]) || Math.abs(c[0]) > 180 ||
      typeof c[1] !== 'number' || !Number.isFinite(c[1]) || Math.abs(c[1]) > 90) return [];
    return [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [c[0], c[1]] }, properties: record(f.properties) }];
  });
}
registerLayer({
  id, name: 'Shooting ranges (OK)', category: 'trails', minzoom, maxzoom: 20, defaultOpacity: 1,
  swatch: '#a15b35', attribution: `<a href="${atlas}">Oklahoma Department of Wildlife Conservation</a>`,
  legend: [{ color: '#a15b35', label: 'Shooting ranges (OK)' }], layerIds: [circles],
  cacheRoute: /^https:\/\/www\.wildlifedepartment\.com\/server\/rest\/services\/PublicWILMA\/WILMAFeatures\/MapServer\/3\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">Oklahoma Department of Wildlife Conservation</a>` });
    map.addLayer({ id: circles, type: 'circle', source: id, minzoom, paint: {
      'circle-radius': 6, 'circle-color': '#a15b35',
      'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
    } }, ctx.beforeId);
    let loader = loaders.get(map);
    if (!loader) {
      const state: Loader = { on: false, refresh: true, async load() {
        state.controller?.abort();
        if (!state.on || map.getZoom() < minzoom) return;
        const source = map.getSource(id) as GeoJSONSource | undefined;
        if (!source) return;
        const controller = state.controller = new AbortController(), bounds = map.getBounds();
        try {
          const features = new globalThis.Map<string, Feature<Point>>();
          for (const envelope of fireEnvelopes(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth())) {
            for (let offset = 0; offset < 10000; offset += 500) {
              const params = new URLSearchParams({ f: 'geojson', where: '1=1',
                geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
                outFields: 'OBJECTID,RANGENAME,OPENTOPUBL,OPENHOURS,FEES,RANGELENGT,ARCHERY,HANDGUN,RIFLE,SHOTGUN,SKEETCLAYT,WMANAME',
                returnGeometry: 'true', resultRecordCount: '500', resultOffset: String(offset), orderByFields: 'OBJECTID' });
              const data = await fetchJson(`${service}/query?${params}`, controller.signal);
              const batch = points(data);
              for (const feature of batch) features.set(String(feature.properties?.OBJECTID), feature);
              if ((record(data).features as unknown[]).length < 500) break;
            }
          }
          if (!controller.signal.aborted && map.getSource(id) === source) {
            const collection: FeatureCollection<Point> = { type: 'FeatureCollection', features: [...features.values()] };
            source.setData(collection);
          }
        } catch { /* Retain the last viewed sites when offline. */ }
      } };
      const move = () => { void state.load(); };
      map.on('moveend', move);
      map.once('remove', () => { state.controller?.abort(); map.off('moveend', move); });
      loaders.set(map, state); loader = state;
    }
    loader.refresh = true;
  },
  setVisible(map, on) {
    if (map.getLayer(circles)) map.setLayoutProperty(circles, 'visibility', on ? 'visible' : 'none');
    const state = loaders.get(map);
    if (!state) return;
    const changed = state.on !== on; state.on = on;
    if (on && (changed || state.refresh)) { state.refresh = false; void state.load(); }
    if (!on) state.controller?.abort();
  },
  setOpacity(map, opacity) { map.setPaintProperty(circles, 'circle-opacity', opacity); map.setPaintProperty(circles, 'circle-stroke-opacity', opacity); },
  async identify(_lng, _lat, _signal, map, point) {
    const properties = map.getLayer(circles) ? map.queryRenderedFeatures(point, { layers: [circles] })[0]?.properties : undefined;
    if (!properties) return null;
    const rows: [string, string][] = [];
    for (const [label, value] of [['Public', properties.OPENTOPUBL], ['Hours', properties.OPENHOURS], ['Fees', properties.FEES], ['Length (yards)', properties.RANGELENGT], ['Archery', properties.ARCHERY], ['Handgun', properties.HANDGUN], ['Rifle', properties.RIFLE], ['Shotgun', properties.SHOTGUN], ['Skeet / clay', properties.SKEETCLAYT], ['Area', properties.WMANAME]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: text(properties.RANGENAME) && text(properties.RANGENAME).toLowerCase() !== 'null' ? text(properties.RANGENAME) : 'Shooting range', rows,
      links: [{ label: 'Oklahoma Wildlife Department', url: atlas }] };
  },
});
