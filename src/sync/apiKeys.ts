import { serviceUrl } from '../serviceUrl';

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

async function send(path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(serviceUrl(path), {
    credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({})) as { error?: unknown };
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  return data as Record<string, unknown>;
}

export async function listKeys(): Promise<ApiKeyInfo[]> {
  const data = await send('/api/keys');
  return Array.isArray(data.keys) ? data.keys as ApiKeyInfo[] : [];
}

export async function createKey(name: string): Promise<ApiKeyInfo & { key: string }> {
  return await send('/api/keys', { name }) as unknown as ApiKeyInfo & { key: string };
}

export async function revokeKey(id: string): Promise<void> {
  await send('/api/keys/revoke', { id });
}
