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
