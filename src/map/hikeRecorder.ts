import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeFix {
  seq: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  time: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  bearing: number | null;
}

export interface HikeStatus {
  recording: boolean;
  running: boolean;
  startedAt: number;
  trackId: string | null;
}

interface HikeRecorderPlugin {
  prepare(): Promise<void>;
  start(options: { trackId: string }): Promise<void>;
  stop(): Promise<void>;
  clear(): Promise<void>;
  drain(options: { since: number }): Promise<{ json: string }>;
  session(): Promise<Partial<HikeStatus>>;
  addListener(event: 'fix', callback: (fix: NativeFix) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<HikeRecorderPlugin>('HikeRecorder');

export const prepareRecording = (): Promise<void> => plugin.prepare();
export const startRecordingService = (trackId: string): Promise<void> => plugin.start({ trackId });
export const stopRecordingService = (): Promise<void> => plugin.stop();
export const clearRecordingService = (): Promise<void> => plugin.clear();
export const listenForFixes = (callback: (fix: NativeFix) => void): Promise<PluginListenerHandle> => plugin.addListener('fix', callback);

export async function recordingSession(): Promise<HikeStatus> {
  const raw = await plugin.session();
  return {
    recording: raw.recording === true,
    running: raw.running === true,
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0,
    trackId: typeof raw.trackId === 'string' && raw.trackId ? raw.trackId : null,
  };
}

export async function drainFixes(since: number): Promise<NativeFix[]> {
  const { json } = await plugin.drain({ since });
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((fix): fix is NativeFix => !!fix && typeof fix === 'object' && Number.isInteger((fix as NativeFix).seq));
}
