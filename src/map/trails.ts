import type { FilterSpecification, LineLayerSpecification, Map as MLMap, PointLike, VectorSourceSpecification } from 'maplibre-gl';
import { TRAILS_ATTR, TRAILS_TILES, type BasemapId } from './sources';

export const TRAILS_SOURCE = 'public-trails';
const TYPES = ['road', 'foot', 'horse', 'bike', 'ohv', 'snow'] as const;
const LABELS: Record<string, string> = { foot: 'Foot trail', horse: 'Horse trail', bike: 'Bike trail', ohv: 'OHV trail', snow: 'Snow trail', road: 'Road' };
const SOURCES: Record<string, string> = {
  usfs_trails: 'USFS trails', usfs_mvum_trails: 'USFS MVUM trails', usfs_mvum_roads: 'USFS MVUM roads',
  usfs_roads: 'USFS roads', blm_gtlf: 'BLM Ground Transportation', nps_trails: 'NPS trails', usgs_ndt: 'USGS National Digital Trails',
};
export const TRAIL_HIT_LAYERS = [...TYPES.map(type => `public-trails-${type}`), 'public-trails-mvum'];
export function trailsSource(): VectorSourceSpecification {
  return { type: 'vector', tiles: [TRAILS_TILES], minzoom: 6, maxzoom: 14, attribution: TRAILS_ATTR };
}

export function trailLayers(on: boolean, basemap: BasemapId): LineLayerSpecification[] {
  const satellite = basemap === 'satellite';
  const colors = satellite
    ? ['#d0d1ca', '#ffc857', '#e7a4ff', '#66e6bf', '#ff6b6b', '#73dbff']
    : ['#77766d', '#5c3a1c', '#8b3baa', '#087c64', '#d1202f', '#147da5'];
  const layers: LineLayerSpecification[] = [];
  const add = (id: string, filter: FilterSpecification, minzoom: number, color: string, width: number, dash?: number[], mvum = false) => {
    const common = { type: 'line' as const, source: TRAILS_SOURCE, 'source-layer': 'trails', minzoom, filter,
      layout: { visibility: on ? 'visible' as const : 'none' as const, 'line-cap': 'round' as const, 'line-join': 'round' as const } };
    layers.push({ ...common, id: `${id}-casing`, paint: {
      'line-color': mvum || satellite ? '#20271f' : '#fffdf5',
      'line-width': ['interpolate', ['linear'], ['zoom'], minzoom, width + 1.7, 16, width + 3.2],
      'line-opacity': mvum ? 0.95 : 0.85,
    } });
    layers.push({ ...common, id, paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], minzoom, width, 16, width + 1.3],
      ...(dash ? { 'line-dasharray': dash } : {}),
    } });
  };
  TYPES.forEach((type, i) => add(`public-trails-${type}`,
    ['all', ['==', ['get', 'type'], type], ['!=', ['get', 'mvum'], 1]],
    type === 'road' ? 11 : type === 'ohv' ? 8 : 9, colors[i]!, type === 'road' ? 0.7 : 1.7,
    type === 'foot' ? [2, 1.6] : type === 'horse' ? [4, 2] : undefined));
  const mvumColor = satellite ? '#ffb14e' : '#e47b13';
  add('public-trails-mvum-road', ['all', ['==', ['get', 'mvum'], 1], ['==', ['get', 'type'], 'road']], 11, mvumColor, 1.6, undefined, true);
  add('public-trails-mvum', ['all', ['==', ['get', 'mvum'], 1], ['!=', ['get', 'type'], 'road']], 8, mvumColor, 3, undefined, true);
  return layers;
}

/** Rendered-line query with a 32px target, after tools and saved-item hits. */
export function trailAt(map: Pick<MLMap, 'getLayer' | 'queryRenderedFeatures' | 'project'>, point: { x: number; y: number }, hitLayers: readonly string[] = TRAIL_HIT_LAYERS): Record<string, unknown> | undefined {
  const layers = hitLayers.filter(id => map.getLayer(id));
  if (!layers.length) return;
  const { x, y } = point;
  const hits = map.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]] as [PointLike, PointLike], { layers });
  let closest = hits[0], distance = Infinity;
  for (const hit of hits) {
    const geometry = hit.geometry;
    const lines = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const a = map.project(line[i - 1] as [number, number]), b = map.project(line[i] as [number, number]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
      if (d < distance) { closest = hit; distance = d; }
    }
  }
  return closest?.properties;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export function trailDetails(p: Record<string, unknown>): { title: string; rows: [string, string][] } {
  const type = LABELS[text(p.type)] ?? text(p.type);
  const rows: [string, string][] = [
    ['Type', type], ['Allowed uses', text(p.uses)], ['Seasons', text(p.seasons)],
    ['Agency', [text(p.agency), text(p.unit)].filter(Boolean).join(' · ')],
    ['Source', [SOURCES[text(p.src)] ?? text(p.src), text(p.date)].filter(Boolean).join(' · ')],
  ];
  return { title: text(p.name) || type || 'Public trails', rows: rows.filter(([, value]) => Boolean(value)) };
}
