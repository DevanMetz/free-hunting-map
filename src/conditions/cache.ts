import type { Repo } from '../storage/repo';
import { fetchWeather, type Weather } from './weather';

const KEY = 'conditions:last';

export interface ConditionsResult {
  weather: Weather | null;
  /** True when served from the IndexedDB cache because the network failed. */
  stale: boolean;
}

/** Network first; on failure fall back to the last cached forecast. */
export async function loadConditions(repo: Repo, lat: number, lng: number): Promise<ConditionsResult> {
  try {
    const weather = await fetchWeather(lat, lng, AbortSignal.timeout(10_000));
    await repo.setMeta(KEY, weather);
    return { weather, stale: false };
  } catch {
    return { weather: (await repo.getMeta<Weather>(KEY)) ?? null, stale: true };
  }
}
