import 'fake-indexeddb/auto';
import { it,expect,vi } from 'vitest';
import { Repo } from '../storage/repo';
import { CommunityUploads,queueScan } from './queue';
import { encode } from './codec';
import type { Scan } from './geometry';
vi.mock('../usage',()=>({useFeature:vi.fn()}));
import { useFeature } from '../usage';
const scan:Scan={model:'v4',day:'2026-10-20',area:[-90.01,39.99,-89.99,40.01],lines:[{confidence:.8,coordinates:[[-90,40],[-89.999,40]]}]};
it('defaults to sharing, persists completion decisions and clears pending when disabled',async()=>{
 const repo=await Repo.open(crypto.randomUUID());
 expect(await repo.communitySharing()).toBe(true);await repo.queueCommunity(encode(scan));expect(await repo.pendingCommunity()).toHaveLength(1);
 await repo.setCommunitySharing(false);expect(await repo.pendingCommunity()).toHaveLength(0);await repo.queueCommunity(encode(scan));expect(await repo.pendingCommunity()).toHaveLength(0);
 await repo.setCommunitySharing(true);
 await queueScan(repo,scan.area,{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:scan.lines[0]!.coordinates},properties:{rank:1,score:1,calibrated:.8,length:100,status:'Unverified candidate'}}]},Promise.resolve(false));expect(await repo.pendingCommunity()).toHaveLength(0);
});
it('delivers queued uploads anonymously, acknowledges duplicates, drops rejection and retries outages',async()=>{
 const repo=await Repo.open(crypto.randomUUID());
 const fetcher=vi.fn<typeof fetch>();const uploader=new CommunityUploads(repo,fetcher,()=>true);
 for(const status of [201,409,400,413,415]){await repo.queueCommunity(encode(scan));fetcher.mockResolvedValueOnce(new Response(null,{status}));await uploader.flush();expect(await repo.pendingCommunity()).toHaveLength(0);expect(useFeature).toHaveBeenLastCalledWith('community_trail_upload',status<400||status===409?'ok':'fail');}
 expect(fetcher.mock.calls[0]![1]).toMatchObject({credentials:'omit'});expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual(encode(scan));
 for(const status of [429,503]){await repo.queueCommunity(encode(scan));fetcher.mockResolvedValueOnce(new Response(null,{status}));await uploader.flush();expect((await repo.pendingCommunity()).length).toBeGreaterThan(0);await repo.setCommunitySharing(false);await repo.setCommunitySharing(true);}
 await repo.queueCommunity(encode(scan));fetcher.mockRejectedValueOnce(new Error('offline'));await uploader.flush();expect(await repo.pendingCommunity()).toHaveLength(1);
});
