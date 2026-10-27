import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes, fireFeatures } from './hazards';
import { record, fetchJson } from './raster';
import { text } from './arcgis';

const service = 'https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/24_25_7_29/FeatureServer/0';
const atlas = 'https://kdwpt.ks.gov/KDWP-Info/Locations/Hunting-Fishing-Atlases/Hunting-Atlas';
const id = 'kansas-wiha', fill = `${id}-fill`, line = `${id}-line`, minzoom = 9;
const periods: Record<string, string> = {
  AM: 'April 1 – May 31', NJ: 'November 1 – January 31', NMY: 'November 1 – May 31',
  SJ: 'September 1 – January 31', SMR: 'September 1 – March 31', SMY: 'September 1 – May 31',
};
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();
registerLayer({
  id, name: 'Kansas WIHA 2026–27', category: 'land', minzoom, maxzoom: 20, defaultOpacity: 0.85,
  swatch: '#ed9c25', attribution: `<a href="${atlas}">Kansas Department of Wildlife and Parks</a>`,
  legend: [{ color: '#ed9c25', label: 'Walk-in hunting access' }], layerIds: [fill, line],
  cacheRoute: /^https:\/\/services1\.arcgis\.com\/q2CglofYX6ACNEeu\/arcgis\/rest\/services\/24_25_7_29\/FeatureServer\/0\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">Kansas Department of Wildlife and Parks</a>` });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom, paint: { 'fill-color': '#ed9c25', 'fill-opacity': 0.15 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom, paint: { 'line-color': '#ed9c25', 'line-width': 2 } }, ctx.beforeId);
    let loader = loaders.get(map);
    if (!loader) {
      const state: Loader = { on: false, refresh: true, async load() {
        state.controller?.abort();
        if (!state.on || map.getZoom() < minzoom) return;
        const source = map.getSource(id) as GeoJSONSource | undefined;
        if (!source) return;
        const controller = state.controller = new AbortController();
        const bounds = map.getBounds();
        try {
          const features = new globalThis.Map<string, ReturnType<typeof fireFeatures>[number]>();
          for (const envelope of fireEnvelopes(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth())) {
            for (let offset = 0; offset < 10000; offset += 500) {
              const params = new URLSearchParams({ f: 'geojson', where: '1=1', geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope',
                inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FID,AREAID,COUNTY,LEGENDID,ACRES',
                returnGeometry: 'true', maxAllowableOffset: (360 / (512 * 2 ** Math.floor(map.getZoom()))).toFixed(6),
                resultRecordCount: '500', resultOffset: String(offset), orderByFields: 'FID' });
              const data = await fetchJson(`${service}/query?${params}`, controller.signal);
              for (const feature of fireFeatures(data)) features.set(String(feature.id ?? feature.properties?.FID), feature);
              const raw = record(data).features;
              if (!Array.isArray(raw) || raw.length < 500) break;
            }
          }
          if (!controller.signal.aborted && map.getSource(id) === source) {
            const collection: FeatureCollection<Polygon | MultiPolygon> = { type: 'FeatureCollection', features: [...features.values()] };
            source.setData(collection);
          }
        } catch { /* Retain the last viewed geometry when offline. */ }
      } };
      const move = () => { void state.load(); };
      map.on('moveend', move);
      map.once('remove', () => { state.controller?.abort(); map.off('moveend', move); });
      loaders.set(map, state); loader = state;
    }
    loader.refresh = true;
  },
  setVisible(map, on) {
    for (const layer of [fill, line]) if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
    const state = loaders.get(map);
    if (!state) return;
    const changed = state.on !== on; state.on = on;
    if (on && (changed || state.refresh)) { state.refresh = false; void state.load(); }
    if (!on) state.controller?.abort();
  },
  setOpacity(map, opacity) { map.setPaintProperty(fill, 'fill-opacity', opacity * 0.18); map.setPaintProperty(line, 'line-opacity', opacity); },
  async identify(_lng, _lat, _signal, map, point) {
    const layers = [fill, line].filter(layer => map.getLayer(layer));
    const properties = layers.length ? map.queryRenderedFeatures(point, { layers })[0]?.properties : undefined;
    if (!properties) return null;
    const code = text(properties.LEGENDID), base = code.replace(/ASO$/, '');
    const rows: [string, string][] = [['Season', '2026–27']];
    if (periods[base]) rows.push(['Access', periods[base]]);
    if (code.endsWith('ASO')) rows.push(['Restriction', 'Archery / shotshell only']);
    if (text(properties.AREAID)) rows.push(['Area', text(properties.AREAID)]);
    if (text(properties.COUNTY)) rows.push(['County', text(properties.COUNTY)]);
    if (text(properties.ACRES)) rows.push(['Acres', text(properties.ACRES)]);
    return { title: 'Kansas WIHA', rows, links: [{ label: 'Kansas hunting atlas', url: atlas }] };
  },
});
