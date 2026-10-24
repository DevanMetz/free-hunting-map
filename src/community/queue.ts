import { DETECTION_THRESHOLD, MODEL_VERSION } from '../lidar/model';
import type { Repo } from '../storage/repo';
import type { Candidates } from '../lidar/postprocess';
import { encode } from './codec';
import type { BBox, Point } from './geometry';
import { useFeature } from '../usage';

export async function queueScan(repo: Repo, box: BBox, candidates: Candidates, decision: Promise<boolean>, sources: string[] = []) {
  if (!await decision) return;
  const area = box.map((v, i) => (i < 2 ? Math.floor(v * 100) : Math.ceil(v * 100)) / 100) as BBox;
  await repo.queueCommunity(encode({
    model: MODEL_VERSION, threshold: DETECTION_THRESHOLD, sources, day: new Date().toISOString().slice(0, 10), area,
    lines: candidates.features.map(f => ({
      coordinates: (f.rawCoordinates ?? f.geometry.coordinates) as Point[], confidence: Math.max(0, Math.min(1, f.properties.calibrated)),
    })),
  }));
}
export class CommunityUploads {
  private running = false;
  private warned = false;
  constructor(private repo: Repo, private fetcher: typeof fetch = fetch, private online = () => navigator.onLine) {}
  async flush() {
    if (this.running || !this.online()) return;
    this.running = true;
    try {
      for (const entry of await this.repo.pendingCommunity()) {
        if (!await this.repo.communitySharing()) return;
        // Another flush/tab may already have acknowledged or discarded this entry.
        if (!(await this.repo.pendingCommunity()).some(e => e.id === entry.id)) continue;
        let response: Response;
        try {
          response = await this.fetcher.call(globalThis, '/api/community/scans', {
            method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.scan),
          });
        } catch (error) {
          if (!this.warned) { this.warned = true; console.warn('Community scan upload failed; will retry.', error); }
          return;
        }
        if (response.ok || response.status === 409) {
          await this.repo.ackCommunity(entry.id);
          useFeature('community_trail_upload', 'ok');
        } else if ([400, 413, 415].includes(response.status)) {
          await this.repo.ackCommunity(entry.id);
          useFeature('community_trail_upload', 'fail');
        } else return;
      }
    } finally { this.running = false; }
  }
}
export function startCommunityUploads(repo: Repo) {
  const uploader = new CommunityUploads(repo);
  const flush = () => { void uploader.flush().catch(() => {}); };
  repo.addEventListener('community', flush);
  window.addEventListener('online', flush);
  window.setInterval(flush, 60_000);
  flush();
  return uploader;
}
