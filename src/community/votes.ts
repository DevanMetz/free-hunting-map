import type { Repo } from '../storage/repo';
import type { Vote } from './vote';
import { useFeature } from '../usage';
interface LocalVote extends Vote { revision: string; pending: boolean }
export class CommunityVotes extends EventTarget {
  private votes: Record<string,LocalVote> = {};
  private running = false;
  private warned = false;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private repo:Repo,private fetcher:typeof fetch=fetch){super();}
  async load(){this.votes=await this.repo.getMeta<Record<string,LocalVote>>('community.votes')??{};this.dispatchEvent(new Event('change'));}
  get(id:string):Vote {return this.votes[id]??{id,vote:null,type:null};}
  hiddenIds(){return Object.values(this.votes).filter(v=>v.vote==='not').map(v=>v.id);}
  async set(vote:Vote){
    const write=this.writes.then(async()=>{
      const next={...this.votes,[vote.id]:{...vote,revision:crypto.randomUUID(),pending:true}};
      await this.repo.setMeta('community.votes',next);
      this.votes=next;this.dispatchEvent(new Event('change'));
    });
    this.writes=write.catch(()=>{});await write;
    void this.flush();
  }
  async flush(){
    if(this.running)return;this.running=true;
    try{
      await this.writes;
      const token=await this.repo.communityVoteToken();
      for(const entry of Object.values(this.votes).filter(v=>v.pending)){
        let response:Response;
        try{response=await this.fetcher.call(globalThis, '/api/community/vote',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.id,vote:entry.vote,type:entry.type,token})});}catch(error){if(!this.warned){this.warned=true;console.warn('Community vote upload failed; will retry.',error);}return;}
        useFeature('trail_vote',response.ok?'ok':'fail');
        if(!response.ok && response.status!==404)return;
        // Serialize acknowledgments with edits; an in-flight vote never clears a newer edit.
        const ack=this.writes.then(async()=>{
          if(this.votes[entry.id]?.revision!==entry.revision)return;
          const next={...this.votes,[entry.id]:{...entry,pending:false}};
          await this.repo.setMeta('community.votes',next);this.votes=next;
        });this.writes=ack.catch(()=>{});await ack;
      }
    }catch{/* IndexedDB/network may be temporarily unavailable; retain pending votes. */}
    finally{this.running=false;}
  }
}
export let communityVotes:CommunityVotes|undefined;
export async function startCommunityVotes(repo:Repo){
  communityVotes=new CommunityVotes(repo);await communityVotes.load();
  const flush=()=>{void communityVotes?.flush();};
  window.addEventListener('online',flush);window.setInterval(flush,60_000);
  return flush;
}
