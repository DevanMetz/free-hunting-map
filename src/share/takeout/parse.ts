import { strFromU8, unzipSync } from 'fflate';
import type { LngLat } from '../../types';
import { lngLat } from '../../sync/validate';
import { coordinatesFromUrl } from './coordinates';
import { parseCsv } from './csv';

export interface Place { name: string; note: string; coord: LngLat; sourceUrl?: string; categoryName?: string }
export interface TakeoutResult { places: Place[]; skipped: number }
type ObjectData = Record<string, unknown>;
const object = (v: unknown): ObjectData => v && typeof v === 'object' ? v as ObjectData : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const join = (values: unknown[]): string => [...new Set(values.map(text).filter(Boolean))].join('\n');
const basename = (name: string): string => name.split(/[\\/]/).pop() ?? name;

export function isTakeoutJson(name: string, input: unknown): boolean {
  const data = object(input);
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) return false;
  if (data.features.some((f) => object(object(f).properties).ohm)) return false;
  return /^(?:Saved Places|Starred places|Labeled places)\.json$/i.test(basename(name)) || data.features.some((f) => {
    const p = object(object(f).properties);
    return 'Google Maps URL' in p || 'Location' in p || ('name' in p && 'address' in p);
  });
}

export function parseTakeoutText(name: string, source: string): TakeoutResult | null {
  const result: TakeoutResult = { places: [], skipped: 0 };
  const add = (coord: LngLat | null, title: unknown, address: unknown, notes: unknown[], list: string, url: unknown) => {
    if (!coord) { result.skipped++; return; }
    let sourceUrl = text(url);
    // Some exports percent-encode the entire URL rather than only its components.
    for (let i = 0; i < 3 && sourceUrl && !/^https?:\/\//i.test(sourceUrl); i++) {
      try { sourceUrl = decodeURIComponent(sourceUrl); } catch { break; }
    }
    result.places.push({ coord, name: text(title) || text(address) || 'Saved place',
      note: join([...notes, address]), categoryName: list, ...(sourceUrl ? { sourceUrl } : {}) });
  };
  if (/\.csv$/i.test(name)) {
    const [header, ...rows] = parseCsv(source);
    const headers = header?.map((h) => h.trim().toLowerCase()) ?? [];
    if (!headers.includes('url') || !headers.includes('title')) return null;
    const list = basename(name).replace(/\.csv$/i, '');
    for (const row of rows) {
      const get = (key: string) => row[headers.indexOf(key)] ?? '';
      add(coordinatesFromUrl(get('url')), get('title'), get('address'), [get('note'), get('comment'), get('tags')], list, get('url'));
    }
    return result;
  }
  const input: unknown = JSON.parse(source.replace(/^\uFEFF/, ''));
  if (!isTakeoutJson(name, input)) return null;
  const features = object(input).features as unknown[];
  const labeled = /labeled/i.test(name) || features.some((f) => 'address' in object(object(f).properties));
  for (const raw of features) {
    const f = object(raw), p = object(f.properties), geometry = object(f.geometry);
    const location = object(p.Location), geo = object(location['Geo Coordinates']);
    const url = p['Google Maps URL'];
    let coord = geometry.type === 'Point' ? lngLat(geometry.coordinates) : null;
    if (coord?.every((v) => v === 0)) coord = null;
    if (!coord && text(String(geo.Longitude ?? '')) && text(String(geo.Latitude ?? ''))) {
      coord = lngLat([Number(geo.Longitude), Number(geo.Latitude)]);
      if (coord?.every((v) => v === 0)) coord = null;
    }
    coord ??= coordinatesFromUrl(text(url));
    add(coord, p.Title || p.name || location['Business Name'], location.Address || p.address,
      [p.Note, p.note, p.Comment, p.comment], labeled ? 'Labeled' : 'Saved places', url);
  }
  return result;
}

/** Filter before inflation so unrelated Takeout products never enter memory. */
export function parseTakeoutZip(bytes: Uint8Array): TakeoutResult {
  const files = unzipSync(bytes, { filter: (entry) => /(?:^|\/)Saved\/[^/]+\.csv$/i.test(entry.name) || /(?:^|\/)(?:Saved Places|Starred places|Labeled places)\.json$/i.test(entry.name) });
  const result: TakeoutResult = { places: [], skipped: 0 };
  for (const [name, bytes] of Object.entries(files)) {
    const parsed = parseTakeoutText(name, strFromU8(bytes));
    if (parsed) { result.places.push(...parsed.places); result.skipped += parsed.skipped; }
  }
  return result;
}
