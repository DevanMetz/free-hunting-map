import { describe, expect, it } from 'vitest';
import { trk, wp } from '../test/fixtures';
import { FOREIGN_DEVICE, fromGeoJSON, toGeoJSON } from './geojson';

describe('GeoJSON', () => {
  it('round-trips our own items exactly', () => {
    const items = [wp(), wp({ id: '33333333-3333-4333-8333-333333333333', icon: 'camp', note: '' }), trk()];
    const text = JSON.stringify(toGeoJSON(items));
    expect(fromGeoJSON(JSON.parse(text))).toEqual(items);
  });

  it('imports foreign GeoJSON with stable content ids so re-imports dedupe', () => {
    const foreign = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-100.5, 40.25] }, properties: { title: 'Gate' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-100, 40], [-100.01, 40.01]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
      ],
    };
    const a = fromGeoJSON(foreign);
    const b = fromGeoJSON(JSON.parse(JSON.stringify(foreign)));
    expect(a).toHaveLength(2);
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ kind: 'waypoint', name: 'Gate', icon: 'pin', deviceId: FOREIGN_DEVICE, coord: [-100.5, 40.25] });
    expect(a[1]).toMatchObject({ kind: 'track', coords: [[-100, 40], [-100.01, 40.01]] });
  });

  it('drops invalid coordinates', () => {
    const bad = { type: 'Feature', geometry: { type: 'Point', coordinates: [500, 99] }, properties: {} };
    expect(fromGeoJSON(bad)).toEqual([]);
  });
});
