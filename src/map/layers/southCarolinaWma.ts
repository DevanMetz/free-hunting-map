import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { fireEnvelopes, fireFeatures } from './hazards';
import { record, fetchJson } from './raster';
import { text } from './arcgis';

const service = 'https://services.arcgis.com/acgZYxoN5Oj8pDLa/arcgis/rest/services/DEV_-_SCDNR_Public_Lands_Viewer/FeatureServer/4';
const atlas = 'https://public-lands-scdnr.hub.arcgis.com/';
const id = 'south-carolina-wma', fill = `${id}-fill`, line = `${id}-line`, minzoom = 7;
interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }
const loaders = new WeakMap<HuntMap, Loader>();
registerLayer({
  id, name: 'Wildlife management areas (SC)', category: 'land', minzoom, maxzoom: 20, defaultOpacity: 0.85,
  swatch: '#d39234', attribution: `<a href="${atlas}">South Carolina Department of Natural Resources</a>`,
  legend: [{ color: '#d39234', label: 'Wildlife management areas (SC)' }], layerIds: [fill, line],
  cacheRoute: /^https:\/\/services\.arcgis\.com\/acgZYxoN5Oj8pDLa\/arcgis\/rest\/services\/DEV_-_SCDNR_Public_Lands_Viewer\/FeatureServer\/4\/query\?/,
  cacheStrategy: 'NetworkFirst',
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: `<a href="${atlas}">South Carolina Department of Natural Resources</a>` });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom, paint: { 'fill-color': '#d39234', 'fill-opacity': 0 } }, ctx.beforeId);
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
              const params = new URLSearchParams({ f: 'geojson', where: "Hunting = 'Yes' AND WildlifeManagementArea <> 'None'", geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope',
                inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,PropertyName,PropertyTract,WildlifeManagementArea,PublicAccess,County,SCDNR_GameZone,ReportedAcres,prop_page_url,map_pdf_url',
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
  setOpacity(map, opacity) { map.setPaintProperty(line, 'line-opacity', opacity); },
  async identify(_lng, _lat, _signal, map, point) {
    const layers = [fill].filter(layer => map.getLayer(layer));
    const properties = layers.length ? map.queryRenderedFeatures(point, { layers })[0]?.properties : undefined;
    if (!properties) return null;
    const links = [{ label: 'South Carolina public lands', url: atlas }];
    const page = text(properties.prop_page_url);
    const pdf = text(properties.map_pdf_url);
    if (page.startsWith('https://public-lands-scdnr.hub.arcgis.com/')) links.unshift({ label: 'Official property details', url: page });
    if (pdf.startsWith('https://www.dnr.sc.gov/') || pdf.startsWith('https://dnr.sc.gov/')) links.unshift({ label: 'Official area map', url: pdf });
    const access = text(properties.PublicAccess);
    return { title: text(properties.PropertyName) || 'South Carolina wildlife management area',
      rows: [['Tract', text(properties.PropertyTract)], ['Access', access === 'SS' ? 'Seasonal' : access], ['County', text(properties.County)], ['Game zone', text(properties.SCDNR_GameZone)], ['Acres', text(properties.ReportedAcres)]], links };
  },
});
