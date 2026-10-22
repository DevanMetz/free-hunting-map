// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { trk, wp } from '../test/fixtures';
import { FOREIGN_DEVICE } from './geojson';
import { fromGpx, toGpx } from './gpx';

describe('GPX', () => {
  it('round-trips our own items exactly, including metadata', () => {
    const items = [
      wp({ name: 'Stand <north> & "east"', note: "Dad's spot" }),
      wp({ id: '44444444-4444-4444-8444-444444444444', icon: 'truck', note: '', deleted: true }),
      trk(),
    ];
    expect(fromGpx(toGpx(items))).toEqual(items);
  });

  it('imports foreign GPX (wpt, trk, rte) with deterministic ids', () => {
    const xml = `<?xml version="1.0"?>
      <gpx version="1.1" creator="Other" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="45.1" lon="-93.2"><name>Scrape</name><sym>Flag, Blue</sym></wpt>
        <trk><name>Walk in</name><trkseg><trkpt lat="45.1" lon="-93.2"/><trkpt lat="45.11" lon="-93.21"/></trkseg></trk>
        <rte><rtept lat="45" lon="-93"/><rtept lat="45.01" lon="-93.01"/></rte>
      </gpx>`;
    const a = fromGpx(xml);
    expect(a).toHaveLength(3);
    expect(a[0]).toMatchObject({ kind: 'waypoint', name: 'Scrape', icon: 'pin', coord: [-93.2, 45.1], deviceId: FOREIGN_DEVICE });
    expect(a[1]).toMatchObject({ kind: 'track', name: 'Walk in' });
    expect(fromGpx(xml)).toEqual(a);
  });

  it('throws on invalid XML', () => {
    expect(() => fromGpx('<gpx><wpt></gpx')).toThrow();
  });
});
