import { describe, expect, it } from 'vitest';
import { formatDistance, haversine, pathLength } from './geo';
import { acceptFix } from './recorder';

describe('geo', () => {
  it('haversine matches a known distance (1 degree of latitude ≈ 111.2 km)', () => {
    expect(haversine([0, 0], [0, 1])).toBeCloseTo(111_195, -2);
  });

  it('pathLength sums segments', () => {
    expect(pathLength([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(2 * 111_195, -2);
    expect(pathLength([[0, 0]])).toBe(0);
  });

  it('formats imperial, feet and metric', () => {
    const d = formatDistance(1609.344);
    expect(d).toEqual({ imperial: '1.00 mi', feet: '5,280 ft', metric: '1.61 km' });
    expect(formatDistance(100).metric).toBe('100 m');
  });

  it('GPS filter rejects inaccurate or jittery fixes', () => {
    expect(acceptFix(undefined, [0, 0], 10)).toBe(true);
    expect(acceptFix(undefined, [0, 0], 120)).toBe(false);
    expect(acceptFix([0, 0], [0, 0.00001], 5)).toBe(false); // ~1 m
    expect(acceptFix([0, 0], [0, 0.0001], 5)).toBe(true); // ~11 m
  });
});
