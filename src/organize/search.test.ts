import { expect, it } from 'vitest';
import { wp, trk } from '../test/fixtures';
import { searchItems, matchRanges } from './search';
import { effectiveColor, effectiveIcon, isVisible, forSharing } from './model';
import type { Category } from '../types';
const cat: Category = { ...wp(), kind: 'category', name: 'Creek', hidden: false, color: '#112233', icon: 'stand' };
it('ranks exact and prefix names above words and note/category matches, with deterministic ties', () => {
  const base = wp({ note: '' });
  const items = [
    { ...base, id: 'note-item', name: 'Z', note: 'camp' },
    { ...base, id: 'word-item', name: 'North camp' },
    { ...base, id: 'prefix-item', name: 'Camping' },
    { ...base, id: 'exact-item', name: 'Camp', hidden: true },
  ];
  expect(searchItems(items, [], 'camp').map(i => i.id)).toEqual(['exact-item', 'prefix-item', 'word-item', 'note-item']);
  const a = { ...base, id: 'aaa-item' }, b = { ...base, id: 'bbb-item' };
  expect(searchItems([b, a], [], '').map(i => i.id)).toEqual(['aaa-item', 'bbb-item']);
  expect(searchItems(items, [], 'north camp')).toHaveLength(1);
});
it('searches dates, category, type and camera model offline and applies filters', () => {
  const cam = { ...wp(), icon: 'trailcam' as const, camera: 'Browning', categoryId: cat.id, createdAt: new Date(2026, 9, 12).getTime() };
  for (const q of ['2026', 'oct', '10/12', 'trail cam', 'Browning', 'Creek']) expect(searchItems([cam], [cat], q)).toEqual([cam]);
  expect(searchItems([cam, trk()], [cat], '', { type: 'trailcam', categoryId: cat.id })).toEqual([cam]);
  expect(searchItems([cam], [cat], '', { type: 'recording' })).toEqual([]);
  expect(searchItems([{ ...cam, categoryId: 'missing-id' }], [cat], 'Uncategorized', { categoryId: '' })).toHaveLength(1);
});
it('resolves visibility, inheritance and portable names without mutating items', () => {
  const pin = { ...wp(), icon: 'pin' as const, categoryId: cat.id };
  expect(effectiveColor(pin, [cat])).toBe(cat.color);
  expect(effectiveIcon(pin, [cat])).toBe('stand');
  expect(effectiveIcon({ ...pin, iconOverride: true }, [cat])).toBe('pin');
  expect(isVisible(pin, [cat], { showPins: false })).toBe(false);
  expect(isVisible(pin, [{ ...cat, hidden: true }])).toBe(false);
  expect(isVisible({ ...pin, hidden: true }, [])).toBe(false);
  expect(isVisible(pin, [{ ...cat, hidden: true, deleted: true }])).toBe(true);
  expect(forSharing({ ...pin, hidden: true }, [cat])).toEqual({ ...pin, categoryName: 'Creek' });
  expect(matchRanges('<Camp> camp', 'cam camp')).toEqual([[1, 5], [7, 11]]);
});
