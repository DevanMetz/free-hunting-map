import { describe, expect, it } from 'vitest';
import { rng, trk, wp } from '../test/fixtures';
import type { Item, LngLat } from '../types';
import { fromCompact, toCompact } from './compact';
import { decodeChunks, encodeItemsToChunks, parseChunk, QrAssembler } from './qr';

function bigTrack(points: number): Item {
  const r = rng(7);
  const coords: LngLat[] = [];
  let x = -90.5;
  let y = 44.5;
  for (let i = 0; i < points; i++) {
    x = Math.round((x + (r() - 0.5) * 0.001) * 1e6) / 1e6;
    y = Math.round((y + (r() - 0.5) * 0.001) * 1e6) / 1e6;
    coords.push([x, y]);
  }
  return trk({ coords });
}

describe('compact encoding', () => {
  it('round-trips waypoints and tracks losslessly', () => {
    for (const item of [wp(), wp({ deleted: true, icon: 'truck' }), trk(), trk({ recorded: false })]) {
      expect(fromCompact(JSON.parse(JSON.stringify(toCompact(item))))).toEqual(item);
    }
  });

  it('rejects garbage', () => {
    expect(fromCompact(null)).toBeNull();
    expect(fromCompact(['w', 'short'])).toBeNull();
    expect(fromCompact(['x', 'aaaaaaaa-1', 1, 1, 'd', 0, '', '', 'pin', 0, 0])).toBeNull();
  });
});

describe('QR chunks', () => {
  it('single small payload fits in one chunk and decodes', () => {
    const items = [wp(), trk()];
    const chunks = encodeItemsToChunks(items);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatch(/^OHM1:[0-9a-z]{6}:1:1:/);
    expect(decodeChunks(chunks)).toEqual(items);
  });

  it('splits large payloads into numbered chunks within the size limit', () => {
    const items = [wp(), bigTrack(1500)];
    const chunks = encodeItemsToChunks(items, 500);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      const p = parseChunk(c)!;
      expect(p.index).toBe(i + 1);
      expect(p.total).toBe(chunks.length);
      expect(p.data.length).toBeLessThanOrEqual(500);
    });
    expect(decodeChunks(chunks)).toEqual(items);
  });

  it('assembler accepts chunks in any order with duplicates and noise', () => {
    const items = [wp(), bigTrack(800)];
    const chunks = encodeItemsToChunks(items, 300);
    const order = [...chunks].reverse();
    const asm = new QrAssembler();
    expect(asm.add('https://example.com/not-ours').status).toBe('ignored');
    let last = asm.add(order[0]!);
    expect(last).toEqual({ status: 'progress', have: 1, total: chunks.length });
    expect(asm.add(order[0]!).status).toBe('progress'); // duplicate
    for (const c of order.slice(1)) last = asm.add(c);
    expect(last).toEqual({ status: 'complete', items });
  });

  it('switching to a different set resets progress', () => {
    const a = encodeItemsToChunks([bigTrack(600)], 300);
    const b = encodeItemsToChunks([wp()], 300);
    const asm = new QrAssembler();
    asm.add(a[0]!);
    const r = asm.add(b[0]!);
    expect(r.status).toBe('complete');
  });

  it('detects missing, mixed or corrupted chunks', () => {
    const chunks = encodeItemsToChunks([wp(), bigTrack(600)], 300);
    expect(() => decodeChunks(chunks.slice(1))).toThrow();
    const other = encodeItemsToChunks([trk()], 300);
    expect(() => decodeChunks([...chunks.slice(0, -1), other[0]!])).toThrow();
    const tampered = chunks.map((c, i) => (i === 0 ? c.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) : c));
    expect(() => decodeChunks(tampered)).toThrow();
  });

  it('parseChunk rejects malformed headers', () => {
    expect(parseChunk('OHM1:abc123:0:1:xx')).toBeNull();
    expect(parseChunk('OHM1:abc123:3:2:xx')).toBeNull();
    expect(parseChunk('OHM2:abc123:1:1:xx')).toBeNull();
  });
});

describe('QR end-to-end (qrcode → jsQR → assembler)', () => {
  it('scans rendered multi-part codes back into the original items', async () => {
    const { default: QRCode } = await import('qrcode');
    const { default: jsQR } = await import('jsqr');
    const items = [wp(), bigTrack(400)];
    const chunks = encodeItemsToChunks(items);
    expect(chunks.length).toBeGreaterThan(1);
    const asm = new QrAssembler();
    let result;
    for (const chunk of chunks) {
      const qr = QRCode.create(chunk, { errorCorrectionLevel: 'L' });
      const scale = 4;
      const margin = 4;
      const n = qr.modules.size;
      const size = (n + margin * 2) * scale;
      const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!qr.modules.get(y, x)) continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const i = (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) * 4;
              rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
            }
          }
        }
      }
      const decoded = jsQR(rgba, size, size);
      expect(decoded?.data).toBe(chunk);
      result = asm.add(decoded!.data);
    }
    expect(result).toEqual({ status: 'complete', items });
  });
});
