// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { wp, trk } from '../test/fixtures';
import { toGeoJSON, fromGeoJSON } from './geojson';
import { toGpx, fromGpx } from './gpx';
import { toCompact, fromCompact } from './compact';
import { encodeItemsToChunks, QrAssembler } from './qr';
const items = [{ ...wp(), icon: 'trailcam' as const, categoryId: 'category-camp', categoryName: 'Camp & <North>', color: '#abcdef', fov: { bearing: 350, angle: 45, range: 25 }, camera: 'Browning', setAt: 12345, checkedAt: 23456 }, { ...trk(), categoryName: 'Trails', color: '#123456' }];
it('round trips category names and all trail cam fields in GPX, GeoJSON and compact QR', () => {
  expect(fromGpx(toGpx(items))).toEqual(items);
  expect(fromGeoJSON(toGeoJSON(items))).toEqual(items);
  expect(items.map(i => fromCompact(toCompact(i)))).toEqual(items);
  const assembler = new QrAssembler();
  const chunks = encodeItemsToChunks(items, 100);
  let result;
  for (const chunk of chunks.reverse()) result = assembler.add(chunk);
  expect(result).toMatchObject({ status: 'complete', items });
});
it('omits hidden from sharing and accepts foreign category/FOV properties', () => {
  const item = { ...items[0]!, hidden: true };
  expect(JSON.stringify(toGeoJSON([item]))).not.toContain('hidden');
  expect(toGpx([item])).not.toContain('hidden');
  expect(fromCompact(toCompact(item))).not.toHaveProperty('hidden');
  const result = fromGeoJSON({ type: 'Feature', geometry: { type: 'Point', coordinates: [-90, 44] }, properties: { name: 'Camera', icon: 'trailcam', category: 'North', fov_bearing: 90, fov_angle: 60, fov_range: 50 } });
  expect(result[0]).toMatchObject({ categoryName: 'North', fov: { bearing: 90, angle: 60, range: 50 } });
});
