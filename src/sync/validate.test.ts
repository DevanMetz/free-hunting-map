import { expect, it } from 'vitest';
import { wp, trk } from '../test/fixtures';
import { sanitizeItem } from './validate';
import { portablePreferences, sanitizeRecord } from './records';
it('retains old payloads exactly and sanitizes new item fields', () => {
  expect(sanitizeItem(wp())).toEqual(wp()); expect(sanitizeItem(trk())).toEqual(trk());
  expect(sanitizeItem({ ...wp(), icon: 'trailcam', fov: { bearing: -10, angle: 200, range: 0 }, camera: 'Model', categoryId: 'category-123', hidden: true, color: '#AABBCC' }))
    .toMatchObject({ icon: 'trailcam', fov: { bearing: 350, angle: 120, range: 3 }, camera: 'Model', categoryId: 'category-123', hidden: true, color: '#aabbcc' });
  const clean = sanitizeItem({ ...wp(), fov: { bearing: Infinity, angle: NaN }, color: 'url(evil)', categoryId: {}, hidden: 'true', setAt: NaN, checkedAt: 1e30 })!;
  expect(clean).toMatchObject({ fov: { bearing: 0, angle: 45, range: 25 } });
  for (const key of ['color', 'categoryId', 'hidden', 'setAt', 'checkedAt']) expect(clean).not.toHaveProperty(key);
});
it('accepts category tombstones and portable type visibility, stripping unsafe fields', () => {
  expect(sanitizeRecord({ ...wp(), kind: 'category', name: ' North ', hidden: true, icon: 'stand', color: '#abcdef', sort: 2, deleted: true })).toMatchObject({ kind: 'category', name: 'North', hidden: true, deleted: true });
  expect(sanitizeRecord({ ...wp(), kind: 'category', name: '' })).toBeNull();
  expect(portablePreferences({ showPins: false, showTrails: true, showRecordings: false, query: 'secret', view: {} })).toEqual({ showPins: false, showTrails: true, showRecordings: false });
});
