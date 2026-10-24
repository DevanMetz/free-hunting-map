/** Fixed-size R2 parts expose one virtual, seekable PMTiles archive. */
export interface TileManifest {
  size: number;
  partSize: number;
  parts: number;
  sha256: string;
  built: string;
  bounds: number[];
}
export class TileArchive {
  constructor(readonly bucket: R2Bucket, readonly manifest: TileManifest, readonly prefix = 'trails/v1/') {}

  stream(offset: number, length: number): ReadableStream<Uint8Array> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.manifest.size) throw new Error('Archive range out of bounds');
    let position = offset, remaining = length;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const { bucket, manifest, prefix } = this;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            if (reader) {
              const result = await reader.read();
              if (!result.done) { controller.enqueue(result.value); return; }
              reader.releaseLock();
              reader = undefined;
            }
            if (!remaining) { controller.close(); return; }
            const part = Math.floor(position / manifest.partSize);
            const start = position % manifest.partSize;
            const count = Math.min(remaining, manifest.partSize - start);
            const object = await bucket.get(`${prefix}part-${String(part).padStart(3, '0')}`, { range: { offset: start, length: count } });
            if (!object || object.size < start + count) throw new Error('Archive part missing or truncated');
            reader = object.body.getReader();
            position += count;
            remaining -= count;
          }
        } catch (error) { controller.error(error); }
      },
      async cancel(reason) { await reader?.cancel(reason); },
    });
  }

  async bytes(offset: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(await new Response(this.stream(offset, length)).arrayBuffer());
    if (bytes.length !== length) throw new Error('Truncated archive range');
    return bytes;
  }
}

/** `version` is a validated path segment such as `v2`; each data build gets a new immutable prefix. */
export async function openTileArchive(bucket: R2Bucket, version = 'v1', name = 'trails'): Promise<TileArchive | null> {
  const prefix = `${name}/${version}/`;
  const object = await bucket.get(`${prefix}manifest.json`);
  if (!object) return null;
  const m = await object.json<TileManifest>();
  if (!Number.isSafeInteger(m.size) || m.size < 127 || !Number.isSafeInteger(m.partSize) || m.partSize <= 0 || m.parts !== Math.ceil(m.size / m.partSize) || !/^[a-f0-9]{64}$/i.test(m.sha256) || !Array.isArray(m.bounds) || m.bounds.length !== 4 || !m.bounds.every(Number.isFinite)) throw new Error('Invalid tile manifest');
  return new TileArchive(bucket, m, prefix);
}
