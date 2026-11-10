import { communityHike, communityHikes, communityTrail, communityTrails } from './v1Community';
import { landArea, landPath, landPoint, listLayers } from './v1Land';
import { meCategories, meItem, meLidarScan, meLidarScans, mePins, meRecordings, meSettings, meSummary, meTrails } from './v1Me';
import { terrainPoint, terrainProfile, terrainSummary } from './v1Terrain';
import type { Operation, ParamSpec } from './v1Shared';

const q = (name: string, schema: Record<string, unknown>, required = false, description?: string): ParamSpec => ({ name, in: 'query', required, schema, ...(description ? { description } : {}) });
const path = (name: string): ParamSpec => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const bbox = (max: string) => q('bbox', { type: 'string' }, true, `west,south,east,north; at most ${max} per side`);
const page = [q('limit', { type: 'integer' }), q('cursor', { type: 'string' })];
const collection = [...page, q('bbox', { type: 'string' }), q('updated_since', { type: 'string' }), q('category', { type: 'string' }), q('geometry', { type: 'string', enum: ['simplified', 'full', 'none'] })];
const line = { type: 'object', required: ['geometry'], properties: { geometry: { type: 'object' }, samples: { type: 'integer', minimum: 2, maximum: 256 } } };

export const operations: Operation[] = [
  { id: 'terrain_point', method: 'GET', path: '/terrain/point', summary: 'Elevation, slope and aspect at a point', auth: 'optional', params: [q('lat', { type: 'number' }, true), q('lng', { type: 'number' }, true)], handler: terrainPoint },
  { id: 'terrain_profile', method: 'GET', path: '/terrain/profile', summary: 'Elevation profile along a path', auth: 'optional', params: [q('path', { type: 'string' }, true, 'lng,lat;lng,lat'), q('samples', { type: 'integer', minimum: 2, maximum: 256 })], handler: terrainProfile },
  { id: 'terrain_profile_post', method: 'POST', path: '/terrain/profile', summary: 'Elevation profile for a GeoJSON LineString', auth: 'optional', params: [], body: { schema: line, limit: 65_536 }, handler: terrainProfile },
  { id: 'terrain_summary', method: 'GET', path: '/terrain/summary', summary: 'Terrain statistics for a small bbox', auth: 'optional', params: [bbox('0.25 degrees')], handler: terrainSummary },
  { id: 'land_point', method: 'GET', path: '/land/point', summary: 'Public land, parcel and PLSS at a point', auth: 'optional', params: [q('lat', { type: 'number' }, true), q('lng', { type: 'number' }, true), q('include', { type: 'string' }, false, 'parcel,plss')], handler: landPoint },
  { id: 'land_area', method: 'GET', path: '/land/area', summary: 'Public land units intersecting a bbox', auth: 'optional', params: [bbox('0.5 degrees')], handler: landArea },
  { id: 'land_path', method: 'GET', path: '/land/path', summary: 'Public land units a line crosses', auth: 'optional', params: [q('path', { type: 'string' }, true, 'lng,lat;lng,lat')], handler: landPath },
  { id: 'list_layers', method: 'GET', path: '/layers', summary: 'Layer catalog and TileJSON URLs', auth: 'none', params: [q('lat', { type: 'number' }), q('lng', { type: 'number' })], handler: listLayers },
  { id: 'community_trails', method: 'GET', path: '/community/trails', summary: 'Community lidar trail lines in a bbox', auth: 'none', params: [bbox('0.5 degrees'), ...page], handler: communityTrails },
  { id: 'community_trail', method: 'GET', path: '/community/trails/{id}', summary: 'One community trail line', auth: 'none', params: [path('id')], handler: communityTrail },
  { id: 'community_hikes', method: 'GET', path: '/community/hikes', summary: 'Community-shared hikes in a bbox', auth: 'none', params: [bbox('0.5 degrees'), ...page], handler: communityHikes },
  { id: 'community_hike', method: 'GET', path: '/community/hikes/{id}', summary: 'One community hike', auth: 'none', params: [path('id')], handler: communityHike },
  { id: 'me_summary', method: 'GET', path: '/me', summary: 'API key and counts of synced items', auth: 'key', params: [], handler: meSummary },
  { id: 'me_pins', method: 'GET', path: '/me/pins', summary: 'Synced waypoints', auth: 'key', params: collection, handler: mePins },
  { id: 'me_trails', method: 'GET', path: '/me/trails', summary: 'Synced drawn tracks', auth: 'key', params: collection, handler: meTrails },
  { id: 'me_recordings', method: 'GET', path: '/me/recordings', summary: 'Synced GPS recordings', auth: 'key', params: collection, handler: meRecordings },
  { id: 'me_item', method: 'GET', path: '/me/items/{id}', summary: 'One synced pin or track', auth: 'key', params: [path('id')], handler: meItem },
  { id: 'me_lidar_scans', method: 'GET', path: '/me/lidar-scans', summary: 'Synced lidar scan summaries', auth: 'key', params: [...page, q('bbox', { type: 'string' })], handler: meLidarScans },
  { id: 'me_lidar_scan', method: 'GET', path: '/me/lidar-scans/{id}', summary: 'Candidates from one lidar scan', auth: 'key', params: [path('id')], handler: meLidarScan },
  { id: 'me_categories', method: 'GET', path: '/me/categories', summary: 'Synced categories', auth: 'key', params: [], handler: meCategories },
  { id: 'me_settings', method: 'GET', path: '/me/settings', summary: 'Portable map preferences', auth: 'key', params: [], handler: meSettings },
];

export function findOperation(method: string, pathname: string): { op: Operation; params: Record<string, string> } | 'method' | null {
  const rel = pathname.replace(/^\/api\/v1(?=\/|$)/, '') || '/';
  let methodMismatch = false;
  for (const op of operations) {
    const names: string[] = [];
    const pattern = new RegExp(`^${op.path.replace(/\{(\w+)\}/g, (_match, name: string) => { names.push(name); return '([^/]+)'; })}$`);
    const match = pattern.exec(rel);
    if (!match) continue;
    if (op.method !== method) { methodMismatch = true; continue; }
    return { op, params: Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)])) };
  }
  return methodMismatch ? 'method' : null;
}
