import { TileArchive } from './tileArchive';

interface Header {
  rootOffset: number; rootLength: number;
  leafOffset: number; leafLength: number;
  tileOffset: number; tileLength: number;
  internalCompression: number; tileCompression: number;
  minzoom: number; maxzoom: number;
}
interface Entry { id: number; run: number; length: number; offset: number }

/** PMTiles v3 cumulative Hilbert ID; arithmetic stays exact through z26. */
export function tileId(z: number, x: number, y: number): number {
  let id = (4 ** z - 1) / 3;
  for (let scale = 2 ** (z - 1); scale >= 1; scale /= 2) {
    const rx = (x & scale) > 0 ? 1 : 0;
    const ry = (y & scale) > 0 ? 1 : 0;
    id += scale * scale * ((3 * rx) ^ ry);
    if (!ry) {
      if (rx) { x = scale - 1 - x; y = scale - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return id;
}

async function decompress(bytes: Uint8Array, compression: number): Promise<Uint8Array> {
  if (compression === 1) return bytes;
  if (compression !== 2) throw new Error('Unsupported PMTiles compression');
  return new Uint8Array(await new Response(new Response(new Uint8Array(bytes).buffer).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

export function decodeDirectory(bytes: Uint8Array): Entry[] {
  let cursor = 0;
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift <= 49; shift += 7) {
      const byte = bytes[cursor++];
      if (byte === undefined) throw new Error('Truncated directory varint');
      value += (byte & 127) * 2 ** shift;
      if (!Number.isSafeInteger(value)) throw new Error('Directory integer overflow');
      if (byte < 128) return value;
    }
    throw new Error('Invalid directory varint');
  };
  const count = varint();
  if (count > bytes.length / 4) throw new Error('Invalid directory count');
  let id = 0;
  const entries = Array.from({ length: count }, () => ({ id: id += varint(), run: 0, length: 0, offset: 0 }));
  for (const entry of entries) entry.run = varint();
  for (const entry of entries) { entry.length = varint(); if (!entry.length) throw new Error('Empty directory entry'); }
  for (let i = 0; i < entries.length; i++) {
    const value = varint();
    const previous = entries[i - 1];
    entries[i]!.offset = value === 0 && previous ? previous.offset + previous.length : value - 1;
    if (entries[i]!.offset < 0) throw new Error('Invalid directory offset');
  }
  return entries;
}

/** Header + bounded LRU directory cache live with the isolate; tiles live in Cache API. */
export class PMTiles {
  private headerPromise?: Promise<Header>;
  private directories = new Map<string, Promise<Entry[]>>();
  constructor(readonly archive: TileArchive, private readonly tileType = 1) {}

  private async header(): Promise<Header> {
    if (!this.headerPromise) this.headerPromise = this.readHeader().catch(error => { this.headerPromise = undefined; throw error; });
    return this.headerPromise;
  }

  private async readHeader(): Promise<Header> {
    const bytes = await this.archive.bytes(0, 127);
    if (new TextDecoder().decode(bytes.subarray(0, 7)) !== 'PMTiles' || bytes[7] !== 3 || bytes[99] !== this.tileType) throw new Error('Unexpected PMTiles v3 archive type');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u64 = (offset: number) => {
      const value = Number(view.getBigUint64(offset, true));
      if (!Number.isSafeInteger(value)) throw new Error('Archive integer overflow');
      return value;
    };
    const header = { rootOffset: u64(8), rootLength: u64(16), leafOffset: u64(40), leafLength: u64(48), tileOffset: u64(56), tileLength: u64(64), internalCompression: bytes[97]!, tileCompression: bytes[98]!, minzoom: bytes[100]!, maxzoom: bytes[101]! };
    for (const [offset, length] of [[header.rootOffset, header.rootLength], [header.leafOffset, header.leafLength], [header.tileOffset, header.tileLength]]) {
      if (offset! + length! > this.archive.manifest.size) throw new Error('Invalid PMTiles section');
    }
    return header;
  }

  private directory(offset: number, length: number, compression: number): Promise<Entry[]> {
    const key = `${offset}:${length}`;
    let directory = this.directories.get(key);
    if (directory) this.directories.delete(key);
    else {
      directory = this.archive.bytes(offset, length).then(bytes => decompress(bytes, compression)).then(decodeDirectory).catch(error => { this.directories.delete(key); throw error; });
    }
    this.directories.set(key, directory);
    if (this.directories.size > 64) this.directories.delete(this.directories.keys().next().value!);
    return directory;
  }

  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const h = await this.header();
    if (z < h.minzoom || z > h.maxzoom) return null;
    const id = tileId(z, x, y);
    let offset = h.rootOffset, length = h.rootLength;
    for (let depth = 0; depth < 4; depth++) {
      const entries = await this.directory(offset, length, h.internalCompression);
      // Last entry at/before the requested ID (including a run or leaf pointer).
      let low = 0, high = entries.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (entries[mid]!.id <= id) low = mid + 1; else high = mid - 1;
      }
      const entry = entries[high];
      if (!entry) return null;
      if (entry.run) {
        if (id >= entry.id + entry.run) return null;
        if (entry.offset + entry.length > h.tileLength) throw new Error('Tile outside data section');
        return decompress(await this.archive.bytes(h.tileOffset + entry.offset, entry.length), h.tileCompression);
      }
      if (entry.offset + entry.length > h.leafLength) throw new Error('Leaf outside directory section');
      offset = h.leafOffset + entry.offset;
      length = entry.length;
    }
    throw new Error('PMTiles directory nesting exceeds limit');
  }
}
