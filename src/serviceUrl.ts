import { Capacitor } from '@capacitor/core';

/** Bundled native assets use a local origin; hosted services remain on production. */
export function serviceUrl(path: string): string {
  return Capacitor.isNativePlatform() ? `https://freehuntingmap.com${path}` : path;
}
