import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { Repo } from '../storage/repo';
import type { Waypoint } from '../types';
import { CloudSync } from './cloud';

test('offline sign-out persists logout and never resumes syncing on reconnect', async () => {
  const repo = await Repo.open(crypto.randomUUID());
  let online = false;
  const paths: string[] = [];
  const engine = new CloudSync(repo, async input => {
    paths.push(String(input));
    return Response.json({});
  }, () => online);
  await engine.signOut();
  expect(await repo.getMeta('cloud.logout')).toBe(true);
  await engine.retry();
  expect(paths).toEqual([]);
  online = true;
  await engine.retry();
  expect(paths).toEqual(['/api/auth/logout']);
  expect(await repo.getMeta('cloud.logout')).toBe(false);
});

test('ack preserves edits made while a sync request is in flight', async () => {
  const repo = await Repo.open(crypto.randomUUID());
  const marker = await repo.create<Waypoint>({ kind: 'waypoint', coord: [0, 0], name: 'Before', note: '', icon: 'pin' });
  let batches = 0;
  const engine = new CloudSync(repo, async (input, init) => {
    const path = String(input);
    if (path.endsWith('config')) return Response.json({ googleClientId: 'test' });
    if (path.endsWith('me')) return Response.json({ user: { id: 'account-a' } });
    const body = JSON.parse(init!.body as string);
    if (batches++ === 0) await repo.update(marker, { name: 'During request' });
    return Response.json({ cursor: batches, changes: body.changes, hasMore: false });
  }, () => true);
  await engine.retry();
  expect(engine.state).toBe('synced');
  expect(batches).toBe(2);
  expect((await repo.get(marker.id) as Waypoint).name).toBe('During request');
  expect(await repo.pending()).toEqual([]);
});

test('a different account cannot upload browser data', async () => {
  const repo = await Repo.open(crypto.randomUUID());
  await repo.bindSyncAccount('account-a');
  const calls: string[] = [];
  const engine = new CloudSync(repo, async input => {
    calls.push(String(input));
    return Response.json(String(input).endsWith('config') ? { googleClientId: 'test' } : { user: { id: 'account-b' } });
  }, () => true);
  await engine.retry();
  expect(engine.state).toBe('error');
  expect(calls).toEqual(['/api/config', '/api/me']);
});
