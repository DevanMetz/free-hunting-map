import { expect, it } from 'vitest';
import { fireEnvelopes, fireFeatures, fireResult } from './hazards';

it('splits wrapped viewports at the dateline and rejects invalid bounds', () => {
  expect(fireEnvelopes(179, 44, 181, 45)).toEqual([[179, 44, 180, 45], [-180, 44, -178.99, 45]]);
  expect(fireEnvelopes(-181, 44, -179, 45)).toEqual(fireEnvelopes(179, 44, 181, 45));
  expect(fireEnvelopes(-200, -90, 200, 90)).toEqual([[-180, -85, 180, 85]]);
  expect(fireEnvelopes(-91.2341, 44.1231, -90.9871, 44.4561)[0]).toEqual([-91.24, 44.12, -90.98, 44.46]);
  expect(fireEnvelopes(NaN, 0, 1, 1)).toEqual([]);
  expect(fireEnvelopes(0, 0, -1, 1)).toEqual([]);
});

it('accepts polygon and multipolygon feeds without passing malformed or non-finite geometries to the map', () => {
  const coordinates = [[[-91, 44], [-90, 44], [-90, 45], [-91, 44]]];
  const feature = { type: 'Feature', id: 7, properties: { INCIDENT: 'Test' }, geometry: { type: 'Polygon', coordinates } };
  const multi = { ...feature, id: 8, geometry: { type: 'MultiPolygon', coordinates: [coordinates] } };
  expect(fireFeatures({ type: 'FeatureCollection', features: [feature, multi, null,
    { ...feature, geometry: null }, { ...feature, geometry: { type: 'Point', coordinates: [-91, 44] } },
    { ...feature, geometry: { type: 'Polygon', coordinates: [[[Infinity, 44], [-90, 44], [-90, 45], [-91, 44]]] } },
  ] })).toEqual([feature, multi]);
  expect(fireFeatures({ error: { message: 'Unavailable' } })).toEqual([]);
});

it('identifies current fires with zero containment and a source update date, omitting unknown values', () => {
  expect(fireResult({ poly_IncidentName: 'Little Giant', poly_GISAcres: 172912.4, attr_PercentContained: 0, poly_DateCurrent: Date.UTC(2026, 9, 24) }, true)).toEqual({
    title: 'Little Giant', rows: [['Acres', '172,912'], ['Contained', '0%'], ['Updated', '2026-10-24']],
  });
  expect(fireResult({ poly_IncidentName: 'Fire', poly_GISAcres: null, attr_PercentContained: null, poly_DateCurrent: null }, true)).toEqual({ title: 'Fire', rows: [] });
  expect(fireResult({ poly_IncidentName: 'Fire', poly_GISAcres: -1, attr_PercentContained: 101 }, true)?.rows).toEqual([]);
  expect(fireResult({}, true)).toBeNull();
});

it('identifies historic fire names and years without confusing them with current incident attributes', () => {
  expect(fireResult({ INCIDENT: 'MILL CREEK', GIS_ACRES: 8627.1, FIRE_YEAR_INT: 1943 }, false)).toEqual({
    title: 'MILL CREEK', rows: [['Year', '1943'], ['Acres', '8,627']],
  });
  expect(fireResult({ INCIDENT: 'Unspecified', FIRE_YEAR_INT: null }, false)).toEqual({ title: 'Unspecified', rows: [] });
});
