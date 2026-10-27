import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes, fireFeatures } from './hazards';
import { record, fetchJson } from './raster';
import { text } from './arcgis';

const service = 'https://fwp-gis.mt.gov/arcgis/rest/services/wild/hpNewBMA_MIL/MapServer';
const atlas = 'https://fwp.mt.gov/hunt/access/blockmanagement/guide-maps';
const id = 'montana-block-management', fill = `${id}-fill`, line = `${id}-line`, minzoom = 9;
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();
registerLayer({
  id, name: 'Montana Block Management 2026', category: 'land', minzoom, maxzoom: 20, defaultOpacity: 0.85,
  swatch: '#b58339', attribution: `<a href="${atlas}">Montana FWP</a>`,
  legend: [{ color: '#b58339', label: 'Block Management' }, { color: '#e34234', label: 'Closed or restricted' }], layerIds: [fill, line],
  cacheRoute: /^https:\/\/fwp-gis\.mt\.gov\/arcgis\/rest\/services\/wild\/hpNewBMA_MIL\/MapServer\/[45]\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">Montana FWP</a>` });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom, paint: { 'fill-color': ['case', ['==', ['get', 'restricted'], true], '#e34234', '#b58339'], 'fill-opacity': 0.15 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom, paint: { 'line-color': ['case', ['==', ['get', 'restricted'], true], '#e34234', '#b58339'], 'line-width': 2 } }, ctx.beforeId);
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
            for (const layer of [5, 4]) for (let offset = 0; offset < 10000; offset += 500) {
              const params = new URLSearchParams({ f: 'geojson', where: '1=1', geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope',
                inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: layer === 4 ? 'OBJECTID,BMANUM,BMANAME,PTYPE,PDFMAP,REGION,STATUS' : 'OBJECTID,BMANUM,BMANAME,PTYPE,PDFMAP,REGION',
                returnGeometry: 'true', maxAllowableOffset: (360 / (512 * 2 ** Math.floor(map.getZoom()))).toFixed(6),
                resultRecordCount: '500', resultOffset: String(offset), orderByFields: 'OBJECTID' });
              const data = await fetchJson(`${service}/${layer}/query?${params}`, controller.signal);
              for (const feature of fireFeatures(data)) {
                feature.properties = { ...feature.properties, restricted: layer === 4 };
                features.set(`${layer}:${feature.id ?? feature.properties.OBJECTID}`, feature);
              }
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
    const rows: [string, string][] = [];
    if (text(properties.PTYPE)) rows.push(['Permission type', text(properties.PTYPE)]);
    if (text(properties.REGION)) rows.push(['Region', text(properties.REGION)]);
    if (text(properties.STATUS)) rows.push(['Status', text(properties.STATUS)]);
    const links = [{ label: 'Montana FWP access guide and maps', url: atlas }];
    const pdf = text(properties.PDFMAP);
    if (pdf.startsWith('https://fwp.mt.gov/')) links.unshift({ label: 'Official property map', url: pdf });
    return { title: text(properties.BMANAME) || 'Montana Block Management 2026', rows, links };
  },
});
