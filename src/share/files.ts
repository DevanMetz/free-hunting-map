import type { Item } from '../types';
import { fromGeoJSON, toGeoJSON } from './geojson';
import { fromGpx, toGpx } from './gpx';

export type ExportFormat = 'gpx' | 'geojson';

export function serialize(items: Item[], format: ExportFormat): { name: string; mime: string; text: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'gpx') return { name: `open-hunt-map-${stamp}.gpx`, mime: 'application/gpx+xml', text: toGpx(items) };
  return {
    name: `open-hunt-map-${stamp}.geojson`,
    mime: 'application/geo+json',
    text: JSON.stringify(toGeoJSON(items)),
  };
}

/** Web Share with a file when supported (works device-to-device without network, e.g. AirDrop / Nearby Share). */
export async function shareFile(name: string, mime: string, text: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const file = new File([text], name, { type: mime });
  if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], title: name });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}

export function downloadFile(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseFileText(name: string, text: string): Item[] {
  const trimmed = text.trimStart();
  if (/\.gpx$/i.test(name) || trimmed.startsWith('<')) return fromGpx(text);
  return fromGeoJSON(JSON.parse(text));
}
