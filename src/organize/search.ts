import type { Category, Item } from '../types';
import { categoryOf, itemType, type ItemType } from './model';

export interface SearchFilter { type?: ItemType; categoryId?: string }
const normalize = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function dateTerms(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()} ${d.toLocaleString('en-US', { month: 'long' })} ${d.getMonth() + 1}/${d.getDate()} ${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${d.toISOString().slice(0, 10)}`;
}
/** All query tokens must match. Lower scores are stronger; ties are stable across devices. */
export function searchItems(items: Item[], categories: Category[], query: string, filter: SearchFilter = {}): Item[] {
  const q = normalize(query.trim());
  const terms = q.split(/\s+/).filter(Boolean);
  return items.flatMap(item => {
    if (item.deleted || (filter.type && itemType(item) !== filter.type)) return [];
    const category = categoryOf(item, categories);
    if (filter.categoryId !== undefined && (category?.id ?? '') !== filter.categoryId) return [];
    const name = normalize(item.name);
    const type = itemType(item);
    const aliases = type === 'trailcam' ? 'trail cam trailcam camera pin waypoint' : type === 'pin' ? 'pin waypoint' : type === 'trail' ? 'trail track drawn' : 'recording recorded gps track';
    const other = normalize(`${item.note} ${category?.name ?? 'Uncategorized'} ${aliases} ${dateTerms(item.createdAt)} ${dateTerms(item.updatedAt)} ${item.kind === 'waypoint' ? `${item.camera ?? ''} ${item.setAt ? dateTerms(item.setAt) : ''} ${item.checkedAt ? dateTerms(item.checkedAt) : ''}` : ''}`);
    if (!terms.every(t => name.includes(t) || other.includes(t))) return [];
    const score = !q ? 0 : name === q ? 0 : name.startsWith(q) ? 1 : terms.every(t => name.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(t))) ? 2 : name.includes(q) ? 3 : 4;
    return [{ item, score }];
  }).sort((a, b) => a.score - b.score || b.item.updatedAt - a.item.updatedAt || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0)).map(r => r.item);
}

/** Ranges only; the view creates text nodes and <mark>, never user-authored HTML. */
export function matchRanges(text: string, query: string): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of query.toLowerCase().trim().split(/\s+/).filter(Boolean)) {
    let at = 0;
    while ((at = lower.indexOf(token, at)) !== -1) { ranges.push([at, at + token.length]); at += token.length; }
  }
  const merged: [number, number][] = [];
  for (const r of ranges.sort((a, b) => a[0] - b[0])) {
    const prev = merged.at(-1);
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]); else merged.push([...r]);
  }
  return merged;
}
