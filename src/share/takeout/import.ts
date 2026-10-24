import type { Item, Waypoint } from '../../types';
import type { Repo } from '../../storage/repo';
import { haversine } from '../../map/geo';
import { contentId } from '../../sync/ids';
import { sanitizeItem } from '../../sync/validate';
import type { Place, TakeoutResult } from './parse';

const normalized = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
export function dedupePlaces(places: Place[], existing: Item[]): { places: Place[]; duplicates: number } {
  const seen: Place[] = existing.filter((item): item is Waypoint => item.kind === 'waypoint' && !item.deleted);
  const accepted: Place[] = [];
  let duplicates = 0;
  for (const place of places) {
    if (seen.some((other) => (place.sourceUrl && other.sourceUrl === place.sourceUrl) ||
      (normalized(place.name) === normalized(other.name) && haversine(place.coord, other.coord) <= 5))) duplicates++;
    else { seen.push(place); accepted.push(place); }
  }
  return { places: accepted, duplicates };
}

export async function importTakeout(repo: Repo, parsed: TakeoutResult, source: string): Promise<{ imported: number; duplicates: number; skipped: number }> {
  const selected = dedupePlaces(parsed.places, await repo.list());
  const items: Item[] = [];
  let skipped = parsed.skipped;
  for (const place of selected.places) {
    const now = repo.clock.now();
    const item = sanitizeItem({ ...place, kind: 'waypoint', icon: 'pin',
      id: contentId(JSON.stringify(['takeout', place.sourceUrl || [normalized(place.name), place.coord]])),
      createdAt: now, updatedAt: now, deviceId: repo.deviceId, deleted: false });
    if (item) items.push(item); else skipped++;
  }
  const result = await repo.importItems(items, source);
  return { imported: result.changed, duplicates: selected.duplicates, skipped };
}
