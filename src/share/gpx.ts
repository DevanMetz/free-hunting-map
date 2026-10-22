import type { Item, LngLat } from '../types';
import { contentId } from '../sync/ids';
import { sanitizeItem } from '../sync/validate';
import { FOREIGN_DEVICE } from './geojson';

/** Namespace for our metadata in <extensions>; a URN, not a URL. */
export const OHM_NS = 'urn:open-hunt-map:gpx:1';

export function toGpx(items: Item[]): string {
  const wpts: string[] = [];
  const trks: string[] = [];
  for (const item of items) {
    const ext =
      `<extensions><ohm:id>${esc(item.id)}</ohm:id><ohm:createdAt>${item.createdAt}</ohm:createdAt>` +
      `<ohm:updatedAt>${item.updatedAt}</ohm:updatedAt><ohm:deviceId>${esc(item.deviceId)}</ohm:deviceId>` +
      `<ohm:deleted>${item.deleted}</ohm:deleted>` +
      (item.kind === 'track' ? `<ohm:recorded>${item.recorded}</ohm:recorded>` : '') +
      `</extensions>`;
    const text = `<name>${esc(item.name)}</name>${item.note ? `<desc>${esc(item.note)}</desc>` : ''}`;
    if (item.kind === 'waypoint') {
      const [lng, lat] = item.coord;
      wpts.push(
        `  <wpt lat="${lat}" lon="${lng}"><time>${iso(item.createdAt)}</time>${text}<sym>${item.icon}</sym>${ext}</wpt>`,
      );
    } else {
      const pts = item.coords.map(([lng, lat]) => `<trkpt lat="${lat}" lon="${lng}"/>`).join('');
      trks.push(`  <trk>${text}${ext}<trkseg>${pts}</trkseg></trk>`);
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Open Hunt Map" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ohm="${OHM_NS}">`,
    ...wpts,
    ...trks,
    '</gpx>',
    '',
  ].join('\n');
}

/** Parses GPX 1.0/1.1 waypoints, tracks and routes. Requires DOMParser. */
export function fromGpx(xml: string): Item[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid GPX');
  const out: Item[] = [];

  for (const wpt of byTag(doc, 'wpt')) {
    const coord = pointOf(wpt);
    if (!coord) continue;
    const name = childText(wpt, 'name');
    const item = withMeta(wpt, { kind: 'waypoint', name, note: childText(wpt, 'desc'), icon: childText(wpt, 'sym').toLowerCase(), coord });
    if (item) out.push(item);
  }

  for (const trk of [...byTag(doc, 'trk'), ...byTag(doc, 'rte')]) {
    const pts = [...byTag(trk, 'trkpt'), ...byTag(trk, 'rtept')];
    const coords = pts.map(pointOf).filter((c): c is LngLat => c !== null);
    if (coords.length < 2) continue;
    const item = withMeta(trk, { kind: 'track', name: childText(trk, 'name'), note: childText(trk, 'desc'), coords, recorded: false });
    if (item) out.push(item);
  }
  return out;
}

function withMeta(el: Element, fields: Record<string, unknown>): Item | null {
  const id = ohm(el, 'id');
  if (id) {
    return sanitizeItem({
      ...fields,
      id,
      createdAt: Number(ohm(el, 'createdAt')),
      updatedAt: Number(ohm(el, 'updatedAt')),
      deviceId: ohm(el, 'deviceId'),
      deleted: ohm(el, 'deleted') === 'true',
      ...(fields.kind === 'track' ? { recorded: ohm(el, 'recorded') === 'true' } : {}),
    });
  }
  const geometry = fields.kind === 'waypoint' ? fields.coord : fields.coords;
  return sanitizeItem({
    ...fields,
    id: contentId(JSON.stringify([fields.kind, fields.name, geometry])),
    createdAt: 0,
    updatedAt: 0,
    deviceId: FOREIGN_DEVICE,
    deleted: false,
  });
}

/** Descendants by local name, namespace-agnostic (GPX 1.0 and 1.1). */
function byTag(root: Document | Element, tag: string): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => el.localName === tag);
}

function childText(el: Element, tag: string): string {
  for (const c of el.children) if (c.localName === tag) return c.textContent?.trim() ?? '';
  return '';
}

function ohm(el: Element, tag: string): string {
  // Only look at this element's own <extensions>, not nested points.
  for (const c of el.children) {
    if (c.localName !== 'extensions') continue;
    const hit = [...c.querySelectorAll('*')].find((e) => e.localName === tag && e.namespaceURI === OHM_NS);
    if (hit) return hit.textContent?.trim() ?? '';
  }
  return '';
}

function pointOf(el: Element): LngLat | null {
  const lat = Number(el.getAttribute('lat'));
  const lon = Number(el.getAttribute('lon'));
  if (!el.hasAttribute('lat') || !el.hasAttribute('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lon, lat];
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}
