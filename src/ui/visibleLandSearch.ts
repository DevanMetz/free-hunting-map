import type { Map as MapLibreMap } from 'maplibre-gl';

// These polygon layers load complete GeoJSON features for the current view.
const searchable = [
  { layer: 'montana-wma-fill', field: 'NAME' },
  { layer: 'florida-wma-fill', field: 'NAME' },
  { layer: 'texas-wma-fill', field: 'LoName' },
  { layer: 'national-wildlife-refuges-fill', field: 'ORGNAME' },
] as const;

export interface VisibleLandResult {
  name: string;
  center: [number, number];
}

export function visibleLandSearch(map: MapLibreMap, query: string): VisibleLandResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const layers = searchable.filter(({ layer }) => map.getLayer(layer) && map.getLayoutProperty(layer, 'visibility') !== 'none');
  if (!layers.length) return [];
  const fields = new Map<string, string>(layers.map(({ layer, field }) => [layer, field]));
  const results = new Map<string, VisibleLandResult>();
  for (const feature of map.queryRenderedFeatures({ layers: layers.map(({ layer }) => layer) })) {
    const field = fields.get(feature.layer.id);
    const value: unknown = field && feature.properties?.[field];
    if (typeof value !== 'string') continue;
    const name = value.trim();
    const key = `${feature.layer.id}:${name.toLocaleLowerCase()}`;
    if (!name.toLocaleLowerCase().includes(needle) || results.has(key)) continue;
    // Rendered polygon geometry can be clipped to a tile. A point on that fragment
    // keeps navigation on the visible feature instead of fitting misleading bounds.
    const geometry = feature.geometry;
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue;
    const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
    const point = ring?.[0];
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    results.set(key, { name, center: [point[0]!, point[1]!] });
    if (results.size === 20) break;
  }
  return [...results.values()];
}
