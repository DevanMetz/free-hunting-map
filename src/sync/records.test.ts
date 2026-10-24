import { describe, expect, it } from 'vitest';
import { sanitizeRecord } from './records';
import { wp } from '../test/fixtures';

const meta = { id: 'settings:map', createdAt: 1, updatedAt: 2, deviceId: 'device', deleted: false };
describe('cloud record validation', () => {
  it('retains item validation and strips device-specific preference fields', () => {
    expect(sanitizeRecord(wp())).toEqual(wp());
    expect(sanitizeRecord({ ...meta, kind: 'settings', preferences: { labels: false, view: { zoom: 9 }, offlineRegions: ['x'], basemap: 'invalid' } })).toEqual({ ...meta, kind: 'settings', preferences: { labels: false } });
  });
  it('rejects invalid saved candidates and noncanonical settings IDs', () => {
    expect(sanitizeRecord({ ...meta, id: 'arbitrary-id', kind: 'settings' })).toBeNull();
    expect(sanitizeRecord({ ...meta, kind: 'lidar-run', box: [-90, 40, -89, 41], candidates: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[999, 0]] } }] } })).toBeNull();
    expect(sanitizeRecord({ ...meta, kind: 'lidar-run', box: [-90, 40, -91, 41], candidates: { type: 'FeatureCollection', features: [] } })).toBeNull();
  });
});
