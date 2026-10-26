import { expect, it } from 'vitest';
import { cutsPalette, filterCutsPixels } from './cutsFilter';

it('filters exact year colors and preserves alpha for selected years', () => {
  const pixels = new Uint8ClampedArray(cutsPalette.flatMap(color => [...color, 255]));
  filterCutsPixels(pixels, 2013);
  for (let i = 0; i < 25; i++) expect(pixels[i * 4 + 3]).toBe(i < 12 ? 0 : 255);
});

it('classifies overview colors by their nearest palette year', () => {
  const color = cutsPalette[20]!;
  const pixels = new Uint8ClampedArray([color[0]! + 1, color[1]!, color[2]!, 80, ...cutsPalette[2]!, 40, 0, 0, 0, 0]);
  filterCutsPixels(pixels, 2020);
  expect([pixels[3], pixels[7], pixels[11]]).toEqual([80, 0, 0]);
});
