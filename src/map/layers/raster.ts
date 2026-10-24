import type { IdentifyResult } from '../layerRegistry';

export const IIPP = 'https://imagery.geoplatform.gov/iipp/rest/services/';
export const IIPP_CACHE = /^https:\/\/imagery\.geoplatform\.gov\/iipp\/rest\/services\/(?:Vegetation|Lands_Realty|Fire_Aviation)\/USFS_[^/]+\/ImageServer\/(?:exportImage|rasterAttributeTable)\?/;
export const LANDFIRE_CACHE = /^https:\/\/lfps\.usgs\.gov\/arcgis\/rest\/services\/Landfire_LF2024\/LF2024_(?:EVT|EVH)_CONUS\/ImageServer\/(?:exportImage|rasterAttributeTable)\?/;
export type RasterOptions = Record<string, string>;

export function rasterTiles(service: string, options: RasterOptions = {}): string {
  return `${service}/exportImage?${new URLSearchParams({ f: 'image', bboxSR: '3857', imageSR: '3857',
    size: '256,256', format: 'png32', interpolation: 'RSP_NearestNeighbor', noDataInterpretation: 'esriNoDataMatchAny', ...options })}&bbox={bbox-epsg-3857}`;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** ArcGIS uses strings for pixels, including the literal "NoData". */
export function pixelValue(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function rasterClasses(data: unknown, nameField: string): Map<number, string> {
  const classes = new Map<number, string>();
  const features = record(data).features;
  if (!Array.isArray(features)) return classes;
  for (const feature of features) {
    const attributes = record(record(feature).attributes);
    const value = pixelValue(attributes.Value);
    const name = attributes[nameField];
    if (value !== null && typeof name === 'string' && name.trim() && !/^(?:fill[- ]?)?nodata|^background$/i.test(name)) classes.set(value, name.trim());
  }
  return classes;
}

export async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Raster request: ${response.status}`);
  const data: unknown = await response.json();
  if (record(data).error) throw new Error('Raster service error');
  return data;
}

const tables = new Map<string, Map<number, string>>();
async function classTable(service: string, rasterFunction: string, nameField: string, signal: AbortSignal): Promise<Map<number, string>> {
  const url = `${service}/rasterAttributeTable?${new URLSearchParams({ f: 'json', renderingRule: JSON.stringify({ rasterFunction }) })}`;
  const cached = tables.get(url);
  if (cached) return cached;
  const classes = rasterClasses(await fetchJson(url, signal), nameField);
  if (classes.size) tables.set(url, classes);
  return classes;
}

/** Use the same year/mosaic as the image, with raw pixels instead of RGB values. */
export function rasterIdentify(service: string, title: string, label: string, options: RasterOptions,
  classes: { rasterFunction: string; nameField: string } | ((value: number) => string | null), year?: string) {
  return async (lng: number, lat: number, signal: AbortSignal): Promise<IdentifyResult | null> => {
    const url = `${service}/identify?${new URLSearchParams({ ...options, f: 'json',
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint',
      returnGeometry: 'false', returnCatalogItems: 'false', renderingRule: JSON.stringify({ rasterFunction: 'None' }) })}`;
    const [data, table] = await Promise.all([fetchJson(url, signal), typeof classes === 'function' ? null : classTable(service, classes.rasterFunction, classes.nameField, signal)]);
    signal.throwIfAborted();
    const value = pixelValue(record(data).value);
    if (value === null) return null;
    const name = typeof classes === 'function' ? classes(value) : table?.get(value);
    if (!name) return null;
    return { title, rows: [[label, name], ...(year ? [['Year', year] as [string, string]] : [])] };
  };
}
