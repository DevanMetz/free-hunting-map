import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes, fireFeatures } from './hazards';
import { record, fetchJson } from './raster';
import { text } from './arcgis';

const service = 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/DNRWILDLandsOPENDATA/FeatureServer/0';
const atlas = 'https://www.michigan.gov/dnr/things-to-do/hunting/hap';
const id = 'michigan-hunter-access', fill = `${id}-fill`, line = `${id}-line`, minzoom = 7;
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();
registerLayer({
  id, name: 'Hunter access properties (MI)', category: 'land', minzoom, maxzoom: 20, defaultOpacity: 0.85,
  swatch: '#d39234', attribution: `<a href="${atlas}">Michigan Department of Natural Resources</a>`,
  legend: [{ color: '#d39234', label: 'Hunter access properties (MI)' }], layerIds: [fill, line],
  cacheRoute: /^https:\/\/services3\.arcgis\.com\/Jdnp1TjADvSDxMAX\/arcgis\/rest\/services\/DNRWILDLandsOPENDATA\/FeatureServer\/0\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">Michigan Department of Natural Resources</a>` });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom, paint: { 'fill-color': '#d39234', 'fill-opacity': 0.15 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom, paint: { 'line-color': '#d39234', 'line-width': 2, 'line-dasharray': [3, 2] } }, ctx.beforeId);
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
              const params = new URLSearchParams({ f: 'geojson', where: "ActiveOrInactive='Active'", geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope',
                inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,COUNTY,HAPID,HAPPermit,acres,SpecialComment,HAPInfo,HuntType',
                returnGeometry: 'true',
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
  setOpacity(map, opacity) { map.setPaintProperty(fill, 'fill-opacity', opacity * 0.18); map.setPaintProperty(line, 'line-opacity', opacity); },
  async identify(_lng, _lat, _signal, map, point) {
    const layers = [fill].filter(layer => map.getLayer(layer));
    const properties = layers.length ? map.queryRenderedFeatures(point, { layers })[0]?.properties : undefined;
    if (!properties) return null;
    const rows: [string, string][] = [];
    for (const [label, value] of [
      ['Property', properties.HAPID], ['County', properties.COUNTY],
      ['Acres', properties.acres == null ? '' : Math.round(Number(properties.acres)).toString()],
      ['Hunters allowed', properties.HAPPermit], ['Hunting', properties.HuntType],
      ['Check-in', properties.HAPInfo], ['Restrictions', properties.SpecialComment],
    ]) {
      const rendered = text(value).trim();
      if (rendered) rows.push([label, rendered]);
    }
    return { title: 'Michigan hunter access property', rows,
      links: [{ label: 'Michigan Hunter Access Program', url: atlas }] };
  },
});
