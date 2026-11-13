import type { Feature, MultiPolygon, Point, Polygon } from 'geojson';
import { fireEnvelopes, fireFeatures } from './layers/hazards';
import { fetchJson, record } from './layers/raster';
import { text } from './layers/arcgis';

const PAGE = 500;

/** Page an ArcGIS polygon layer for one viewport. `service` is the layer URL without `/query`. */
export async function polygonPages(
  service: string,
  fields: string,
  orderBy: string,
  west: number, south: number, east: number, north: number,
  zoom: number,
  signal: AbortSignal,
  where = '1=1',
): Promise<Feature<Polygon | MultiPolygon>[]> {
  const features = new Map<string, Feature<Polygon | MultiPolygon>>();
  const simplify = (360 / (512 * 2 ** Math.max(0, Math.floor(zoom)))).toFixed(6);
  for (const envelope of fireEnvelopes(west, south, east, north)) {
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const params = new URLSearchParams({
        f: 'geojson', where, geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope',
        inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: fields,
        returnGeometry: 'true', maxAllowableOffset: simplify,
        resultRecordCount: String(PAGE), resultOffset: String(offset), orderByFields: orderBy,
      });
      const data = await fetchJson(`${service}/query?${params}`, signal);
      for (const feature of fireFeatures(data)) features.set(String(feature.id ?? feature.properties?.OBJECTID ?? features.size), feature);
      const raw = record(data).features;
      if (!Array.isArray(raw) || raw.length < PAGE) break;
    }
  }
  return [...features.values()];
}

export async function polygonWhere(service: string, fields: string, where: string, signal: AbortSignal): Promise<Feature<Polygon | MultiPolygon>[]> {
  const params = new URLSearchParams({ f: 'geojson', where, outFields: fields, returnGeometry: 'true', outSR: '4326' });
  return fireFeatures(await fetchJson(`${service}/query?${params}`, signal));
}

export async function pointPages(
  service: string,
  fields: string,
  orderBy: string,
  west: number, south: number, east: number, north: number,
  signal: AbortSignal,
  where = '1=1',
): Promise<Feature<Point>[]> {
  const features = new Map<string, Feature<Point>>();
  for (const envelope of fireEnvelopes(west, south, east, north)) {
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const params = new URLSearchParams({
        f: 'geojson', where, geometry: envelope.join(','), geometryType: 'esriGeometryEnvelope',
        inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: fields,
        returnGeometry: 'true', resultRecordCount: String(PAGE), resultOffset: String(offset), orderByFields: orderBy,
      });
      const data = await fetchJson(`${service}/query?${params}`, signal);
      for (const feature of pointFeatures(data)) features.set(String(feature.id ?? feature.properties?.OBJECTID ?? features.size), feature);
      const raw = record(data).features;
      if (!Array.isArray(raw) || raw.length < PAGE) break;
    }
  }
  return [...features.values()];
}

export function pointFeatures(data: unknown): Feature<Point>[] {
  const features = record(data).features;
  if (!Array.isArray(features)) throw new Error('Invalid point response');
  return features.flatMap(value => {
    const feature = record(value);
    const geometry = record(feature.geometry);
    const coordinates = geometry.coordinates;
    if (feature.type !== 'Feature' || geometry.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2) return [];
    const lng = coordinates[0];
    const lat = coordinates[1];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return [];
    const id = feature.id ?? (feature.properties && record(feature.properties).OBJECTID);
    return [{
      type: 'Feature' as const,
      ...(typeof id === 'string' || typeof id === 'number' ? { id } : {}),
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
      properties: record(feature.properties),
    }];
  });
}

export async function attributesAt(
  service: string, fields: string, lng: number, lat: number, signal: AbortSignal, where = '1=1',
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', where, outFields: fields, returnGeometry: 'false', resultRecordCount: '20',
  });
  const data = await fetchJson(`${service}/query?${params}`, signal);
  const features = record(data).features;
  if (!Array.isArray(features)) return [];
  return features.map(feature => record(record(feature).attributes));
}

export function httpsUrl(value: unknown): string {
  const url = text(value);
  return url.startsWith('https://') ? url : '';
}
