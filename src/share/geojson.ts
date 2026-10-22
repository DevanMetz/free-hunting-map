import type { Item, LngLat } from '../types';
import { contentId } from '../sync/ids';
import { lngLat, sanitizeItem } from '../sync/validate';

/** Device id used for items imported from files that carry no Open Hunt Map metadata. */
export const FOREIGN_DEVICE = 'import';

interface Feature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: LngLat } | { type: 'LineString'; coordinates: LngLat[] };
  properties: Record<string, unknown>;
}

export function toGeoJSON(items: Item[]): { type: 'FeatureCollection'; features: Feature[] } {
  return {
    type: 'FeatureCollection',
    features: items.map((item): Feature => {
      const { kind, id, createdAt, updatedAt, deviceId, deleted, name, note } = item;
      const props: Record<string, unknown> = { ohm: 1, kind, id, name, note, createdAt, updatedAt, deviceId, deleted };
      if (item.kind === 'waypoint') {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: item.coord }, properties: { ...props, icon: item.icon } };
      }
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: item.coords },
        properties: { ...props, recorded: item.recorded },
      };
    }),
  };
}

/** Accepts our own exports and plain GeoJSON (Point / LineString / MultiLineString features). */
export function fromGeoJSON(input: unknown): Item[] {
  const features = collectFeatures(input);
  const out: Item[] = [];
  for (const f of features) {
    const geom = f.geometry as { type?: string; coordinates?: unknown } | null;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (!geom) continue;
    const lines: unknown[] =
      geom.type === 'LineString' ? [geom.coordinates] : geom.type === 'MultiLineString' && Array.isArray(geom.coordinates) ? geom.coordinates : [];

    if (geom.type === 'Point') {
      const item = props.ohm
        ? sanitizeItem({ ...props, kind: 'waypoint', coord: geom.coordinates })
        : foreign({ kind: 'waypoint', coord: lngLat(geom.coordinates), props });
      if (item) out.push(item);
    }
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const coords = line.map(lngLat).filter((c): c is LngLat => c !== null);
      if (coords.length < 2) continue;
      const item = props.ohm && lines.length === 1
        ? sanitizeItem({ ...props, kind: 'track', coords })
        : foreign({ kind: 'track', coords, props });
      if (item) out.push(item);
    }
  }
  return out;
}

function collectFeatures(input: unknown): { geometry?: unknown; properties?: unknown }[] {
  if (!input || typeof input !== 'object') return [];
  const o = input as { type?: string; features?: unknown };
  if (o.type === 'FeatureCollection' && Array.isArray(o.features)) return o.features;
  if (o.type === 'Feature') return [o as { geometry?: unknown; properties?: unknown }];
  return [];
}

function foreign(
  f: { kind: 'waypoint'; coord: LngLat | null; props: Record<string, unknown> } | { kind: 'track'; coords: LngLat[]; props: Record<string, unknown> },
): Item | null {
  const name = String(f.props.name ?? f.props.title ?? '');
  const note = String(f.props.description ?? f.props.desc ?? f.props.note ?? '');
  const geometry = f.kind === 'waypoint' ? f.coord : f.coords;
  if (!geometry) return null;
  return sanitizeItem({
    kind: f.kind,
    id: contentId(JSON.stringify([f.kind, name, geometry])),
    createdAt: 0,
    updatedAt: 0,
    deviceId: FOREIGN_DEVICE,
    deleted: false,
    name,
    note,
    icon: f.props.icon,
    coord: f.kind === 'waypoint' ? f.coord : undefined,
    coords: f.kind === 'track' ? f.coords : undefined,
    recorded: false,
  });
}
