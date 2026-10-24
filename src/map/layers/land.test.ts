import { expect, it } from 'vitest';
import { sectionContent, townshipContent } from './land';
import { attributeResult, mapImage } from './arcgis';
it('keeps PLSS identifiers, omits missing attributes and preserves numeric zero', () => {
  expect(townshipContent({ TWNSHPLAB: 'T24N R03W' })?.rows).toEqual([['Township / range', 'T24N R03W']]);
  expect(sectionContent({ FRSTDIVNO: '09', PLSSID: 'WI230240N0030W0' })?.rows).toContainEqual(['Section', '09']);
  expect(attributeResult('x', { a: 0, b: null, c: '<Null>', d: {} }, [['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']])?.rows).toEqual([['A', '0']]);
});
it('exports transparent PNGs with a literal MapLibre bbox token and encoded renderer', () => {
  const url = mapImage('https://example.gov/MapServer', { dynamicLayers: '[{"id":0}]' });
  expect(url).toContain('bbox={bbox-epsg-3857}');
  expect(new URL(url).searchParams.get('format')).toBe('png32');
  expect(new URL(url).searchParams.get('size')).toBe('512,512');
  expect(new URL(url).searchParams.get('transparent')).toBe('true');
  expect(new URL(url).searchParams.get('dynamicLayers')).toBe('[{"id":0}]');
});

it('reads township and range from standard PLSS section IDs without guessing fractional surveys', () => {
  expect(sectionContent({ FRSTDIVNO: '36', PLSSID: 'WI460240N0040W0', FRSTDIVTXT: 'Section' })?.rows).toEqual([['Section', '36'], ['Township / range', '24N 4W']]);
  expect(sectionContent({ FRSTDIVNO: '09', PLSSID: 'WI460242N0040W0' })?.rows).toContainEqual(['Township ID', 'WI460242N0040W0']);
});
