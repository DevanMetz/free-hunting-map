import type { Item } from '../types';
import { contentId } from '../sync/ids';

/** Old Takeout imports used deterministic IDs and appended the CSV/JSON list name. */
export function legacyTakeoutCategory(item: Item, knownNames: string[] = []): { name: string; note: string } | null {
  if (item.deleted || item.categoryId || item.kind !== 'waypoint' || !item.sourceUrl) return null;
  let url: URL;
  try { url = new URL(item.sourceUrl); } catch { return null; }
  if (!/(^|\.)(google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)$/i.test(url.hostname)) return null;
  const lines = item.note.split('\n');
  const name = lines.at(-1)?.trim();
  if (!name || name.length > 120) return null;
  const takeoutId = contentId(JSON.stringify(['takeout', item.sourceUrl]));
  if (item.id !== takeoutId && !['Saved places', 'Labeled', 'Starred places', ...knownNames].includes(name)) return null;
  return { name, note: lines.slice(0, -1).join('\n') };
}
