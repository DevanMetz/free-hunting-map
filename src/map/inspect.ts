import { publicLandContent, publicLandQueryUrl, type PublicLandId } from './publicLands';
import { DEER_SERVICE } from './sources';

type Properties = Record<string, unknown>;
const text = (value: unknown): string => value == null ? '' : String(value).trim();
export function parcelContent(p: Properties): string[] {
  const owner = [text(p.OWNERNME1), text(p.OWNERNME2)].filter(Boolean).join('\n');
  const acres = Number(p.GISACRES);
  const id = text(p.PARCELID) || text(p.STATEID);
  return [owner, p.GISACRES != null && text(p.GISACRES) && Number.isFinite(acres) ? `${acres.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} ac` : '', id ? `Parcel ${id}` : ''].filter(Boolean);
}
export function deerContent(p: Properties): string[] {
  const id = text(p.DEER_MGMT_UNIT_ID);
  return [id ? `Unit ${id}` : '', text(p.DEER_MANAGEMENT_ZONE), text(p.METRO_SUBUNIT_NAME)].filter(Boolean);
}
export async function identifyDeer(lng: number, lat: number, signal: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams({ geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'DEER_MANAGEMENT_ZONE,DEER_MGMT_UNIT_ID,DEER_MGMT_UNIT_NAME,METRO_SUBUNIT_NAME', returnGeometry: 'false', f: 'json' });
  const response = await fetch(`${DEER_SERVICE}/2/query?${params}`, { cache: 'no-store', signal });
  if (!response.ok) return [];
  const data = await response.json();
  return data.features?.[0]?.attributes ? deerContent(data.features[0].attributes) : [];
}

export async function identifyPublicLand(lng: number, lat: number, ids: readonly PublicLandId[], signal: AbortSignal): Promise<string[]> {
  const response = await fetch(publicLandQueryUrl(lng, lat, ids), { signal });
  if (!response.ok) return [];
  const data = await response.json();
  return data.features?.[0]?.attributes ? publicLandContent(data.features[0].attributes) : [];
}
