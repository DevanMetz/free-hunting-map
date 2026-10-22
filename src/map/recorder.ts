import type { LngLat } from '../types';
import { haversine, roundCoord } from './geo';

export const MAX_ACCURACY_M = 50;
export const MIN_STEP_M = 5;

/** Pure filter: accept a fix if accurate enough and far enough from the last kept point. */
export function acceptFix(prev: LngLat | undefined, next: LngLat, accuracy: number): boolean {
  if (!(accuracy <= MAX_ACCURACY_M)) return false;
  return !prev || haversine(prev, next) >= MIN_STEP_M;
}

/** GPS track recorder around navigator.geolocation.watchPosition. */
export class TrackRecorder {
  private watchId: number | null = null;
  coords: LngLat[] = [];

  constructor(
    private readonly onPoint: (coords: LngLat[]) => void,
    private readonly onError: (err: GeolocationPositionError) => void,
  ) {}

  get active(): boolean {
    return this.watchId !== null;
  }

  start(initial: LngLat[] = []): void {
    if (this.active) return;
    this.coords = [...initial];
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next = roundCoord([pos.coords.longitude, pos.coords.latitude]);
        if (!acceptFix(this.coords.at(-1), next, pos.coords.accuracy)) return;
        this.coords.push(next);
        this.onPoint(this.coords);
      },
      (err) => this.onError(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    );
  }

  stop(): LngLat[] {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    return this.coords;
  }
}
