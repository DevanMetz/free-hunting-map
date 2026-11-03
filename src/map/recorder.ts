import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import type { LngLat } from '../types';
import { haversine, roundCoord } from './geo';

export const MAX_ACCURACY_M = 30;
export const MIN_STEP_M = 5;
export const MAX_SPEED_M_PER_S = 12;
const GAP_DISTANCE_M = 50;
const GAP_TIME_MS = 60_000;
const MIN_SMOOTH_WEIGHT = 0.65;
const MOVEMENT_ACCURACY_FACTOR = 2;
const backgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
const recordingPermissions = registerPlugin<{ prepare(): Promise<void> }>('RecordingPermissions');

/** Pure filter: accept a fix if accurate enough and far enough from the last kept point. */
export function acceptFix(prev: LngLat | undefined, next: LngLat, accuracy: number, previousAccuracy = 0): boolean {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_M) return false;
  return !prev || haversine(prev, next) >= Math.max(MIN_STEP_M, accuracy, previousAccuracy);
}

/** GPS track recorder around navigator.geolocation.watchPosition. */
export class TrackRecorder {
  private watchId: number | null = null;
  private nativeGeneration = 0;
  private nativeActive = false;
  private nativeWatcherId: string | null = null;
  private consecutiveTimeouts = 0;
  private reportedError: number | null = null;
  coords: LngLat[] = [];
  segments: number[] = [];
  private lastFixTime = 0;
  private lastAccuracy = 0;
  private lastRawFix: LngLat | undefined;
  private wasHidden = false;
  private movementCandidate: LngLat | undefined;

  constructor(
    private readonly onPoint: (coords: LngLat[], pos: GeolocationPosition) => void,
    private readonly onError: (err: GeolocationPositionError) => void,
  ) {}

  get active(): boolean {
    return this.watchId !== null || this.nativeActive;
  }

  async start(initial: LngLat[] = [], segments: number[] = [], lastFixTime = 0, lastAccuracy = 0): Promise<void> {
    if (this.active) return;
    this.coords = [...initial];
    this.segments = [...segments];
    this.lastFixTime = lastFixTime;
    this.lastAccuracy = Number.isFinite(lastAccuracy) && lastAccuracy >= 0 ? lastAccuracy : 0;
    this.lastRawFix = initial.at(-1);
    this.wasHidden = false;
    this.movementCandidate = undefined;
    this.consecutiveTimeouts = 0;
    this.reportedError = null;
    const onPosition = (pos: GeolocationPosition): void => {
        this.consecutiveTimeouts = 0;
        this.reportedError = null;
        const next = roundCoord([pos.coords.longitude, pos.coords.latitude]);
        if (!acceptFix(this.lastRawFix, next, pos.coords.accuracy, this.lastAccuracy)) {
          this.movementCandidate = undefined;
          return;
        }
        const previous = this.coords.at(-1);
        const elapsed = pos.timestamp - this.lastFixTime;
        const distance = this.lastRawFix ? haversine(this.lastRawFix, next) : 0;
        const gap = !!previous && distance > GAP_DISTANCE_M && (this.wasHidden || (this.lastFixTime > 0 && elapsed > GAP_TIME_MS));
        if (this.lastRawFix && !gap && this.lastFixTime > 0 && (elapsed <= 0 || distance / (elapsed / 1000) > MAX_SPEED_M_PER_S)) return;
        if (this.lastRawFix && !gap) {
          // A single outlier can cross the accuracy radius even while stationary.
          // Confirm that the next fix is also displaced in the same direction.
          const threshold = Math.max(MIN_STEP_M, MOVEMENT_ACCURACY_FACTOR * Math.max(this.lastAccuracy, pos.coords.accuracy));
          if (distance < threshold) {
            this.movementCandidate = undefined;
            return;
          }
          if (!this.movementCandidate || haversine(this.movementCandidate, next) >= distance) {
            this.movementCandidate = next;
            return;
          }
        }
        this.movementCandidate = undefined;
        if (gap) this.segments.push(this.coords.length);
        let point = next;
        if (previous && !gap) {
          const weight = Math.max(MIN_SMOOTH_WEIGHT, this.lastAccuracy / (this.lastAccuracy + pos.coords.accuracy || 1));
          const deltaLng = ((next[0] - previous[0] + 540) % 360) - 180;
          point = roundCoord([((previous[0] + deltaLng * weight + 540) % 360) - 180, previous[1] + (next[1] - previous[1]) * weight]);
        }
        this.wasHidden = false;
        this.lastFixTime = pos.timestamp;
        this.lastAccuracy = pos.coords.accuracy;
        this.lastRawFix = next;
        this.coords.push(point);
        this.onPoint(this.coords, pos);
      };
    const onError = (err: GeolocationPositionError): void => {
        if (err.code === err.TIMEOUT && ++this.consecutiveTimeouts < 2) return;
        if (err.code !== err.TIMEOUT) this.consecutiveTimeouts = 0;
        if (this.reportedError === null || (err.code === err.PERMISSION_DENIED && this.reportedError !== err.code)) {
          this.reportedError = err.code;
          this.onError(err);
        }
      };
    if (Capacitor.isNativePlatform()) {
      if (Capacitor.getPlatform() === 'android') await recordingPermissions.prepare();
      this.nativeActive = true;
      const generation = ++this.nativeGeneration;
      void backgroundGeolocation.addWatcher(
        { backgroundTitle: 'Recording hike', backgroundMessage: 'Free Hunting Map', requestPermissions: Capacitor.getPlatform() !== 'android', stale: false, distanceFilter: 0 },
        (location, error) => {
          if (!this.nativeActive || generation !== this.nativeGeneration) return;
          if (error) {
            onError({ code: error.code === 'NOT_AUTHORIZED' ? 1 : 2, message: error.code === 'NOT_AUTHORIZED' ? error.message : 'GPS unavailable. Stop recording and try again.', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
          } else if (location) {
            onPosition({ timestamp: location.time ?? Date.now(), coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, altitude: location.altitude, altitudeAccuracy: location.altitudeAccuracy, heading: location.bearing, speed: location.speed, toJSON: () => ({}) }, toJSON: () => ({}) });
          }
        },
      ).then(id => {
        if (!this.nativeActive || generation !== this.nativeGeneration) void backgroundGeolocation.removeWatcher({ id }).catch(() => {});
        else this.nativeWatcherId = id;
      }).catch(() => {
        if (this.nativeActive && generation === this.nativeGeneration) onError({ code: 2, message: 'Could not start GPS. Stop recording and try again.', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      });
    } else {
      this.watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
    }
  }

  markHidden(): void { if (this.active && !this.nativeActive) this.wasHidden = true; }

  stop(): LngLat[] {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.nativeActive = false;
    this.nativeGeneration++;
    if (this.nativeWatcherId !== null) void backgroundGeolocation.removeWatcher({ id: this.nativeWatcherId }).catch(() => {});
    this.nativeWatcherId = null;
    return this.coords;
  }
}
