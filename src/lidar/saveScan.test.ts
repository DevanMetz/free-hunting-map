import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { Repo } from '../storage/repo';
import { CloudSync } from '../sync/cloud';
import { CommunityUploads } from '../community/queue';
import { saveCompletedScan } from './saveScan';
import type { Candidates } from './postprocess';
vi.mock('../usage', () => ({ useFeature: vi.fn() }));
const box: [number, number, number, number] = [-90.82, 44.51, -90.81, 44.52];
const candidates: Candidates = { type: 'FeatureCollection', features: [{
  type: 'Feature', geometry: { type: 'LineString', coordinates: [[-90.819, 44.519], [-90.818, 44.519]] },
  properties: { rank: 1, score: 1, calibrated: .8, length: 100, status: 'Unverified candidate' },
}] };

it('saves and cloud-syncs completed scans with sharing off, without anonymous uploads', async () => {
  const repo = await Repo.open(crypto.randomUUID());
  await repo.setCommunitySharing(false);
  const run = await saveCompletedScan(repo, box, candidates);
  expect(await repo.listLidarRuns()).toContainEqual(expect.objectContaining({ id: run.id }));
  expect(await repo.allSyncRecords()).toContainEqual(expect.objectContaining({ id: run.id, kind: 'lidar-run' }));
  expect(await repo.pending()).toContainEqual(expect.objectContaining({ id: run.id, item: expect.objectContaining({ kind: 'lidar-run' }) }));
  const uploaded: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith('config')) return Response.json({ googleClientId: 'test' });
    if (String(input).endsWith('me')) return Response.json({ user: { id: 'scan-owner' } });
    expect(String(input)).toBe('/api/sync');
    const body = JSON.parse(String(init!.body));
    uploaded.push(...body.changes);
    return Response.json({ cursor: 1, changes: body.changes, hasMore: false });
  });
  await new CloudSync(repo, fetcher, () => true).retry();
  expect(uploaded).toContainEqual(expect.objectContaining({ id: run.id, kind: 'lidar-run' }));
  expect(await repo.pending()).toEqual([]);
  await new CommunityUploads(repo, fetcher, () => true).flush();
  expect(await repo.pendingCommunity()).toEqual([]);
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/community/scans'))).toBe(false);
});

it.each(['communitySharing', 'queueCommunity'] as const)('saves even when %s fails', async method => {
  const repo = await Repo.open(crypto.randomUUID());
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(repo, method).mockImplementation(() => { throw new Error('storage unavailable'); });
  try {
    const run = await saveCompletedScan(repo, box, candidates);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(await repo.listLidarRuns()).toHaveLength(1);
    expect(await repo.pending()).toContainEqual(expect.objectContaining({ id: run.id }));
  } finally { vi.restoreAllMocks(); }
});
