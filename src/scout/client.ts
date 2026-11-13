import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { serviceUrl } from '../serviceUrl';
import { ICON_STYLE, loadIconImage } from '../map/icons';
import { formatLatLng } from '../map/geo';
import type { Repo } from '../storage/repo';
import type { ScoutRow } from '../storage/db';
import type { AppContext } from '../ui/context';
import { fmtDateTime, h } from '../ui/dom';
import { uuid } from '../sync/ids';
import { sanitizeItem } from '../sync/validate';
import { mergeItem } from '../sync/merge';
import type { Waypoint } from '../types';
import {
  SCOUT_ACTIVITY, SCOUT_ACTIVITY_QUEUE, SCOUT_GROUPS, SCOUT_SHARES,
  activityTiles, cellOf, hex, parseInvite, shareableIcon, sharedWaypoint, sightingIcon, validPartyId, validPartySecret,
  type ActivityHit, type ScoutGroup,
} from './grid';

const LAYER = 'scout-pins';
let flushing = false;
let again = false;
let generation = 0;

async function groups(repo: Repo): Promise<ScoutGroup[]> {
  const saved = await repo.getMeta<ScoutGroup[]>(SCOUT_GROUPS);
  if (!Array.isArray(saved)) return [];
  return saved.filter(group => group && validPartyId(group.id) && validPartySecret(group.secret) && typeof group.memberId === 'string' && typeof group.name === 'string');
}

async function saveGroups(repo: Repo, list: ScoutGroup[]): Promise<void> {
  await repo.setMeta(SCOUT_GROUPS, list);
  repo.notifyScout();
}

function rowId(groupId: string, itemId: string): string {
  return `${groupId}:${itemId}`;
}

async function shares(repo: Repo): Promise<Record<string, string[]>> {
  const saved = await repo.getMeta<Record<string, string[]>>(SCOUT_SHARES);
  return saved && typeof saved === 'object' ? saved : {};
}

/** Queue party copies for items the user chose to share, and tombstones for the rest. */
async function stageOwned(repo: Repo, group: ScoutGroup): Promise<void> {
  const [all, linked, rows] = await Promise.all([repo.allIncludingDeleted(), shares(repo), repo.scoutRows()]);
  const mine = rows.filter(row => row.groupId === group.id && row.owned);
  const puts: ScoutRow[] = [];
  const seen = new Set<string>();
  const queue = (existing: ScoutRow | undefined, item: Waypoint, deleted: boolean): void => {
    const next = sharedWaypoint(item, group.memberId, deleted);
    if (!next) return;
    if (!existing) {
      if (!deleted) puts.push({ id: rowId(group.id, item.id), groupId: group.id, item: next, pending: true, owned: true });
      return;
    }
    if (existing.item.updatedAt === next.updatedAt && existing.item.deleted === next.deleted) return;
    if (existing.item.updatedAt > next.updatedAt) return;
    puts.push({ ...existing, item: next, pending: true });
  };
  for (const [itemId, groupIds] of Object.entries(linked)) {
    if (!groupIds.includes(group.id)) continue;
    seen.add(itemId);
    const item = all.find(entry => entry.id === itemId);
    const existing = mine.find(row => row.item.id === itemId);
    if (!item || item.kind !== 'waypoint') {
      if (existing?.item.kind === 'waypoint' && !existing.item.deleted) queue(existing, existing.item, true);
      continue;
    }
    queue(existing, item, item.deleted || !shareableIcon(item.icon));
  }
  for (const existing of mine) {
    if (seen.has(existing.item.id) || existing.item.deleted || existing.item.kind !== 'waypoint') continue;
    queue(existing, existing.item, true);
  }
  if (puts.length) await repo.putScoutRows(puts);
}

async function stageActivity(repo: Repo): Promise<void> {
  const on = await repo.getMeta<boolean>(SCOUT_ACTIVITY) === true;
  const queued = await repo.getMeta<ActivityHit[]>(SCOUT_ACTIVITY_QUEUE) ?? [];
  if (!on) {
    if (queued.length) await repo.setMeta(SCOUT_ACTIVITY_QUEUE, []);
    return;
  }
  const sent = new Set(await repo.getMeta<string[]>('scout.activitySent') ?? []);
  let changed = false;
  for (const item of await repo.list()) {
    if (item.kind !== 'waypoint' || !sightingIcon(item.icon) || sent.has(item.id) || queued.some(hit => hit.itemId === item.id)) continue;
    const cell = cellOf(item.coord[0], item.coord[1]);
    if (!cell || !activityTiles(cell).length) continue;
    queued.push({ id: hex(16), itemId: item.id, cell });
    changed = true;
  }
  if (changed) await repo.setMeta(SCOUT_ACTIVITY_QUEUE, queued);
}

async function post(path: string, secret: string, body: unknown): Promise<Response> {
  return fetch(serviceUrl(path), {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function pushGroup(repo: Repo, group: ScoutGroup): Promise<ScoutGroup> {
  if (!group.registered) {
    if (group.left) return group;
    const created = await post('/api/scout/groups', group.secret, { id: group.id, name: group.name });
    if (created.status === 409) return { ...group, rejected: true };
    if (!created.ok) return group;
    const payload = await created.json() as { name?: unknown };
    group = { ...group, registered: true, ...(typeof payload.name === 'string' && payload.name ? { name: payload.name } : {}) };
  }
  if (!group.left) await stageOwned(repo, group);
  let cursor = group.cursor;
  for (;;) {
    const pending = (await repo.scoutRows()).filter(row => row.groupId === group.id && row.pending).slice(0, 20);
    const sent = new Map(pending.map(row => [row.item.id, row.item.updatedAt]));
    const response = await post('/api/scout/sync', group.secret, { id: group.id, cursor, changes: pending.map(row => row.item) });
    if (response.status === 403) return { ...group, rejected: true };
    if (response.status === 404) return { ...group, registered: false };
    if (!response.ok) return { ...group, cursor };
    const result = await response.json() as { name?: unknown; cursor?: unknown; changes?: unknown; resolved?: unknown; hasMore?: unknown };
    if (!Number.isSafeInteger(result.cursor) || (result.cursor as number) < cursor || !Array.isArray(result.changes) || !Array.isArray(result.resolved)) return group;
    const incoming = [...result.changes, ...result.resolved].map(value => sanitizeItem(value));
    if (incoming.some(item => !item || item.kind !== 'waypoint')) return group;
    const fresh = await repo.scoutRows();
    const puts: ScoutRow[] = [];
    for (const item of incoming) {
      if (!item) continue;
      const existing = fresh.find(row => row.groupId === group.id && row.item.id === item.id);
      const winner = mergeItem(existing?.item, item);
      const pending = !!existing?.pending && winner === existing.item && existing.item.updatedAt !== sent.get(item.id);
      puts.push({ id: rowId(group.id, winner.id), groupId: group.id, item: winner, pending, owned: existing?.owned ?? false });
    }
    for (const row of pending) {
      if (incoming.some(item => item?.id === row.item.id)) continue;
      const latest = fresh.find(entry => entry.id === row.id);
      if (latest && latest.item.updatedAt === row.item.updatedAt) puts.push({ ...latest, pending: false });
    }
    if (puts.length) await repo.putScoutRows(puts);
    cursor = result.cursor as number;
    group = { ...group, cursor, ...(typeof result.name === 'string' && result.name ? { name: result.name } : {}) };
    if (!result.hasMore && !(await repo.scoutRows()).some(row => row.groupId === group.id && row.pending)) break;
  }
  return group;
}

async function flushActivity(repo: Repo): Promise<void> {
  const queued = await repo.getMeta<ActivityHit[]>(SCOUT_ACTIVITY_QUEUE) ?? [];
  if (!queued.length) return;
  const batch = queued.slice(0, 20);
  const response = await post('/api/scout/activity', '', { hits: batch.map(hit => ({ id: hit.id, cell: hit.cell })) });
  if (!response.ok) return;
  const sent = new Set(await repo.getMeta<string[]>('scout.activitySent') ?? []);
  for (const hit of batch) sent.add(hit.itemId);
  await repo.setMeta('scout.activitySent', [...sent].slice(-5000));
  await repo.setMeta(SCOUT_ACTIVITY_QUEUE, queued.filter(hit => !batch.some(done => done.id === hit.id)));
}

async function finishLeft(repo: Repo, group: ScoutGroup): Promise<boolean> {
  const rows = (await repo.scoutRows()).filter(row => row.groupId === group.id);
  const live = rows.filter(row => row.owned && row.item.kind === 'waypoint' && !row.item.deleted);
  if (live.length) {
    const tombs: ScoutRow[] = [];
    for (const row of live) {
      if (row.item.kind !== 'waypoint') continue;
      const item = sharedWaypoint(row.item, group.memberId, true);
      if (item) tombs.push({ ...row, item, pending: true });
    }
    if (tombs.length) await repo.putScoutRows(tombs);
    return false;
  }
  if (rows.some(row => row.pending)) return false;
  await repo.deleteScoutRows(rows.map(row => row.id));
  return true;
}

async function once(repo: Repo): Promise<void> {
  await stageActivity(repo);
  const list = await groups(repo);
  const next: ScoutGroup[] = [];
  let changed = false;
  for (const group of list) {
    if (group.rejected) { next.push(group); continue; }
    try {
      if (group.left) {
        if (!group.registered) {
          await repo.deleteScoutRows((await repo.scoutRows()).filter(row => row.groupId === group.id).map(row => row.id));
          changed = true;
          continue;
        }
        await finishLeft(repo, group);
        const synced = await pushGroup(repo, group);
        if (synced.rejected) { next.push(synced); changed = true; continue; }
        if (await finishLeft(repo, synced)) { changed = true; continue; }
        next.push(synced);
        changed = changed || synced.cursor !== group.cursor || synced.registered !== group.registered;
        continue;
      }
      const synced = await pushGroup(repo, group);
      next.push(synced);
      changed = changed || synced.cursor !== group.cursor || synced.registered !== group.registered || synced.rejected !== group.rejected || synced.name !== group.name;
    } catch {
      next.push(group);
    }
  }
  if (changed) await saveGroups(repo, next);
  try { await flushActivity(repo); } catch { /* Retry on the next wake. */ }
}

function flush(repo: Repo): void {
  if (flushing) { again = true; return; }
  flushing = true;
  void (async () => {
    try {
      do {
        again = false;
        await once(repo);
      } while (again);
    } finally { flushing = false; }
  })();
}

async function drawPins(ctx: AppContext): Promise<void> {
  const map = ctx.map.map;
  const gen = ++generation;
  if (!map.isStyleLoaded()) return;
  let source: GeoJSONSource | undefined;
  try {
    if (!map.getSource(LAYER)) {
      map.addSource(LAYER, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: LAYER, type: 'symbol', source: LAYER,
        layout: { 'icon-image': ['get', 'image'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      });
    }
    source = map.getSource(LAYER) as GeoJSONSource | undefined;
  } catch { return; }
  if (!source) return;
  const local = new Set((await ctx.repo.list()).map(item => item.id));
  const rows = (await ctx.repo.scoutRows()).filter(row => row.item.kind === 'waypoint' && !row.item.deleted && !(row.owned && local.has(row.item.id)));
  const images = new Map<string, { icon: Waypoint['icon']; color: string }>();
  for (const row of rows) {
    if (row.item.kind !== 'waypoint') continue;
    const color = row.item.color ?? ICON_STYLE[row.item.icon].color;
    images.set(`scout-${row.item.icon}-${color.slice(1)}`, { icon: row.item.icon, color });
  }
  await Promise.all([...images].map(async ([id, spec]) => {
    if (map.hasImage(id)) return;
    const image = await loadIconImage(spec.icon, 40, spec.color);
    if (gen === generation && map.isStyleLoaded() && map.getSource(LAYER) && !map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
  }));
  if (gen !== generation || !map.isStyleLoaded() || !map.getSource(LAYER)) return;
  source.setData({
    type: 'FeatureCollection',
    features: rows.flatMap(row => {
      if (row.item.kind !== 'waypoint') return [];
      const color = row.item.color ?? ICON_STYLE[row.item.icon].color;
      return [{ type: 'Feature' as const, id: row.id, properties: { id: row.id, image: `scout-${row.item.icon}-${color.slice(1)}` }, geometry: { type: 'Point' as const, coordinates: row.item.coord } }];
    }),
  });
}

export function inviteUrl(group: ScoutGroup): string {
  return `https://freehuntingmap.com/#party/${group.id}/${group.secret}`;
}

export async function createParty(repo: Repo, name: string): Promise<boolean> {
  const clean = name.trim().slice(0, 40);
  if (!clean) return false;
  const list = await groups(repo);
  if (list.filter(group => !group.left).length >= 20) return false;
  list.unshift({ id: hex(16), secret: hex(32), name: clean, memberId: uuid(), cursor: 0, registered: false });
  await saveGroups(repo, list);
  flush(repo);
  return true;
}

export async function joinParty(repo: Repo, text: string): Promise<boolean> {
  const invite = parseInvite(text);
  if (!invite) return false;
  const list = await groups(repo);
  if (!list.some(group => group.id === invite.id)) {
    list.unshift({ ...invite, name: 'Party', memberId: uuid(), cursor: 0, registered: true });
    await saveGroups(repo, list);
  }
  flush(repo);
  return true;
}

export async function leaveParty(repo: Repo, id: string): Promise<void> {
  const linked = await shares(repo);
  for (const [itemId, ids] of Object.entries(linked)) {
    const remaining = ids.filter(groupId => groupId !== id);
    if (remaining.length) linked[itemId] = remaining;
    else delete linked[itemId];
  }
  await repo.setMeta(SCOUT_SHARES, linked);
  const list = await groups(repo);
  await saveGroups(repo, list.map(group => group.id === id ? { ...group, left: true } : group));
  flush(repo);
}

export async function openScoutPin(ctx: AppContext, id: string): Promise<void> {
  const row = (await ctx.repo.scoutRows()).find(entry => entry.id === id);
  if (!row || row.item.kind !== 'waypoint' || row.item.deleted) return;
  if (row.owned) {
    const local = await ctx.repo.get(row.item.id);
    if (local && !local.deleted) { ctx.openItem(local); return; }
  }
  const item = row.item;
  const when = typeof item.seenAt === 'number' ? fmtDateTime(item.seenAt) : '';
  ctx.sheet.open(`scout:${id}`, item.name || ICON_STYLE[item.icon].title, h(
    'div', { class: 'form' },
    item.photo ? h('img', { class: 'sighting-photo', alt: '', src: item.photo }) : null,
    item.sex === 'buck' || item.sex === 'doe' ? h('div', {}, item.sex === 'buck' ? 'Buck' : 'Doe') : null,
    when ? h('div', {}, when) : null,
    item.note ? h('div', {}, item.note) : null,
    h('div', { class: 'mono' }, formatLatLng(item.coord)),
  ));
}

export function startScout(ctx: AppContext): void {
  const map: MapLibreMap = ctx.map.map;
  const refresh = (): void => { void drawPins(ctx); };
  map.on('style.load', refresh);
  if (map.isStyleLoaded()) refresh();
  ctx.repo.addEventListener('change', () => flush(ctx.repo));
  ctx.repo.addEventListener('scout', () => { refresh(); flush(ctx.repo); });
  window.addEventListener('online', () => flush(ctx.repo));
  window.setInterval(() => flush(ctx.repo), 60_000);
  const invite = parseInvite(location.hash);
  if (invite) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    void joinParty(ctx.repo, `party/${invite.id}/${invite.secret}`);
  }
  flush(ctx.repo);
}
