import type { Waypoint, WaypointIcon } from '../types';
import { sanitizeItem } from '../sync/validate';

/** Shareable with a private party. Stands and pins stay out of the public grid. */
export const SHAREABLE_ICONS = ['pin', 'stand', 'rub', 'scrape', 'deer', 'trailcam'] as const satisfies readonly WaypointIcon[];
/** Animal sign only. Hunter locations (pins, stands, camps) are never published. */
export const SIGHTING_ICONS = ['deer', 'rub', 'scrape', 'trailcam'] as const satisfies readonly WaypointIcon[];

/**
 * 0.03° is about 3.3 km north-south and stays above 1 km east-west through
 * northern Alaska. Public geometry is the whole cell, never the original point.
 */
export const CELL_DEG = 0.03;
/** Contributions stay hidden for a week so a fresh sighting cannot be followed. */
export const ACTIVITY_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVITY_ZOOM = 8;

export const SCOUT_GROUPS = 'scout.groups';
export const SCOUT_SHARES = 'scout.shares';
export const SCOUT_ACTIVITY = 'scout.activity';
export const SCOUT_ACTIVITY_QUEUE = 'scout.activityQueue';

export interface ScoutGroup {
  id: string;
  secret: string;
  name: string;
  memberId: string;
  cursor: number;
  registered: boolean;
  left?: boolean;
  rejected?: boolean;
}

export interface ActivityHit {
  id: string;
  itemId: string;
  cell: string;
}

const ID = /^[0-9a-f]{32}$/;
const SECRET = /^[0-9a-f]{64}$/;
const round = (n: number): number => Math.round(n * 1e5) / 1e5;

export function shareableIcon(icon: string): boolean {
  return (SHAREABLE_ICONS as readonly string[]).includes(icon);
}

export function sightingIcon(icon: string): boolean {
  return (SIGHTING_ICONS as readonly string[]).includes(icon);
}

export function hex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function parseInvite(value: string): { id: string; secret: string } | null {
  const match = /party\/([0-9a-f]{32})\/([0-9a-f]{64})/i.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  return { id: match[1].toLowerCase(), secret: match[2].toLowerCase() };
}

export function validPartyId(id: string): boolean {
  return ID.test(id);
}

export function validPartySecret(secret: string): boolean {
  return SECRET.test(secret);
}

export function cellRing(cell: string): [number, number][] | null {
  const match = /^(-?\d+):(-?\d+)$/.exec(cell);
  if (!match?.[1] || !match[2]) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  const west = round(x * CELL_DEG);
  const south = round(y * CELL_DEG);
  const east = round(west + CELL_DEG);
  const north = round(south + CELL_DEG);
  if (west < -180 || east > 180 || south < -85 || north > 85) return null;
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

/** Grid key for a coordinate. Null when the cell would cross the published bounds. */
export function cellOf(lng: number, lat: number): string | null {
  if (!(lng >= -180 && lng <= 180 && lat >= -85 && lat <= 85)) return null;
  const cell = `${Math.floor(lng / CELL_DEG)}:${Math.floor(lat / CELL_DEG)}`;
  return cellRing(cell) ? cell : null;
}

const latY = (lat: number, n: number): number => {
  const rad = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
};

/** z8 tiles touched by a cell. A cell is much smaller than a tile, so this is usually one. */
export function activityTiles(cell: string): string[] {
  const ring = cellRing(cell);
  if (!ring) return [];
  const xs = ring.map(p => p[0]);
  const ys = ring.map(p => p[1]);
  const west = Math.min(...xs);
  const east = Math.max(...xs);
  const south = Math.min(...ys);
  const north = Math.max(...ys);
  const n = 2 ** ACTIVITY_ZOOM;
  const x0 = Math.floor((west + 180) / 360 * n);
  const x1 = Math.floor((east - 1e-9 + 180) / 360 * n);
  const y0 = latY(north - 1e-9, n);
  const y1 = latY(south, n);
  const out: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    if (x >= 0 && x < n && y >= 0 && y < n) out.push(`${x}/${y}`);
  }
  return out;
}

/** Party copy: member id instead of the device id, and no local category linkage. */
export function sharedWaypoint(item: Waypoint, memberId: string, deleted = item.deleted): Waypoint | null {
  if (!deleted && !shareableIcon(item.icon)) return null;
  const clean = sanitizeItem({
    kind: 'waypoint',
    id: item.id,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    deviceId: memberId.slice(0, 64),
    deleted,
    name: item.name,
    note: item.note,
    icon: item.icon,
    coord: item.coord,
    ...(item.sex ? { sex: item.sex } : {}),
    ...(typeof item.seenAt === 'number' ? { seenAt: item.seenAt } : {}),
    ...(item.photo ? { photo: item.photo } : {}),
    ...(item.camera ? { camera: item.camera } : {}),
    ...(typeof item.setAt === 'number' ? { setAt: item.setAt } : {}),
    ...(typeof item.checkedAt === 'number' ? { checkedAt: item.checkedAt } : {}),
    ...(item.fov ? { fov: item.fov } : {}),
    ...(item.color ? { color: item.color } : {}),
    ...(typeof item.iconOverride === 'boolean' ? { iconOverride: item.iconOverride } : {}),
  });
  return clean?.kind === 'waypoint' ? clean : null;
}
