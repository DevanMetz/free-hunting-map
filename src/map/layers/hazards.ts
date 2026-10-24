import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { registerLayers, type IdentifyResult, type LayerDef } from '../layerRegistry';
import { IIPP, IIPP_CACHE, fetchJson, pixelValue, rasterIdentify, rasterTiles, record } from './raster';

const NIFC = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/';
const CURRENT = `${NIFC}WFIGS_Interagency_Perimeters_Current/FeatureServer/0`;
const HISTORY = `${NIFC}InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0`;
const ATTR = '<a href="https://data-nifc.opendata.arcgis.com/">NIFC / WFIGS</a>';
const WHP = `${IIPP}Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer`;
type FireFeature = Feature<Polygon | MultiPolygon>;

const ring = (data: unknown): boolean => Array.isArray(data) && data.length >= 4 && data.every(p =>
  Array.isArray(p) && typeof p[0] === 'number' && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180 &&
  typeof p[1] === 'number' && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90);
const polygon = (data: unknown): boolean => Array.isArray(data) && data.length > 0 && data.every(ring);
export function fireFeatures(data: unknown): FireFeature[] {
  const features = record(data).features;
  if (!Array.isArray(features)) return [];
  return features.flatMap(value => {
    const f = record(value), geometry = record(f.geometry);
    if (f.type !== 'Feature' || !(geometry.type === 'Polygon' && polygon(geometry.coordinates) ||
      geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length && geometry.coordinates.every(polygon))) return [];
    return [{ type: 'Feature' as const, ...(typeof f.id === 'string' || typeof f.id === 'number' ? { id: f.id } : {}),
      geometry: geometry as unknown as Polygon | MultiPolygon, properties: record(f.properties) }];
  });
}

/** Pad/round view bounds for small, repeatable offline requests; split the dateline. */
export function fireEnvelopes(west: number, south: number, east: number, north: number): number[][] {
  if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) return [];
  const s = Math.max(-85, Math.floor(south * 100) / 100), n = Math.min(85, Math.ceil(north * 100) / 100);
  if (n <= s) return [];
  if (east - west >= 360) return [[-180, s, 180, n]];
  const w = Math.floor((((west + 180) % 360 + 360) % 360 - 180) * 100) / 100;
  const e = Math.ceil((w + east - west + 0.01) * 100) / 100;
  return e <= 180 ? [[w, s, e, n]] : [[w, s, 180, n], [-180, s, Math.min(180, e - 360), n]];
}

export function fireResult(data: unknown, current: boolean): IdentifyResult | null {
  const a = record(data);
  const name = current ? a.poly_IncidentName ?? a.attr_IncidentName : a.INCIDENT;
  if (typeof name !== 'string' || !name.trim()) return null;
  const rows: [string, string][] = [];
  const acres = pixelValue(current ? a.poly_GISAcres ?? a.attr_CalculatedAcres : a.GIS_ACRES);
  if (acres !== null && acres >= 0) rows.push(['Acres', acres.toLocaleString('en-US', { maximumFractionDigits: 0 })]);
  if (current) {
    const contained = pixelValue(a.attr_PercentContained);
    if (contained !== null && contained >= 0 && contained <= 100) rows.push(['Contained', `${contained}%`]);
    const updated = pixelValue(a.poly_DateCurrent);
    if (updated !== null && updated > 0 && Number.isFinite(new Date(updated).getTime())) rows.push(['Updated', new Date(updated).toISOString().slice(0, 10)]);
  } else {
    const year = pixelValue(a.FIRE_YEAR_INT);
    if (year !== null && year >= 1800 && year <= 2025) rows.unshift(['Year', String(year)]);
  }
  return { title: name.trim(), rows };
}

interface Loader { on: boolean; refresh: boolean; controller?: AbortController; timer?: ReturnType<typeof setInterval>; load(): Promise<void> }
function perimeters(current: boolean): LayerDef {
  const id = current ? 'current-fires' : 'historic-fires';
  const service = current ? CURRENT : HISTORY;
  const minzoom = current ? 6 : 9;
  const fill = `${id}-fill`, line = `${id}-line`;
  const loaders = new WeakMap<HuntMap, Loader>();
  const fields = current ? 'OBJECTID,poly_IncidentName,poly_GISAcres,attr_PercentContained,poly_DateCurrent' : 'OBJECTID,INCIDENT,GIS_ACRES,FIRE_YEAR_INT';
  const color: string | ExpressionSpecification = current ? '#e34234' : ['step', ['coalesce', ['get', 'FIRE_YEAR_INT'], 0], '#8c8c8c',
    1980, '#f6d55c', 1990, '#ed9839', 2000, '#df4b3e', 2010, '#a33162', 2020, '#733fa3'];
  return {
    id, name: current ? 'Current wildfires' : 'Historic fire perimeters', category: 'hazards', minzoom, maxzoom: 18,
    defaultOpacity: 0.8, swatch: current ? '#e34234' : '#a33162', attribution: ATTR, layerIds: [fill, line],
    cacheRoute: current
      ? /^https:\/\/services3\.arcgis\.com\/T4QMspbfLg3qTGWY\/arcgis\/rest\/services\/WFIGS_Interagency_Perimeters_Current\/FeatureServer\/0\/query\?/
      : /^https:\/\/services3\.arcgis\.com\/T4QMspbfLg3qTGWY\/arcgis\/rest\/services\/InterAgencyFirePerimeterHistory_All_Years_View\/FeatureServer\/0\/query\?/,
    cacheStrategy: current ? 'NetworkFirst' : 'CacheFirst',
    legend: current ? [{ color: '#e34234', label: 'Wildfire perimeter' }] : [
      { color: '#8c8c8c', label: 'Before 1980' }, { color: '#f6d55c', label: '1980s' }, { color: '#ed9839', label: '1990s' },
      { color: '#df4b3e', label: '2000s' }, { color: '#a33162', label: '2010s' }, { color: '#733fa3', label: '2020–2025' },
    ],
    install(map, ctx) {
      if (map.getSource(id)) return;
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: ATTR });
      map.addLayer({ id: fill, type: 'fill', source: id, minzoom, maxzoom: 18,
        paint: { 'fill-color': color, 'fill-opacity': 0.12 } }, ctx.beforeId);
      map.addLayer({ id: line, type: 'line', source: id, minzoom, maxzoom: 18,
        paint: { 'line-color': color, 'line-width': 1.8 } }, ctx.beforeId);
      let loader = loaders.get(map);
      if (!loader) {
        const state: Loader = { on: false, refresh: true, async load() {
          state.controller?.abort();
          if (!state.on || map.getZoom() < minzoom || map.getZoom() >= 18) return;
          const source = map.getSource(id) as GeoJSONSource | undefined;
          if (!source) return;
          const controller = state.controller = new AbortController();
          const bounds = map.getBounds();
          const envelopes = fireEnvelopes(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth());
          try {
            const features = new globalThis.Map<string | number, FireFeature>();
            for (const envelope of envelopes) {
              for (let offset = 0; offset < 10000; offset += 500) {
                const params = new URLSearchParams({ f: 'geojson', where: current ? "attr_IncidentTypeCategory = 'WF'" : 'FIRE_YEAR_INT <= 2025',
                  geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
                  spatialRel: 'esriSpatialRelIntersects', outFields: fields, returnGeometry: 'true',
                  maxAllowableOffset: (360 / (512 * 2 ** Math.floor(map.getZoom()))).toFixed(6),
                  resultRecordCount: '500', resultOffset: String(offset), orderByFields: 'OBJECTID' });
                const data = await fetchJson(`${service}/query?${params}`, controller.signal);
                for (const f of fireFeatures(data)) features.set(f.id ?? `feature-${features.size}`, f);
                const raw = record(data).features;
                if (!Array.isArray(raw) || raw.length < 500 && record(data).exceededTransferLimit !== true) break;
              }
            }
            if (!controller.signal.aborted && map.getSource(id) === source) {
              const collection: FeatureCollection<Polygon | MultiPolygon> = { type: 'FeatureCollection', features: [...features.values()] };
              source.setData(collection);
            }
          } catch { /* Keep viewed perimeters available during a network outage. */ }
        } };
        const move = () => { void state.load(); };
        map.on('moveend', move);
        map.once('remove', () => { state.controller?.abort(); clearInterval(state.timer); map.off('moveend', move); });
        loaders.set(map, state); loader = state;
      }
      loader.refresh = true;
    },
    setVisible(map, on) {
      for (const layer of [fill, line]) if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
      const state = loaders.get(map);
      if (!state) return;
      const changed = state.on !== on;
      state.on = on;
      if (on && (changed || state.refresh)) {
        state.refresh = false; void state.load();
        if (current && !state.timer) state.timer = setInterval(() => { void state.load(); }, 5 * 60 * 1000);
      } else if (!on) {
        state.controller?.abort(); clearInterval(state.timer); state.timer = undefined;
      }
    },
    setOpacity(map, opacity) {
      map.setPaintProperty(fill, 'fill-opacity', opacity * 0.15);
      map.setPaintProperty(line, 'line-opacity', opacity);
    },
    async identify(_lng, _lat, _signal, map, point) {
      const layers = [fill, line].filter(layer => map.getLayer(layer));
      if (!layers.length) return null;
      const hits = map.queryRenderedFeatures(point, { layers });
      if (!current) hits.sort((a, b) => (pixelValue(b.properties.FIRE_YEAR_INT) ?? 0) - (pixelValue(a.properties.FIRE_YEAR_INT) ?? 0));
      return fireResult(hits[0]?.properties, current);
    },
  };
}

registerLayers([
  { id: 'wildfire-potential', name: 'Wildfire hazard potential', category: 'hazards', defaultOpacity: 0.5, minzoom: 8, maxzoom: 18,
    attribution: '<a href="https://www.firelab.org/project/wildfire-hazard-potential">USDA Forest Service WHP 2023</a>', cacheRoute: IIPP_CACHE,
    source: { kind: 'raster', tiles: [rasterTiles(WHP, { noData: '6,7' })], minzoom: 8, maxzoom: 16 },
    legend: [{ color: '#38a300', label: 'Very low' }, { color: '#a3ff94', label: 'Low' }, { color: '#ffff63', label: 'Moderate' },
      { color: '#ffa300', label: 'High' }, { color: '#ed1e00', label: 'Very high' }],
    identify: rasterIdentify(WHP, 'Wildfire hazard potential', 'Potential', { noData: '6,7' }, { rasterFunction: 'WHP_CLS_2023_8bit', nameField: 'Classname' }, '2023'),
  }, perimeters(true), perimeters(false),
]);
