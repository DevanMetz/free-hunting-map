import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes, fireFeatures } from './hazards';
import { record, fetchJson } from './raster';
import { text } from './arcgis';

const service = 'https://services5.arcgis.com/RMHPuOW5MJ6iyTV6/ArcGIS/rest/services/KDFWR_Elk_Hunting_Areas_WFL1_1/FeatureServer/4';
const atlas = 'https://fw.ky.gov/Hunt/Pages/ElkHuntingInfo.aspx';
const id = 'kentucky-elk-regulated-areas', fill = `${id}-fill`, line = `${id}-line`, minzoom = 7;
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();
registerLayer({
  id, name: 'Elk regulated areas (KY)', category: 'land', minzoom, maxzoom: 20, defaultOpacity: 0.85,
  swatch: '#9b6a35', attribution: `<a href="${atlas}">Kentucky Department of Fish and Wildlife Resources</a>`,
  legend: [{ color: '#9b6a35', label: 'Elk regulated areas (KY)' }], layerIds: [fill, line],
  cacheRoute: /^https:\/\/services5\.arcgis\.com\/RMHPuOW5MJ6iyTV6\/ArcGIS\/rest\/services\/KDFWR_Elk_Hunting_Areas_WFL1_1\/FeatureServer\/4\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">Kentucky Department of Fish and Wildlife Resources</a>` });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom, paint: { 'fill-color': '#9b6a35', 'fill-opacity': 0.12 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom, paint: { 'line-color': '#9b6a35', 'line-width': 2, 'line-dasharray': [3, 2] } }, ctx.beforeId);
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
                inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,Name,UnitNumb,Counties,Public_Hunting_Area',
                returnGeometry: 'true', maxAllowableOffset: (360 / (512 * 2 ** Math.floor(map.getZoom()))).toFixed(6),
                resultRecordCount: '500', resultOffset: String(offset), orderByFields: 'OBJECTID' });
              const data = await fetchJson(`${service}/query?${params}`, controller.signal);
              for (const feature of fireFeatures(data)) features.set(String(feature.id ?? feature.properties?.OBJECTID), feature);
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
  setOpacity(map, opacity) { map.setPaintProperty(line, 'line-opacity', opacity); map.setPaintProperty(fill, 'fill-opacity', opacity * 0.12); },
  async identify(_lng, _lat, _signal, map, point) {
    const layers = [fill].filter(layer => map.getLayer(layer));
    const features = layers.length ? map.queryRenderedFeatures(point, { layers }) : [];
    if (!features.length) return null;
    const rows: [string, string][] = [];
    for (const feature of features) {
      const properties = feature.properties;
      const name = text(properties.Name);
      if (name) rows.push(['Area', name]);
      if (properties.UnitNumb != null) rows.push(['Unit', String(properties.UnitNumb)]);
      const counties = text(properties.Counties);
      if (counties) rows.push(['Counties', counties]);
      const publicArea = text(properties.Public_Hunting_Area);
      if (publicArea) rows.push(['Public hunting area', publicArea]);
    }
    return { title: 'Elk regulated area', rows,
      links: [{ label: 'Kentucky elk hunting information', url: atlas }] };
  },
});
