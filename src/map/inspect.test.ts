import { expect, it, vi } from 'vitest';
import { parcelContent, deerContent, identifyDeer } from './inspect';
it('formats owners, acres, parcel IDs and blank fields', () => {
  expect(parcelContent({ OWNERNME1: ' <Owner> ', OWNERNME2: 'Co-owner', GISACRES: 642.54, PARCELID: '040.0345.000' })).toEqual(['<Owner>\nCo-owner', '642.5 ac', 'Parcel 040.0345.000']);
  expect(parcelContent({ OWNERNME2: ' ', STATEID: 'WI1' })).toEqual(['Parcel WI1']);
  expect(parcelContent({ GISACRES: 0 })).toEqual(['0.0 ac']);
  expect(deerContent({ DEER_MGMT_UNIT_ID: '202', DEER_MANAGEMENT_ZONE: 'Central Forest Zone', METRO_SUBUNIT_NAME: ' ' })).toEqual(['Unit 202', 'Central Forest Zone']);
});
it('identifies deer units without HTTP caching', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ attributes: { DEER_MGMT_UNIT_ID: '202' } }] }) });
  vi.stubGlobal('fetch', fetcher);
  try {
    expect(await identifyDeer(-90, 44, new AbortController().signal)).toEqual(['Unit 202']);
    expect(fetcher.mock.calls[0]?.[1].cache).toBe('no-store');
  } finally { vi.unstubAllGlobals(); }
});
