import { cardinal } from '../map/terrainMath';
import { WIND_DIRS, type WindDir } from '../types';

/** Meteorological "from" bearing for a compass point. */
export const WIND_BEARING: Record<WindDir, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

export function sortWinds(winds: readonly WindDir[]): WindDir[] {
  const found = new Set<string>(winds);
  return WIND_DIRS.filter(dir => found.has(dir));
}

export function windDir(deg: number): WindDir {
  return cardinal(((deg % 360) + 360) % 360);
}

/** True when the forecast direction falls in a selected good-wind sector. */
export function windMatches(deg: number, winds: readonly WindDir[]): boolean {
  if (!Number.isFinite(deg) || !winds.length) return false;
  return (winds as readonly string[]).includes(windDir(deg));
}
