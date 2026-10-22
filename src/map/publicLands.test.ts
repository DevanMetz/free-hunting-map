import { expect, it } from 'vitest';
import { PUBLIC_LANDS, publicLandContent, publicLandExportUrl, publicLandQueryUrl, publicLandWhere } from './publicLands';
import { CACHE_ROUTES } from './cacheRoutes';

it('uses the exact manager filters and excludes all eight from other public land', () => {
  expect(PUBLIC_LANDS.map(c => c.where).slice(0, 8)).toEqual([
    "Mang_Name = 'USFS'", "Mang_Name = 'BLM'", "Mang_Name = 'NPS'", "Mang_Name = 'FWS'",
    "Mang_Type = 'STAT' AND (Mang_Name = 'SFW' OR (Mang_Name = 'SDNR' AND Des_Tp <> 'SP'))",
    "Mang_Type = 'STAT' AND (Des_Tp = 'SP' OR Mang_Name = 'SPR')", "Mang_Name = 'SLB'", "Mang_Name = 'DOD'",
  ]);
  expect(PUBLIC_LANDS[8].where).toBe("Mang_Type IN ('LOC','DIST','JNT','FED','STAT') AND NOT (" + PUBLIC_LANDS.slice(0, 8).map(c => `(${c.where})`).join(' OR ') + ')');
  expect(publicLandWhere(['blm', 'usfs'])).toBe("(Mang_Name = 'USFS') OR (Mang_Name = 'BLM')");
  expect(publicLandWhere([])).toBe('');
});
it('builds dynamic exports with category colors and preserves the tile placeholder', () => {
  for (const category of PUBLIC_LANDS) {
    const url = publicLandExportUrl(category);
    expect(url).toContain('bbox={bbox-epsg-3857}');
    const layers = JSON.parse(new URL(url).searchParams.get('dynamicLayers')!);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ id: 0, source: { type: 'mapLayer', mapLayerId: 0 }, definitionExpression: category.where });
    expect(layers[0].drawingInfo.renderer.symbol).toEqual({ type: 'esriSFS', style: 'esriSFSSolid', color: [...category.rgb, 95], outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [...category.rgb, 230], width: 1 } });
    expect(CACHE_ROUTES.padus.test(url)).toBe(true);
  }
});
it('queries only enabled categories and keeps queries outside runtime caches', () => {
  const url = publicLandQueryUrl(-90.81941, 44.51971, ['stateWildlife', 'other']);
  const params = new URL(url).searchParams;
  expect(params.get('geometry')).toBe('-90.81941,44.51971');
  expect(params.get('where')).toBe(publicLandWhere(['stateWildlife', 'other']));
  expect(params.get('outFields')).toBe('Mang_Name,Mang_Type,Loc_Mang,Unit_Nm,Des_Tp,Loc_Ds');
  expect(params.get('returnGeometry')).toBe('false');
  expect(Object.values(CACHE_ROUTES).some(route => route.test(url))).toBe(false);
  expect(new URL(publicLandQueryUrl(0, 0, [])).searchParams.get('where')).toBe('1=0');
});
it('formats public land names, managers and designations without interpreting markup', () => {
  expect(publicLandContent({ Mang_Name: 'CNTY', Loc_Mang: 'Clark County', Unit_Nm: 'Clark County Forest', Des_Tp: 'LCA', Loc_Ds: 'Forest Reserve' })).toEqual(['Clark County Forest', 'Clark County', 'Forest Reserve']);
  expect(publicLandContent({ Unit_Nm: '<Forest>', Mang_Name: 'USFS', Des_Tp: 'NF' })).toEqual(['<Forest>', 'U.S. Forest Service', 'NF']);
  for (const [code, manager] of Object.entries({ BLM: 'Bureau of Land Management', NPS: 'National Park Service', FWS: 'U.S. Fish and Wildlife Service', DOD: 'Department of Defense', SDNR: 'SDNR' })) expect(publicLandContent({ Mang_Name: code })).toEqual([manager]);
  expect(publicLandContent({})).toEqual([]);
});
