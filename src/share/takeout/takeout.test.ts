// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coordinatesFromUrl } from './coordinates';
import { parseCsv } from './csv';
import { parseTakeoutText, parseTakeoutZip } from './parse';
import { dedupePlaces, importTakeout } from './import';
import { Repo } from '../../storage/repo';
import type { Waypoint } from '../../types';
import { fromGeoJSON, toGeoJSON } from '../geojson';
import { fromGpx, toGpx } from '../gpx';
import { fromCompact, toCompact } from '../compact';
import { sanitizeRecord } from '../../sync/records';
const fixture = (name: string) => readFileSync(`tests/fixtures/takeout/${name}`);
const csv = fixture('Field trips.csv').toString();
const zip = () => parseTakeoutZip(new Uint8Array(fixture('takeout-fixture.zip')));

describe('Google Takeout', () => {
  it('extracts every coordinate URL pattern and rejects identifiers', () => {
    const rows = parseCsv(csv).slice(1);
    rows.forEach((row, i) => {
      expect(coordinatesFromUrl(row[2]!)).toEqual(i === 0 ? [-91.123457,41.123457] : i < 9 ? [-91-i,41+i] : null);
    });
    expect(coordinatesFromUrl('https://maps.google.com/?q=91,1')).toBeNull();
    expect(coordinatesFromUrl('https://maps.google.com/?q=1,181')).toBeNull();
    expect(coordinatesFromUrl('https://maps.google.com/?q=1,2garbage')).toBeNull();
  });
  it('parses BOM, CRLF, quoted commas, newlines, escaped quotes and blank rows', () => {
    expect(parseCsv(csv)).toHaveLength(13);
    expect(parseCsv(csv)[1]![1]).toBe('First line\nSecond "line"');
    expect(parseCsv('a,b\n"x,y",z')).toEqual([['a','b'],['x,y','z']]);
    expect(() => parseCsv('a\n"broken')).toThrow();
    const result = parseTakeoutText('Field trips.csv', csv)!;
    expect(result.places).toHaveLength(9);
    expect(result.skipped).toBe(3);
    expect(result.places[0]!.note).toContain('Field trips');
  });
  it('reads saved JSON geometry, location coordinates, legacy URLs and labels', () => {
    const saved = parseTakeoutText('Saved Places.json', fixture('Saved Places.json').toString())!;
    expect(saved.places.map((p) => p.coord)).toEqual([[-100,40],[-101,41],[-102,42]]);
    expect(saved.places[0]!.note).toBe('Morning\nPrairie Road\nSaved places');
    expect(saved.places[2]!.name).toBe('Lake Road');
    expect(saved.skipped).toBe(1);
    const labeled = parseTakeoutText('Labeled places.json', fixture('Labeled places.json').toString())!;
    expect(labeled.places[0]!.note).toBe('Forest Road\nLabeled');
    expect(parseTakeoutText('export.json', JSON.stringify(toGeoJSON([])))).toBeNull();
  });
  it('filters unrelated ZIP entries and combines products', () => {
    expect(zip().places).toHaveLength(13);
    expect(zip().skipped).toBe(4);
  });
  it('dedupes URL or normalized title within five meters, excluding tombstones', () => {
    const a = zip().places[0]!;
    expect(dedupePlaces([a,a], []).duplicates).toBe(1);
    expect(dedupePlaces([a,{...a,name:'different',coord:[0,0]}], []).duplicates).toBe(1);
    expect(dedupePlaces([a,{...a,sourceUrl:undefined,name:'  PLACE   1 ',coord:[a.coord[0],a.coord[1]+0.00002]}], []).duplicates).toBe(1);
    expect(dedupePlaces([a,{...a,sourceUrl:undefined,coord:[0,0]}], []).duplicates).toBe(0);
    expect(dedupePlaces([a], [{...a,kind:'waypoint',deleted:true} as Waypoint]).duplicates).toBe(0);
  });
  it('imports through Repo with local timestamps, outbox and lossless sharing/sync', async () => {
    const repo = await Repo.open(`takeout-${crypto.randomUUID()}`);
    expect(await importTakeout(repo,zip(),'fixture')).toEqual({imported:13,duplicates:0,skipped:4});
    const items = await repo.list();
    expect(items).toHaveLength(13);
    expect(items.find((i) => i.name === 'Place 9')).toHaveProperty('sourceUrl', 'https://www.google.com/maps/place/Encoded/data=!3d49!4d-99');
    expect(await repo.pending()).toHaveLength(13);
    expect(items.every((i) => i.updatedAt > 0 && i.deviceId === repo.deviceId)).toBe(true);
    const item = items.find((i) => i.kind === 'waypoint' && i.sourceUrl)!;
    expect(fromGeoJSON(toGeoJSON([item]))).toEqual([item]);
    expect(parseTakeoutText('Saved Places.json',JSON.stringify(toGeoJSON([item])))).toBeNull();
    expect(fromGpx(toGpx([item]))).toEqual([item]);
    expect(fromCompact(toCompact(item))).toEqual(item);
    expect(sanitizeRecord(item)).toEqual(item);
    expect(await importTakeout(repo,zip(),'again')).toEqual({imported:0,duplicates:13,skipped:4});
    await repo.remove(item.id);
    expect((await importTakeout(repo,zip(),'restore')).imported).toBe(1);
    expect(await repo.list()).toHaveLength(13);
  });
});
