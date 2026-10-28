import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes } from './hazards';
import { fetchJson, record } from './raster';
import { text } from './arcgis';

const service = 'https://ert.gfp.sd.gov/arcgis/rest/services/SD_Public/RecreationalTrails/MapServer/0';
const atlas = 'https://gfp.sd.gov/maps/';
const id = 'south-dakota-park-trails', line = `${id}-line`, minzoom = 11;
type Road = LineString | MultiLineString;
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();

function roads(data: unknown): Feature<Road>[] {
  const features = record(data).features;
  if (!Array.isArray(features)) throw new Error('Invalid state park trails response');
  return features.flatMap(value => {
    const f = record(value), geometry = record(f.geometry);
    if (f.type !== 'Feature' || (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') || !Array.isArray(geometry.coordinates)) return [];
    return [{ type: 'Feature' as const, geometry: geometry as unknown as Road, properties: record(f.properties) }];
  });
}
registerLayer({
  id, name: 'State park trails (SD)', category: 'trails', minzoom, maxzoom: 20, defaultOpacity: 1,
  swatch: '#a46c35', attribution: `<a href="${atlas}">South Dakota Game, Fish and Parks</a>`,
  legend: [{ color: '#a46c35', label: 'State park trails (SD)' }], layerIds: [line],
  cacheRoute: /^https:\/\/ert\.gfp\.sd\.gov\/arcgis\/rest\/services\/SD_Public\/RecreationalTrails\/MapServer\/0\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">South Dakota Game, Fish and Parks</a>` });
    map.addLayer({ id: line, type: 'line', source: id, minzoom, paint: { 'line-color': '#a46c35', 'line-width': 3 } }, ctx.beforeId);
    let loader = loaders.get(map);
    if (!loader) {
      const state: Loader = { on: false, refresh: true, async load() {
        state.controller?.abort();
        if (!state.on || map.getZoom() < minzoom) return;
        const source = map.getSource(id) as GeoJSONSource | undefined;
        if (!source) return;
        const controller = state.controller = new AbortController(), bounds = map.getBounds();
        try {
          const features = new globalThis.Map<string, Feature<Road>>();
          for (const envelope of fireEnvelopes(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth())) {
            for (let offset = 0; offset < 10000; offset += 500) {
              const params = new URLSearchParams({ f: 'geojson', where: "Visible = 'Yes'",
                geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects',
                outFields: 'OBJECTID,TrailName,Park,Status,Hiking,Biking,Equestrian,Motorized,Watercraft,DifficultyRating,Comments', returnGeometry: 'true', resultRecordCount: '500', resultOffset: String(offset), orderByFields: 'OBJECTID' });
              const data = await fetchJson(`${service}/query?${params}`, controller.signal);
              for (const feature of roads(data)) features.set(String(feature.properties?.OBJECTID), feature);
              if ((record(data).features as unknown[]).length < 500) break;
            }
          }
          if (!controller.signal.aborted && map.getSource(id) === source) {
            const collection: FeatureCollection<Road> = { type: 'FeatureCollection', features: [...features.values()] };
            source.setData(collection);
          }
        } catch { /* Retain the last viewed trails when offline. */ }
      } };
      const move = () => { void state.load(); };
      map.on('moveend', move);
      map.once('remove', () => { state.controller?.abort(); map.off('moveend', move); });
      loaders.set(map, state); loader = state;
    }
    loader.refresh = true;
  },
  setVisible(map, on) {
    if (map.getLayer(line)) map.setLayoutProperty(line, 'visibility', on ? 'visible' : 'none');
    const state = loaders.get(map);
    if (!state) return;
    const changed = state.on !== on; state.on = on;
    if (on && (changed || state.refresh)) { state.refresh = false; void state.load(); }
    if (!on) state.controller?.abort();
  },
  setOpacity(map, opacity) { map.setPaintProperty(line, 'line-opacity', opacity); },
  async identify(_lng, _lat, _signal, map, point) {
    const properties = map.getLayer(line) ? map.queryRenderedFeatures(point, { layers: [line] })[0]?.properties : undefined;
    if (!properties) return null;
    const fields: [string, string][] = [['Park', 'Park'], ['Status', 'Status'], ['DifficultyRating', 'Difficulty'],
      ['Hiking', 'Hiking'], ['Biking', 'Biking'], ['Equestrian', 'Equestrian'], ['Motorized', 'Motorized'],
      ['Watercraft', 'Watercraft'], ['Comments', 'Notes']];
    const rows: [string, string][] = fields.flatMap(([key, label]) => { const value = text(properties[key]); return value ? [[label, value]] : []; });
    return { title: text(properties.TrailName) || 'State park trail', rows, links: [{ label: 'South Dakota Game, Fish and Parks', url: atlas }] };
  },
});
