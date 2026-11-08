import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { LngLat } from '../types';
import { haversine, roundCoord } from './geo';
import { drainFixes, listenForFixes, prepareRecording, recordingSession, startRecordingService, stopRecordingService, type NativeFix } from './hikeRecorder';

export const MAX_ACCURACY_M = 30;
export const MIN_STEP_M = 5;
export const MAX_SPEED_M_PER_S = 12;
const GAP_DISTANCE_M = 50;
const GAP_TIME_MS = 60_000;
const MIN_SMOOTH_WEIGHT = 0.65;
const MOVEMENT_ACCURACY_FACTOR = 2;

export interface NativeStart { trackId: string; since: number }

/** Pure filter: accept a fix if accurate enough and far enough from the last kept point. */
export function acceptFix(prev: LngLat | undefined, next: LngLat, accuracy: number, previousAccuracy = 0): boolean {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_M) return false;
  return !prev || haversine(prev, next) >= Math.max(MIN_STEP_M, accuracy, previousAccuracy);
}

/** GPS track recorder. Android keeps listening in a foreground service; browsers use watchPosition. */
export class TrackRecorder {
  private watchId: number | null = null;
  private nativeGeneration = 0;
  private nativeActive = false;
  private usesNative = false;
  private trackId = '';
  private nativeSeq = 0;
  private nativeListener: PluginListenerHandle | null = null;
  private nativePoll = 0;
  private nativeDrain: Promise<void> = Promise.resolve();
  private gpsWarned = false;
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
    private readonly onPoint: (coords: LngLat[], pos: GeolocationPosition, nativeSeq?: number) => void,
    private readonly onError: (err: GeolocationPositionError) => void,
    private readonly onNativeFailure: (message: string) => void,
    private readonly onNativeSeq: (seq: number) => void = () => {},
  ) {}

  get active(): boolean {
    return this.watchId !== null || this.nativeActive;
  }

  /** True until a native log has been drained, so a failed stop can be retried. */
  get needsStop(): boolean {
    return this.active || this.usesNative;
  }

  async start(initial: LngLat[] = [], segments: number[] = [], lastFixTime = 0, lastAccuracy = 0, native?: NativeStart): Promise<void> {
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
    this.nativeSeq = native?.since ?? 0;
    this.trackId = native?.trackId ?? '';
    this.gpsWarned = false;
    this.usesNative = false;
    if (Capacitor.getPlatform() === 'android') {
      if (!native?.trackId) throw new Error('Could not start GPS');
      await prepareRecording();
      await startRecordingService(native.trackId);
      this.usesNative = true;
      this.nativeActive = true;
      const generation = ++this.nativeGeneration;
      try {
        this.nativeListener = await listenForFixes(fix => {
          if (generation !== this.nativeGeneration || !this.nativeActive) return;
          this.ingestNative(fix);
        });
        this.schedulePoll(generation);
        await this.catchUp();
        if (!this.nativeActive) throw new Error('Could not start GPS');
      } catch (error) {
        try { await this.stop(); } catch { /* The caller clears a failed start. */ }
        throw error instanceof Error ? error : new Error('Could not start GPS');
      }
      return;
    }
    if (Capacitor.isNativePlatform()) throw new Error('GPS unavailable');
    const onError = (err: GeolocationPositionError): void => {
      if (err.code === err.TIMEOUT && ++this.consecutiveTimeouts < 2) return;
      if (err.code !== err.TIMEOUT) this.consecutiveTimeouts = 0;
      if (this.reportedError === null || (err.code === err.PERMISSION_DENIED && this.reportedError !== err.code)) {
        this.reportedError = err.code;
        this.onError(err);
      }
    };
    this.watchId = navigator.geolocation.watchPosition(pos => this.applyFix(pos), onError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }

  catchUp(): Promise<void> {
    if (!this.usesNative) return Promise.resolve();
    const run = this.nativeDrain.then(() => this.drainOnce(false));
    this.nativeDrain = run.catch(() => {});
    return run;
  }

  markHidden(): void { if (this.active && !this.nativeActive) this.wasHidden = true; }

  async stop(): Promise<LngLat[]> {
    clearInterval(this.nativePoll);
    this.nativePoll = 0;
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.nativeActive = false;
    this.nativeGeneration++;
    if (this.nativeListener) {
      const listener = this.nativeListener;
      this.nativeListener = null;
      await listener.remove();
    }
    if (this.usesNative) {
      await stopRecordingService();
      for (const fix of await drainFixes(this.nativeSeq)) this.ingestNative(fix, true);
      this.usesNative = false;
    }
    return this.coords;
  }

  private schedulePoll(generation: number): void {
    clearInterval(this.nativePoll);
    this.nativePoll = window.setInterval(() => {
      if (generation !== this.nativeGeneration || !this.nativeActive || document.hidden) return;
      void this.catchUp();
    }, 5000);
  }

  private async drainOnce(force: boolean): Promise<void> {
    if (!this.usesNative || (!this.nativeActive && !force)) return;
    if (this.nativeActive && !document.hidden && this.trackId) {
      const status = await recordingSession();
      if (status.recording && !status.running) {
        try {
          await startRecordingService(this.trackId);
        } catch (error) {
          await this.giveUp(error instanceof Error && error.message ? error.message : 'GPS stopped. Tap stop to save the recording.');
          return;
        }
      }
    }
    for (const fix of await drainFixes(this.nativeSeq)) this.ingestNative(fix, force);
  }

  private async giveUp(message: string): Promise<void> {
    if (this.gpsWarned) return;
    this.gpsWarned = true;
    try { await stopRecordingService(); } catch { /* The service may already be gone. */ }
    try {
      for (const fix of await drainFixes(this.nativeSeq)) this.ingestNative(fix, true);
    } catch { /* Keep the fixes that already reached the map. */ }
    this.nativeActive = false;
    clearInterval(this.nativePoll);
    this.onNativeFailure(message);
  }

  private ingestNative(fix: NativeFix, force = false): void {
    if ((!this.nativeActive && !force) || !Number.isInteger(fix.seq) || fix.seq <= this.nativeSeq) return;
    this.nativeSeq = fix.seq;
    if (Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)) {
      const accuracy = typeof fix.accuracy === 'number' && Number.isFinite(fix.accuracy) ? fix.accuracy : 1000;
      this.applyFix({
        timestamp: typeof fix.time === 'number' && Number.isFinite(fix.time) ? fix.time : Date.now(),
        coords: {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy,
          altitude: typeof fix.altitude === 'number' ? fix.altitude : null,
          altitudeAccuracy: typeof fix.altitudeAccuracy === 'number' ? fix.altitudeAccuracy : null,
          heading: typeof fix.bearing === 'number' ? fix.bearing : null,
          speed: typeof fix.speed === 'number' ? fix.speed : null,
          toJSON: () => ({}),
        },
        toJSON: () => ({}),
      });
    }
    this.onNativeSeq(fix.seq);
  }

  private applyFix(pos: GeolocationPosition): void {
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
    this.onPoint(this.coords, pos, this.nativeSeq || undefined);
  }
}
