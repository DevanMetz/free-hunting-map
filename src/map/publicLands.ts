import { PADUS_EXPORT, PADUS_QUERY } from './sources';

export const PUBLIC_LANDS = [
  {"id": "usfs", "label": "USFS", "color": "#3f8f3a", "rgb": [63, 143, 58], "where": "Mang_Name = 'USFS'", "info": "National forest land. Generally open to hunting and dispersed camping. Forest orders can close areas or roads and limit camping. Check local rules."},
  {"id": "blm", "label": "BLM", "color": "#e9b931", "rgb": [233, 185, 49], "where": "Mang_Name = 'BLM'", "info": "Bureau of Land Management land. Generally open to hunting and dispersed camping, often limited to 14 days at one site. Check local rules."},
  {"id": "nps", "label": "NPS", "color": "#8e63b5", "rgb": [142, 99, 181], "where": "Mang_Name = 'NPS'", "info": "National Park Service land. Hunting is usually prohibited, except in some national preserves and other units where it is authorized. Camping is usually in designated sites or by permit. Check local rules."},
  {"id": "fws", "label": "FWS", "color": "#e07b39", "rgb": [224, 123, 57], "where": "Mang_Name = 'FWS'", "info": "National wildlife refuge land. Hunting is allowed only where the refuge hunt plan permits it, often with refuge-specific rules. Camping is usually not allowed. Check local rules."},
  {"id": "stateWildlife", "label": "State wildlife", "color": "#2f78c4", "rgb": [47, 120, 196], "where": "Mang_Type = 'STAT' AND (Mang_Name = 'SFW' OR (Mang_Name = 'SDNR' AND Des_Tp <> 'SP'))", "info": "State fish and wildlife or natural resources land, such as wildlife areas and state forests. Usually open to hunting under state regulations; camping rules vary. Check local rules."},
  {"id": "statePark", "label": "State park", "color": "#5fb8e8", "rgb": [95, 184, 232], "where": "Mang_Type = 'STAT' AND (Des_Tp = 'SP' OR Mang_Name = 'SPR')", "info": "State park land. Hunting is often limited to certain parks, areas or seasons. Camping is usually in designated sites. Check local rules."},
  {"id": "stateTrust", "label": "State trust", "color": "#27a99a", "rgb": [39, 169, 154], "where": "Mang_Name = 'SLB'", "info": "State trust land, managed to earn revenue for schools and other beneficiaries. Access varies by state; some require a permit and some are closed. Check local rules."},
  {"id": "dod", "label": "DOD", "color": "#d2455b", "rgb": [210, 69, 91], "where": "Mang_Name = 'DOD'", "info": "Military land. Access is restricted. Where hunting is offered it usually requires base permits and check-in. Check local rules."},
  {"id": "other", "label": "Other public", "color": "#a08a6a", "rgb": [160, 138, 106], "where": "Mang_Type IN ('LOC','DIST','JNT','FED','STAT') AND NOT ((Mang_Name = 'USFS') OR (Mang_Name = 'BLM') OR (Mang_Name = 'NPS') OR (Mang_Name = 'FWS') OR (Mang_Type = 'STAT' AND (Mang_Name = 'SFW' OR (Mang_Name = 'SDNR' AND Des_Tp <> 'SP'))) OR (Mang_Type = 'STAT' AND (Des_Tp = 'SP' OR Mang_Name = 'SPR')) OR (Mang_Name = 'SLB') OR (Mang_Name = 'DOD'))", "info": "County, local and other public land. Access rules vary by owner. Check local rules."},
 ] as const;
export type PublicLandId = typeof PUBLIC_LANDS[number]['id'];
export type PublicLandState = Record<PublicLandId, boolean>;
export function publicLandDefaults(on = false): PublicLandState {
  return Object.fromEntries(PUBLIC_LANDS.map(({ id }) => [id, on])) as PublicLandState;
}
export function publicLandWhere(ids: readonly PublicLandId[]): string {
  return PUBLIC_LANDS.filter(({ id }) => ids.includes(id)).map(({ where }) => `(${where})`).join(' OR ');
}
export function publicLandExportUrl(category: typeof PUBLIC_LANDS[number]): string {
  const { where, rgb } = category;
  const dynamicLayers = [{ id: 0, source: { type: 'mapLayer', mapLayerId: 0 }, definitionExpression: where,
    drawingInfo: { renderer: { type: 'simple', symbol: { type: 'esriSFS', style: 'esriSFSSolid', color: [...rgb, 95],
      outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [...rgb, 230], width: 1 } } } } }];
  return `${PADUS_EXPORT}&dynamicLayers=${encodeURIComponent(JSON.stringify(dynamicLayers))}`;
}
export function publicLandQueryUrl(lng: number, lat: number, ids: readonly PublicLandId[]): string {
  const params = new URLSearchParams({ geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', where: publicLandWhere(ids) || '1=0',
    outFields: 'Mang_Name,Mang_Type,Loc_Mang,Unit_Nm,Des_Tp,Loc_Ds', returnGeometry: 'false', f: 'json' });
  return `${PADUS_QUERY}?${params}`;
}
const MANAGERS: Record<string, string> = { USFS: 'U.S. Forest Service', BLM: 'Bureau of Land Management', NPS: 'National Park Service', FWS: 'U.S. Fish and Wildlife Service', DOD: 'Department of Defense' };
export function publicLandContent(p: Record<string, unknown>): string[] {
  const text = (value: unknown): string => value == null ? '' : String(value).trim();
  const code = text(p.Mang_Name);
  return [text(p.Unit_Nm), text(p.Loc_Mang) || MANAGERS[code] || code, text(p.Loc_Ds) || text(p.Des_Tp)].filter(Boolean);
}
