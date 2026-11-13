import type { ExpressionSpecification, FilterSpecification, Map } from 'maplibre-gl';
import { registerLayers, type IdentifyResult } from '../layerRegistry';
import { roadTiles } from '../sources';
import { parcelLabel, stateLandRecord } from '../stateLandCatalog';

const archive = 'state-land';
const version = 'v1';
const source = 'state-land';
const tiles = [roadTiles(archive, version)];
const cacheRoute = /^\/tiles\/state-land\/v\d+\/\d+\/\d+\/\d+\.mvt$/;
const padus = '<a href="https://doi.org/10.5066/P96WBCHS">USGS PAD-US 4.1</a> · Public domain';
const hawaii = '<a href="https://planning.hawaii.gov/gis/download-gis-data-expanded/">Hawaii Statewide GIS Program</a> · Public domain';
const sourceAttribution = `${padus}; ${hawaii}`;
const classes = [
  ['usfs', 'USFS', '#3f8f3a'],
  ['blm', 'BLM', '#e9b931'],
  ['nps', 'NPS', '#8e63b5'],
  ['fws', 'FWS', '#e07b39'],
  ['wildlife', 'State wildlife', '#2f78c4'],
  ['park', 'State park', '#5fb8e8'],
  ['trust', 'State trust', '#27a99a'],
  ['dod', 'DOD', '#d2455b'],
  ['other', 'Other public', '#a08a6a'],
] as const;
const color = ['match', ['get', 'c'], ...classes.flatMap(([id, , paint]) => [id, paint]), '#a08a6a'] as unknown as ExpressionSpecification;
const access: Record<string, string> = { OA: 'Open', RA: 'Restricted', XA: 'Closed', UK: 'Unknown' };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

function properties(map: Map, point: Parameters<Map['queryRenderedFeatures']>[0], layers: string[]): Record<string, unknown> | undefined {
  const present = layers.filter(id => map.getLayer(id));
  return present.length ? map.queryRenderedFeatures(point, { layers: present })[0]?.properties ?? undefined : undefined;
}
function acres(value: unknown): string {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? `${number} ac` : '';
}

const publicFill = 'state-public-land-fill';
const publicLine = 'state-public-land-line';
const parcelFill = 'state-parcels-fill';
const parcelLine = 'state-parcels-line';

registerLayers([
  {
    id: 'state-public-land', category: 'land', name: 'Public land', swatch: '#2f78c4', defaultOpacity: 0.85, minzoom: 5,
    attribution: padus, cacheRoute, layerIds: [publicFill, publicLine],
    legend: classes.map(([, label, paint]) => ({ label, color: paint })),
    install(map, ctx) {
      if (!map.getSource(source)) map.addSource(source, { type: 'vector', tiles, minzoom: 5, maxzoom: 15, attribution: sourceAttribution });
      const filter = ['==', ['get', 'k'], 'public'] as FilterSpecification;
      if (!map.getLayer(publicFill)) map.addLayer({ id: publicFill, type: 'fill', source, 'source-layer': 'land', filter, minzoom: 5, paint: { 'fill-color': color, 'fill-opacity': 0.28 } }, ctx.beforeId);
      if (!map.getLayer(publicLine)) map.addLayer({ id: publicLine, type: 'line', source, 'source-layer': 'land', filter, minzoom: 5, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 15, 1.6] } }, ctx.beforeId);
    },
    setVisible(map, on) {
      for (const id of [publicFill, publicLine]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    },
    setOpacity(map, opacity) {
      if (map.getLayer(publicFill)) map.setPaintProperty(publicFill, 'fill-opacity', opacity * 0.33);
      if (map.getLayer(publicLine)) map.setPaintProperty(publicLine, 'line-opacity', opacity);
    },
    async identify(_lng, _lat, _signal, map, point): Promise<IdentifyResult | null> {
      const p = properties(map, point, [publicFill, publicLine]);
      if (!p || p.k !== 'public') return null;
      const state = stateLandRecord(text(p.st));
      const rows: [string, string][] = [];
      if (state) rows.push(['State', state.name]);
      if (text(p.m)) rows.push(['Manager', text(p.m)]);
      const kind = classes.find(([id]) => id === p.c);
      if (kind) rows.push(['Kind', kind[1]]);
      if (access[text(p.a)]) rows.push(['Access', access[text(p.a)]!]);
      if (acres(p.ac)) rows.push(['Acres', acres(p.ac)]);
      if (parcelLabel(text(p.pc))) rows.push(['Parcels', parcelLabel(text(p.pc))]);
      return { title: text(p.n) || 'Public land', rows };
    },
  },
  {
    id: 'state-parcels', category: 'land', name: 'Parcels (HI)', swatch: '#b0306a', defaultOpacity: 0.8, minzoom: 13,
    attribution: hawaii, cacheRoute, layerIds: [parcelFill, parcelLine],
    install(map, ctx) {
      if (!map.getSource(source)) map.addSource(source, { type: 'vector', tiles, minzoom: 5, maxzoom: 15, attribution: sourceAttribution });
      const filter = ['==', ['get', 'k'], 'parcel'] as FilterSpecification;
      if (!map.getLayer(parcelFill)) map.addLayer({ id: parcelFill, type: 'fill', source, 'source-layer': 'land', filter, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
      if (!map.getLayer(parcelLine)) map.addLayer({ id: parcelLine, type: 'line', source, 'source-layer': 'land', filter, minzoom: 13, paint: {
        'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.6],
      } }, ctx.beforeId);
    },
    setVisible(map, on) {
      for (const id of [parcelFill, parcelLine]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    },
    setOpacity(map, opacity) {
      if (map.getLayer(parcelLine)) map.setPaintProperty(parcelLine, 'line-opacity', opacity);
    },
    async identify(_lng, _lat, _signal, map, point): Promise<IdentifyResult | null> {
      const p = properties(map, point, [parcelFill]);
      if (!p) return null;
      const rows: [string, string][] = [['State', 'Hawaii']];
      if (text(p.n)) rows.push(['TMK', text(p.n)]);
      if (text(p.m)) rows.push(['County', text(p.m)]);
      if (acres(p.ac)) rows.push(['Acres', acres(p.ac)]);
      return { title: 'Hawaii parcel', rows };
    },
  },
]);
