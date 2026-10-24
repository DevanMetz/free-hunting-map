import type { IdentifyResult } from '../layerRegistry';

/** Keep the MapLibre bbox token unescaped; all other values are ordinary query parameters. */
export function mapImage(service: string, params: Record<string, string>): string {
  return `${service}/export?bbox={bbox-epsg-3857}&${new URLSearchParams({
    bboxSR: '3857', imageSR: '3857', size: '512,512', format: 'png32', transparent: 'true', f: 'image', ...params,
  })}`;
}
export function polygonSymbol(rgb: number[], alpha = 0, width = 1): object {
  return { type: 'esriSFS', style: 'esriSFSSolid', color: [...rgb, alpha],
    outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [...rgb, 255], width } };
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
export async function queryPoint(service: string, layer: number, lng: number, lat: number,
  fields: string[], signal: AbortSignal, where = '1=1', distance?: number): Promise<Attributes | null> {
  const params = new URLSearchParams({ f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', where, outFields: fields.join(','), returnGeometry: 'false' });
  if (distance !== undefined) { params.set('distance', String(distance)); params.set('units', 'esriSRUnit_Meter'); }
  const response = await fetch(`${service}/${layer}/query?${params}`, { signal });
  if (!response.ok) return null;
  const data = await response.json() as { features?: { attributes?: Attributes }[] };
  return data.features?.[0]?.attributes ?? null;
}
