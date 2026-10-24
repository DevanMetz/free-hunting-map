// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { it,expect,vi } from 'vitest';
import type { Track } from '../types';
import { Repo } from '../storage/repo';
import { CommunityHikes } from './hikes';
import { encodeHike } from './hike';
vi.mock('../usage',()=>({useFeature:vi.fn()}));
const fields={trackId:'track-123',shareId:'a'.repeat(64),secret:'b'.repeat(64),shared:true,hike:encodeHike([[-90,40],[-89.99,40]],'2026-10')};
it('durably queues shares and withdrawals offline, independent of scan preference; retries 429/outages and accepts 409',async()=>{
 const name=crypto.randomUUID(),repo=await Repo.open(name);await repo.setCommunitySharing(false);
 await repo.saveHikeShare(fields);
 let online=false;const fetcher=vi.fn<typeof fetch>();
 const uploads=new CommunityHikes(await Repo.open(name),fetcher,()=>online);
 await uploads.flush();expect(fetcher).not.toHaveBeenCalled();online=true;
 fetcher.mockRejectedValueOnce(new Error('offline'));await uploads.flush();
 fetcher.mockResolvedValueOnce(new Response(null,{status:429}));await uploads.flush();
 fetcher.mockResolvedValueOnce(new Response(null,{status:409}));await uploads.flush();
 await uploads.flush();expect(fetcher).toHaveBeenCalledTimes(3);
 await repo.saveHikeShare({...fields,shared:false});
 fetcher.mockRejectedValueOnce(new Error('offline'));await uploads.flush();
 fetcher.mockResolvedValueOnce(new Response(null,{status:200}));await uploads.flush();
 expect(fetcher.mock.calls.at(-1)![0]).toBe('/api/community/hikes/unshare');
 expect(fetcher.mock.calls.at(-1)![1]).toMatchObject({credentials:'omit'});
 expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({id:fields.shareId,secret:fields.secret});
});
it('retains older withdrawals when a recording is shared again and never acknowledges a newer edit',async()=>{
 const repo=await Repo.open(crypto.randomUUID());await repo.saveHikeShare(fields);
 let finish!:(r:Response)=>void;
 const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue(new Response(null,{status:200}));
 const uploads=new CommunityHikes(repo,fetcher,()=>true),flight=uploads.flush();
 await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
 await repo.saveHikeShare({...fields,shared:false});finish(new Response(null,{status:201}));await flight;
 await repo.saveHikeShare({...fields,shareId:'c'.repeat(64)});
 await uploads.flush();expect(fetcher.mock.calls.map(c=>c[0])).toContain('/api/community/hikes/unshare');
 expect(await repo.hikeShares()).toHaveLength(2);
});
it('queues one report per device and reuses the private voting token',async()=>{
 const repo=await Repo.open(crypto.randomUUID()),fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
 const uploads=new CommunityHikes(repo,fetcher,()=>false);
 await uploads.report(fields.shareId);await uploads.report(fields.shareId);expect(await uploads.reported(fields.shareId)).toBe(true);
 const sender=new CommunityHikes(repo,fetcher,()=>true);await sender.flush();
 fetcher.mockResolvedValueOnce(new Response(null,{status:200}));await sender.flush();
 expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({id:fields.shareId,token:await repo.communityVoteToken()});
 expect(JSON.stringify(await repo.allSyncRecords())).not.toContain(await repo.communityVoteToken());
});
it('syncs ownership to another device and withdraws when its recording is deleted',async()=>{
 const repo=await Repo.open(crypto.randomUUID());
 const track=await repo.create<Track>({kind:'track',name:'Private',note:'',recorded:true,coords:[[-90,40],[-89.99,40]]});
 await repo.saveHikeShare({...fields,trackId:track.id});
 const second=await Repo.open(crypto.randomUUID());await second.importSyncRecords(await repo.allSyncRecords());
 expect((await second.hikeShare(track.id))!.secret).toBe(fields.secret);
 await second.remove(track.id);expect((await second.hikeShare(track.id))!.shared).toBe(false);
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(null,{status:200}));await new CommunityHikes(second,fetcher,()=>true).flush();
 expect(fetcher.mock.calls[0]![0]).toBe('/api/community/hikes/unshare');
});
