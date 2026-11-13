/** Cache name shared by explicit area downloads and the offline fetch fallback. */
export const OFFLINE_CACHE = 'offline-areas-v1';

const original = globalThis.fetch.bind(globalThis);
let installed = false;

/** Network fetch that does not read the offline fallback, used while downloading. */
export const networkFetch: typeof fetch = (input, init) => original(input, init);

async function match(input: RequestInfo | URL, init?: RequestInit): Promise<Response | undefined> {
  try {
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.method !== 'GET') return undefined;
    return await (await caches.open(OFFLINE_CACHE)).match(request) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serve downloaded tiles when the network is down.
 * The service worker still caches through its own routes when it controls the page.
 * This fallback covers the Capacitor WebView before a controller is attached, and any
 * fetch MapLibre makes that the service worker did not intercept.
 */
export function installOfflineFetch(): void {
  if (installed || !globalThis.caches || !globalThis.fetch) return;
  installed = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return original(input, init);
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!offline) {
      try { return await original(input, init); }
      catch (error) {
        const cached = await match(input, init);
        if (cached) return cached;
        throw error;
      }
    }
    const cached = await match(input, init);
    return cached ?? original(input, init);
  }) as typeof fetch;
}
