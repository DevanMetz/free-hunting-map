import { getMoonIllumination, getMoonTimes, getTimes } from 'suncalc';

export interface SunMoon {
  civilDawn: Date | null;
  sunrise: Date | null;
  sunset: Date | null;
  civilDusk: Date | null;
  moonPhase: string;
  /** 0..1 */
  moonIllumination: number;
  /** 0..1 SunCalc phase (0 new, 0.5 full) */
  moonPhaseValue: number;
  moonrise: Date | null;
  moonset: Date | null;
}

export function sunMoon(date: Date, lat: number, lng: number): SunMoon {
  // Anchor at local noon so the times belong to the displayed day.
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const sun = getTimes(noon, lat, lng);
  const illum = getMoonIllumination(date);
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  const moon = getMoonTimes(midnight, lat, lng);
  return {
    civilDawn: valid(sun.dawn),
    sunrise: valid(sun.sunrise),
    sunset: valid(sun.sunset),
    civilDusk: valid(sun.dusk),
    moonPhase: phaseName(illum.phase),
    moonIllumination: illum.fraction,
    moonPhaseValue: illum.phase,
    moonrise: valid(moon.rise),
    moonset: valid(moon.set),
  };
}

export function phaseName(p: number): string {
  if (p < 0.03 || p > 0.97) return 'New moon';
  if (p < 0.22) return 'Waxing crescent';
  if (p < 0.28) return 'First quarter';
  if (p < 0.47) return 'Waxing gibbous';
  if (p < 0.53) return 'Full moon';
  if (p < 0.72) return 'Waning gibbous';
  if (p < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

function valid(d: Date | null | undefined): Date | null {
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
