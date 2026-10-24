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

test('account deletion retains local data, clears binding/cursor and stays signed out', async () => {
  const repo = await Repo.open(crypto.randomUUID());
  const marker = await repo.create<Waypoint>({kind:'waypoint',coord:[0,0],name:'Keep me',note:'',icon:'pin'});
  await repo.bindSyncAccount('deleted-user');
  await repo.setMeta('cloud.cursor', 123);
  let deleted = false;
  const paths: string[] = [];
  const engine = new CloudSync(repo, async input => {
    const path = String(input); paths.push(path);
    if (path.endsWith('account/delete')) { deleted = true; return Response.json({user:null}); }
    if (path.endsWith('config')) return Response.json({googleClientId:'test'});
    return Response.json({user:deleted ? null : {id:'deleted-user'}});
  }, () => true);
  engine.user = {id:'deleted-user'};
  await engine.deleteAccount();
  expect(engine.user).toBeNull(); expect(engine.state).toBe('signed-out');
  expect(await repo.get(marker.id)).toEqual(marker);
  expect(await repo.getMeta('cloud.owner')).toBeUndefined();
  expect(await repo.getMeta('cloud.cursor')).toBeUndefined();
  await engine.retry();
  expect(paths).not.toContain('/api/sync');
  await repo.bindSyncAccount('new-user');
  expect(await repo.getMeta('cloud.owner')).toBe('new-user');
  expect((await repo.pending()).map(e=>e.id)).toContain(marker.id);
});

test('failed or offline deletion preserves ownership and local data', async () => {
 const repo = await Repo.open(crypto.randomUUID()); await repo.bindSyncAccount('owner');
 let online = false;
 const engine = new CloudSync(repo, async () => new Response(null,{status:500}),()=>online);
 engine.user = {id:'owner'};
 await expect(engine.deleteAccount()).rejects.toThrow('Connect');
 online = true;
 await expect(engine.deleteAccount()).rejects.toThrow('500');
 expect(await repo.getMeta('cloud.owner')).toBe('owner');
 expect(engine.state).toBe('error');
});
