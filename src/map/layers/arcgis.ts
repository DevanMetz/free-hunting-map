import type { IdentifyResult } from '../layerRegistry';

/** Keep the MapLibre bbox token unescaped; all other values are ordinary query parameters. */
export function mapImage(service: string, params: Record<string, string>): string {
  return `${service}/export?bbox={bbox-epsg-3857}&${new URLSearchParams({
    bboxSR: '3857', imageSR: '3857', size: '512,512', format: 'png32', transparent: 'true', f: 'image', ...params,
  })}`;
}
export type Attributes = Record<string, unknown>;
export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
export function attributeResult(title: string, attributes: Attributes, fields: [string, string][]): IdentifyResult | null {
  const rows: [string, string][] = fields.flatMap(([key, label]) => {
    const value = text(attributes[key]);
    return value && value !== 'Null' && value !== '<Null>' ? [[label, value]] : [];
  });
  return rows.length ? { title, rows } : null;
}
/** A small geographic envelope uses the service spatial index without a server-side geodesic buffer. */
export function queryGeometry(lng: number, lat: number, distance?: number): { geometry: string; geometryType: string } {
  if (distance === undefined || !Number.isFinite(distance) || distance <= 0) {
    return { geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint' };
  }
  const dy = distance / 111_320;
  const dx = dy / Math.max(0.000001, Math.cos(lat * Math.PI / 180));
  return { geometry: [Math.max(-180, lng - dx), Math.max(-90, lat - dy), Math.min(180, lng + dx), Math.min(90, lat + dy)].join(','),
    geometryType: 'esriGeometryEnvelope' };
}
export async function queryPoint(service: string, layer: number, lng: number, lat: number,
  fields: string[], signal: AbortSignal, where = '1=1', distance?: number): Promise<Attributes | null> {
  const params = new URLSearchParams({ f: 'json', ...queryGeometry(lng, lat, distance), inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', where, outFields: fields.join(','), returnGeometry: 'false' });
  const response = await fetch(`${service}/${layer}/query?${params}`, { signal });
  if (!response.ok) return null;
  const data = await response.json() as { features?: { attributes?: Attributes }[] };
  return data.features?.[0]?.attributes ?? null;
}
