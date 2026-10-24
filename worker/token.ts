const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let cached: { keys: (JsonWebKey & { kid?: string })[]; until: number } | undefined;
export function resetJwksCache() { cached = undefined; }
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export interface GoogleIdentity { sub: string; email?: string; name?: string; picture?: string }
export async function verifyGoogleToken(token: string, audience: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GoogleIdentity> {
  if (token.length > 16_384) throw new Error('Invalid token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [header64, payload64, signature64] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(decode(header64)));
  const payload = JSON.parse(new TextDecoder().decode(decode(payload64)));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid algorithm');
  if (!cached || cached.until <= now) {
    const response = await fetcher(JWKS_URL);
    if (!response.ok) throw new Error('Keys unavailable');
    const body = await response.json() as { keys: (JsonWebKey & { kid?: string })[] };
    if (!Array.isArray(body.keys)) throw new Error('Invalid keys');
    const age = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 300);
    cached = { keys: body.keys, until: now + Math.min(age, 86_400) * 1000 };
  }
  const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('Unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature64), new TextEncoder().encode(`${header64}.${payload64}`))) throw new Error('Invalid signature');
  const seconds = now / 1000;
  if (payload.aud !== audience || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)
    || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp < seconds - 60
    || typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > seconds + 60 || payload.iat > payload.exp
    || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new Error('Invalid claims');
  return { sub: payload.sub, ...(typeof payload.email === 'string' && payload.email_verified === true ? { email: payload.email.slice(0, 320) } : {}),
    ...(typeof payload.name === 'string' ? { name: payload.name.slice(0, 200) } : {}),
    ...(typeof payload.picture === 'string' && /^https:\/\/[^/]+\.googleusercontent\.com\//.test(payload.picture) ? { picture: payload.picture.slice(0, 2048) } : {}) };
}
