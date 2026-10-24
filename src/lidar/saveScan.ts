import type { Repo } from '../storage/repo';
import type { Box } from './ept';
import type { Candidates } from './postprocess';
import { queueScan } from '../community/queue';

export async function saveCompletedScan(repo: Repo, box: Box, candidates: Candidates, sources: string[] = []) {
  const run = await repo.saveLidarRun({ box, candidates });
  // Anonymous sharing cannot delay or prevent the user's durable, synced save.
  void (async () => {
    await queueScan(repo, box, candidates, repo.communitySharing(), sources);
  })().catch(error => console.warn('Community scan queue failed', error));
  return run;
}
