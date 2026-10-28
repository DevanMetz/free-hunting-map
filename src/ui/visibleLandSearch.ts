import type { Map as MapLibreMap } from 'maplibre-gl';

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
  { layer: 'montana-access-programs-fill', fields: ['LABEL'] },
  { layer: 'national-refuge-hunt-units-fill', fields: ['Hunt_Unit_Name', 'Organization_Name'] },
  { layer: 'utah-cwmu-fill', fields: ['Boundary_Name'] },
  { layer: 'designated-wilderness-fill', fields: ['NAME'] },
  { layer: 'new-mexico-designated-areas-fill', fields: ['NAME'] },
  { layer: 'georgia-designated-areas-fill', fields: ['Name', 'PropName'] },
  { layer: 'kentucky-elk-regulated-areas-fill', fields: ['Name'] },
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
  const fields = new Map<string, readonly string[]>(layers.map(({ layer, fields }) => [layer, fields]));
  const results = new Map<string, VisibleLandResult>();
  for (const feature of map.queryRenderedFeatures({ layers: layers.map(({ layer }) => layer) })) {
    const names = fields.get(feature.layer.id)?.map(field => feature.properties?.[field])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? [];
    const name = names[0]?.trim();
    if (!name) continue;
    const key = `${feature.layer.id}:${name.toLocaleLowerCase()}`;
    if (!names.some(value => value.toLocaleLowerCase().includes(needle)) || results.has(key)) continue;
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
