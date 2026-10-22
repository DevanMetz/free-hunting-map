import { describe, expect, it } from 'vitest';
import { phaseName, sunMoon } from './astro';
import { compass, parseWeather } from './weather';

describe('conditions', () => {
  it('parses an Open-Meteo response', () => {
    const json = {
      timezone: 'America/Denver',
      current: { time: '2026-10-22T09:30', temperature_2m: 43.1, wind_speed_10m: 6.8, wind_direction_10m: 105, wind_gusts_10m: 7.4, weather_code: 0 },
      hourly: {
        time: ['2026-10-22T09:00', '2026-10-22T10:00'],
        temperature_2m: [42, 45],
        wind_speed_10m: [6, 7],
        wind_direction_10m: [100, 110],
        wind_gusts_10m: [8, 9],
        weather_code: [0, 1],
        precipitation_probability: [0, 5],
      },
    };
    const w = parseWeather(json, 44, -110, 123);
    expect(w.current).toMatchObject({ temp: 43.1, windDir: 105, windGust: 7.4 });
    expect(w.hourly).toHaveLength(2);
    expect(w.hourly[1]).toMatchObject({ temp: 45, precipProb: 5 });
    expect(() => parseWeather({}, 0, 0, 0)).toThrow();
  });

  it('compass points', () => {
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(compass(-90)).toBe('W');
  });

  it('sun times are ordered and moon values sane', () => {
    const s = sunMoon(new Date('2026-10-22T12:00:00'), 44, -90);
    expect(s.civilDawn!.getTime()).toBeLessThan(s.sunrise!.getTime());
    expect(s.sunset!.getTime()).toBeLessThan(s.civilDusk!.getTime());
    expect(s.moonIllumination).toBeGreaterThanOrEqual(0);
    expect(s.moonIllumination).toBeLessThanOrEqual(1);
    expect(phaseName(0.5)).toBe('Full moon');
  });
});
