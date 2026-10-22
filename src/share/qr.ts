import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Item } from '../types';
import { fromCompact, toCompact } from './compact';

/**
 * Multi-part QR transfer format. Each QR holds one chunk:
 *   OHM1:<setId>:<index>:<total>:<data>
 * where the concatenated <data> parts are base64url(deflate(JSON(compact items))).
 */
export const QR_PREFIX = 'OHM1';
export const DEFAULT_CHUNK_SIZE = 600;

export function encodeItemsToChunks(items: Item[], chunkSize = DEFAULT_CHUNK_SIZE): string[] {
  const json = JSON.stringify(items.map(toCompact));
  const data = toBase64Url(deflateSync(strToU8(json), { level: 9 }));
  const total = Math.max(1, Math.ceil(data.length / chunkSize));
  const setId = hashId(data);
  const chunks: string[] = [];
  for (let i = 0; i < total; i++) {
    chunks.push(`${QR_PREFIX}:${setId}:${i + 1}:${total}:${data.slice(i * chunkSize, (i + 1) * chunkSize)}`);
  }
  return chunks;
}

export interface ParsedChunk {
  setId: string;
  index: number;
  total: number;
  data: string;
}

export function parseChunk(text: string): ParsedChunk | null {
  const m = /^OHM1:([0-9a-z]{1,12}):(\d{1,4}):(\d{1,4}):([A-Za-z0-9_-]*)$/.exec(text.trim());
  if (!m) return null;
  const index = Number(m[2]);
  const total = Number(m[3]);
  if (index < 1 || total < 1 || index > total) return null;
  return { setId: m[1]!, index, total, data: m[4]! };
}

export function decodeChunks(chunks: string[]): Item[] {
  const parsed = chunks.map(parseChunk);
  if (parsed.some((p) => !p)) throw new Error('Invalid chunk');
  const ps = parsed as ParsedChunk[];
  const first = ps[0];
  if (!first) throw new Error('No chunks');
  if (ps.some((p) => p.setId !== first.setId || p.total !== first.total)) throw new Error('Mixed sets');
  const byIndex = new Map(ps.map((p) => [p.index, p.data]));
  if (byIndex.size !== first.total) throw new Error('Missing chunks');
  let data = '';
  for (let i = 1; i <= first.total; i++) data += byIndex.get(i)!;
  if (hashId(data) !== first.setId) throw new Error('Checksum mismatch');
  const raw: unknown = JSON.parse(strFromU8(inflateSync(fromBase64Url(data))));
  if (!Array.isArray(raw)) throw new Error('Bad payload');
  return raw.map(fromCompact).filter((i): i is Item => i !== null);
}

export type AssembleResult =
  | { status: 'ignored' }
  | { status: 'progress'; have: number; total: number }
  | { status: 'complete'; items: Item[] }
  | { status: 'error'; message: string };

/** Accumulates scanned chunks in any order; switching to a new set resets. */
export class QrAssembler {
  private setId = '';
  private total = 0;
  private parts = new Map<number, string>();

  add(text: string): AssembleResult {
    const p = parseChunk(text);
    if (!p) return { status: 'ignored' };
    if (p.setId !== this.setId || p.total !== this.total) {
      this.setId = p.setId;
      this.total = p.total;
      this.parts = new Map();
    }
    this.parts.set(p.index, text.trim());
    if (this.parts.size < this.total) return { status: 'progress', have: this.parts.size, total: this.total };
    try {
      return { status: 'complete', items: decodeChunks([...this.parts.values()]) };
    } catch (e) {
      this.parts = new Map();
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  get progress(): { have: number; total: number } {
    return { have: this.parts.size, total: this.total };
  }
}

/** 6-char base36 FNV-1a hash — set id doubling as a checksum. */
function hashId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6);
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
