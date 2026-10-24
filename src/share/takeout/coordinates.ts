import type { LngLat } from '../../types';
import { lngLat } from '../../sync/validate';

const number = '(-?\\d+(?:\\.\\d+)?)';
const pair = `${number}\\s*,\\s*${number}`;

/** Google URLs store latitude first. Place coordinates take precedence over viewport. */
export function coordinatesFromUrl(source: string): LngLat | null {
  let url = source;
  for (let i = 0; i < 3; i++) {
    try { const decoded = decodeURIComponent(url); if (decoded === url) break; url = decoded; } catch { break; }
  }
  url = url.replace(/\+/g, ' ');
  const patterns = [
    new RegExp(`!3d${number}!4d${number}`, 'i'),
    new RegExp(`[?&](?:q|ll|query)=${pair}(?:[&#]|$)`, 'i'),
    new RegExp(`/maps/(?:search|place)/${pair}(?:[/ ?#]|$)`, 'i'),
    new RegExp(`@${pair}(?:[,/ ?#]|$)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (match) {
      const coord = lngLat([Number(match[2]), Number(match[1])]);
      if (coord) return coord;
    }
  }
  return null;
}
