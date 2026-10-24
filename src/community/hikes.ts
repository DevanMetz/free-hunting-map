import type { Repo } from '../storage/repo';
import { canonicalJson } from '../sync/merge';
import { useFeature } from '../usage';
/** Desired public state syncs; delivery acknowledgments stay on each device. Replays are idempotent. */
export class CommunityHikes {
  private running=false;
  constructor(private repo:Repo,private fetcher:typeof fetch=fetch,private online=()=>navigator.onLine) {}
  async flush() {
    if(this.running||!this.online())return;
    this.running=true;
    try {
      for(const r of (await this.repo.hikeShares()).sort((a,b)=>Number(a.shared)-Number(b.shared))) {
        const key=`hike.delivered:${r.id}`,revision=canonicalJson(r);
        if(await this.repo.getMeta(key)===revision)continue;
        let response:Response;
        try { response=await this.fetcher.call(globalThis,`/api/community/hikes/${r.shared&&!r.deleted?'share':'unshare'}`,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:r.shareId,secret:r.secret,...(r.shared&&!r.deleted?{hike:r.hike}:{})})}); } catch {return;}
        if(response.ok||response.status===409) {
          await this.repo.setMeta(key,revision);
          if(r.shared)useFeature('community_hike_share','ok');
          window.dispatchEvent(new Event('community-hikes-change'));
        } else { if(r.shared)useFeature('community_hike_share','fail'); return; }
      }
      const reports=await this.repo.getMeta<Record<string,boolean>>('hike.reports')??{};
      for(const [id,delivered] of Object.entries(reports)) {
        if(delivered)continue;
        let response:Response;
        try { response=await this.fetcher.call(globalThis,'/api/community/hikes/report',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,token:await this.repo.communityVoteToken()})}); }catch{return;}
        useFeature('community_hike_report',response.ok?'ok':'fail');
        if(!response.ok&&response.status!==404)return;
        const latest=await this.repo.getMeta<Record<string,boolean>>('hike.reports')??{};
        await this.repo.setMeta('hike.reports',{...latest,[id]:true});
        window.dispatchEvent(new Event('community-hikes-change'));
      }
    } finally {this.running=false;}
  }
  async reported(id:string){return Object.hasOwn(await this.repo.getMeta('hike.reports')??{},id);}
  async report(id:string) {
    if(await this.reported(id))return;
    const reports=await this.repo.getMeta<Record<string,boolean>>('hike.reports')??{};
    await this.repo.setMeta('hike.reports',{...reports,[id]:false});
    void this.flush();
  }
}
export let communityHikes:CommunityHikes|undefined;
export function startCommunityHikes(repo:Repo) {
  communityHikes=new CommunityHikes(repo);
  const flush=()=>{void communityHikes?.flush().catch(()=>{});};
  repo.addEventListener('change',flush);window.addEventListener('online',flush);window.setInterval(flush,60_000);flush();
}
