import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

// These polygon layers load complete GeoJSON features for the current view.
const searchable = [
  { layer: 'montana-wma-fill', fields: ['NAME'] },
  { layer: 'florida-wma-fill', fields: ['NAME'] },
  { layer: 'texas-wma-fill', fields: ['LoName'] },
  { layer: 'national-wildlife-refuges-fill', fields: ['ORGNAME'] },
  { layer: 'ohio-dnr-lands-fill', fields: ['LANDS_NAME', 'ALT_NAME'] },
  { layer: 'missouri-conservation-areas-fill', fields: ['OFF_Name', 'Area_Name'] },
  { layer: 'alabama-wma-fill', fields: ['Name'] },
  { layer: 'west-virginia-wma-fill', fields: ['Name'] },
  { layer: 'south-carolina-wma-fill', fields: ['PropertyName'] },
  { layer: 'georgia-public-properties-fill', fields: ['PropName'] },
  { layer: 'arkansas-wma-fill', fields: ['wma', 'fname', 'flabel'] },
  { layer: 'iowa-public-hunting-fill', fields: ['AREA_NAME'] },
  { layer: 'kentucky-public-hunting-fill', fields: ['AREANAME'] },
  { layer: 'virginia-wma-fill', fields: ['WMA_NAME'] },
  { layer: 'oklahoma-wildlife-areas-fill', fields: ['WMANAME'] },
  { layer: 'tennessee-hunting-lands-fill', fields: ['NAME'] },
  { layer: 'louisiana-managed-lands-fill', fields: ['NAME'] },
  { layer: 'north-carolina-game-lands-fill', fields: ['GML_HAB'] },
  { layer: 'colorado-public-properties-fill', fields: ['PropName'] },
  { layer: 'michigan-wildlife-properties-fill', fields: ['OfficialWLDProjectAreaName'] },
  { layer: 'michigan-park-hunting-fill', fields: ['Facility'] },
  { layer: 'montana-block-management-fill', fields: ['BMANAME'] },
  { layer: 'national-refuge-hunt-units-fill', fields: ['Hunt_Unit_Name', 'Organization_Name'] },
  { layer: 'utah-cwmu-fill', fields: ['Boundary_Name'] },
] as const;

export interface VisibleLandResult {
  name: string;
  center: [number, number];
  source: string;
  field: string;
}

export function visibleLandSearch(map: MapLibreMap, query: string): VisibleLandResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  const layers = searchable.filter(({ layer }) => map.getLayer(layer) && map.getLayoutProperty(layer, 'visibility') !== 'none');
  if (!layers.length) return [];
  const fields = new Map<string, readonly string[]>(layers.map(({ layer, fields }) => [layer, fields]));
  const results = new Map<string, VisibleLandResult>();
  for (const feature of map.queryRenderedFeatures({ layers: layers.map(({ layer }) => layer) })) {
    const names = fields.get(feature.layer.id)?.map(field => feature.properties?.[field])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? [];
    const name = names[0]?.trim();
    const field = fields.get(feature.layer.id)?.find(key => feature.properties?.[key] === names[0]);
    if (!name || !field) continue;
    const key = `${feature.layer.id}:${name.toLocaleLowerCase()}`;
    if (!names.some(value => value.toLocaleLowerCase().includes(needle)) || results.has(key)) continue;
    // Rendered polygon geometry can be clipped to a tile. A point on that fragment
    // keeps navigation on the visible feature instead of fitting misleading bounds.
    const geometry = feature.geometry;
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue;
    const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
    const point = ring?.[0];
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    results.set(key, { name, center: [point[0]!, point[1]!], source: feature.source, field });
    if (results.size === 20) break;
  }
  return [...results.values()];
}

// GeoJSON sources retain the complete agency geometry even though rendered tiles
// can clip it. Ambiguous names fall back to the visible fragment.
export async function loadedLandBounds(map: MapLibreMap, result: VisibleLandResult): Promise<[[number, number], [number, number]] | null> {
  const source = map.getSource(result.source) as GeoJSONSource | undefined;
  if (!source || typeof source.getData !== 'function') return null;
  const data = await source.getData();
  if (data.type !== 'FeatureCollection') return null;
  const matches = data.features.filter(feature => typeof feature.properties?.[result.field] === 'string' && feature.properties[result.field].trim() === result.name &&
    (feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'));
  if (matches.length !== 1) return null;
  const geometry = matches[0]!.geometry;
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return null;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (const point of ring) {
    const [lng, lat] = point;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    west = Math.min(west, lng!); south = Math.min(south, lat!);
    east = Math.max(east, lng!); north = Math.max(north, lat!);
  }
  if (!Number.isFinite(west) || east - west > 180 || south < -90 || north > 90) return null;
  return [[west, south], [east, north]];
}
