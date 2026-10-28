import type { LngLat } from '../types';

const EARTH_RADIUS_M = 6_371_008.8;
export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.280839895;

/** Round to 6 decimals (~0.1 m). All stored coordinates are rounded so exports round-trip exactly. */
export function roundCoord([lng, lat]: LngLat): LngLat {
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

export function haversine(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(coords: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1]!, coords[i]!);
  return total;
}

export interface DistanceParts {
  imperial: string;
  feet: string;
  metric: string;
}

export function formatDistance(meters: number): DistanceParts {
  const mi = meters / M_PER_MI;
  const ft = meters * FT_PER_M;
  const km = meters / 1000;
  return {
    imperial: `${mi < 10 ? mi.toFixed(2) : mi.toFixed(1)} mi`,
    feet: `${Math.round(ft).toLocaleString('en-US')} ft`,
    metric: km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(2)} km`,
  };
}

/** Short single-line distance for lists. */
export function shortDistance(meters: number): string {
  const ft = meters * FT_PER_M;
  return ft < 1000 ? `${Math.round(ft)} ft` : `${(meters / M_PER_MI).toFixed(2)} mi`;
}

export function formatLatLng([lng, lat]: LngLat): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

const HEMISPHERE = /(?<![A-Za-z])[NSEW](?![A-Za-z])/i;

function validLatLng(lat: number, lng: number): LngLat | null {
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
  return [lng, lat];
}

function normalizeLocation(text: string): string {
  return text.replace(/[\u2212\u2013\u2014]/g, '-').replace(/[º°]/g, ' ').replace(/['′’″“”"]/g, ' ').replace(/,/g, ' ');
}

type LocationToken = { kind: 'n'; value: number } | { kind: 'h'; value: 'N' | 'S' | 'E' | 'W' };

function locationTokens(text: string): LocationToken[] {
  const tokens: LocationToken[] = [];
  for (const match of normalizeLocation(text).matchAll(/[+-]?\d+(?:\.\d+)?|(?<![A-Za-z])[NSEW](?![A-Za-z])/gi)) {
    const raw = match[0];
    if (/^[NSEW]$/i.test(raw)) tokens.push({ kind: 'h', value: raw.toUpperCase() as 'N' | 'S' | 'E' | 'W' });
    else tokens.push({ kind: 'n', value: Number(raw) });
  }
  return tokens;
}

/** Degrees, or degrees plus minutes, or degrees plus minutes and seconds. */
function sexagesimal(parts: number[]): number | null {
  const degrees = parts[0];
  if (degrees === undefined || parts.length > 3) return null;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  if (minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return Math.abs(degrees) + minutes / 60 + seconds / 3600;
}

function parseHemisphere(text: string): LngLat | null {
  const tokens = locationTokens(text);
  let lat: number | undefined;
  let lng: number | undefined;
  const place = (hemi: 'N' | 'S' | 'E' | 'W', magnitude: number): void => {
    const signed = hemi === 'S' || hemi === 'W' ? -magnitude : magnitude;
    if (hemi === 'N' || hemi === 'S') lat = signed;
    else lng = signed;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const take = (start: number): { parts: number[]; next: number } => {
      const parts: number[] = [];
      let next = start;
      while (next < tokens.length && tokens[next]?.kind === 'n' && parts.length < 3) {
        const number = tokens[next];
        if (number?.kind === 'n') parts.push(number.value);
        next++;
      }
      return { parts, next };
    };
    if (token.kind === 'h') {
      const { parts, next } = take(i + 1);
      if (!parts.length) continue;
      const value = sexagesimal(parts);
      if (value === null) return null;
      place(token.value, value);
      i = next - 1;
      continue;
    }
    const { parts, next } = take(i);
    const hemi = tokens[next];
    if (!parts.length || hemi?.kind !== 'h') continue;
    const value = sexagesimal(parts);
    if (value === null) return null;
    place(hemi.value, value);
    i = next;
  }
  if (lat === undefined || lng === undefined) return null;
  return validLatLng(lat, lng);
}

function parseDecimalPair(text: string): LngLat | null {
  const nums = normalizeLocation(text).match(/[+-]?\d+(?:\.\d+)?/g);
  const first = nums?.[0];
  const second = nums?.[1];
  if (first === undefined || second === undefined) return null;
  let lat = Number(first);
  let lng = Number(second);
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
  // Eastern US longitudes also fall inside ±90, so magnitude cannot tell them
  // from latitude. A leading value in that band is longitude when it is at most -67.
  else if (lat <= -67 && lng >= 17 && lng <= 72) [lat, lng] = [lng, lat];
  return validLatLng(lat, lng);
}

/** Decimal degrees, DMM, DMS, or a Google/Apple Maps link is handled by the caller. */
export function parseLatLng(input: string): LngLat | null {
  const text = input.trim();
  if (!text) return null;
  if (HEMISPHERE.test(text)) return parseHemisphere(text);
  return parseDecimalPair(text);
}

/** `?ll=lat,lng` and optional `z`. Other flags, including `fhm_bot`, are left alone. */
export function locationFromSearch(search: string): { center: LngLat; zoom: number } | null {
  const params = new URLSearchParams(search);
  const raw = params.get('ll');
  if (!raw) return null;
  const center = parseLatLng(raw);
  if (!center) return null;
  const rawZoom = params.get('z');
  const zoom = rawZoom === null || rawZoom.trim() === '' ? 15 : Number(rawZoom);
  return { center, zoom: Number.isFinite(zoom) ? Math.min(22, Math.max(0, zoom)) : 15 };
}
