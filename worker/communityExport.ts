import { hikeFeature, type HikeRow } from './communityHikes';
import { HIKE_REPORT_THRESHOLD } from '../src/community/hike';
import { authorized } from './community';
import { hidden } from '../src/community/vote';
import type { Scan } from '../src/community/geometry';
import { ApiError } from './sync';
/** Paged D1 reads and one R2 scan at a time; no full-dataset buffering. */
export async function exportCommunity(request:Request,db:D1Database,bucket:R2Bucket|undefined,secret?:string){
  if(!await authorized(request,secret))throw new ApiError(403,'Forbidden');
  if(!bucket)throw new ApiError(503,'Training storage unavailable');
  async function* features(){
    let cursor='';
    while(true){
      const rows=await db.prepare('SELECT hash,raw_key FROM community_scans WHERE hash>? ORDER BY hash LIMIT 100').bind(cursor).all<{hash:string;raw_key:string}>();
      if(!rows.results.length)break;
      for(const row of rows.results){
        const object=await bucket!.get(row.raw_key);if(!object)throw new Error(`Missing training scan ${row.hash}`);
        const scan=await object.json<Scan>();
        if (!scan.lines.length) yield {type:'Feature',id:row.hash,geometry:null,properties:{dataset:'scan_lines',scan_id:row.hash,empty_scan:true,line_count:0,model:scan.model,day:scan.day,area:scan.area,threshold:scan.threshold??null,sources:scan.sources??[]}};
        for(let i=0;i<scan.lines.length;i++){const l=scan.lines[i]!;yield {type:'Feature',id:`${row.hash}:${i}`,geometry:{type:'LineString',coordinates:l.coordinates},properties:{dataset:'scan_lines',scan_id:row.hash,line_index:i,model:scan.model,day:scan.day,area:scan.area,threshold:scan.threshold??null,sources:scan.sources??[],confidence:l.confidence}};}
        cursor=row.hash;
      }
    }
    cursor='';
    while(true){
      const rows=await db.prepare('SELECT * FROM community_lines WHERE id>? ORDER BY id LIMIT 100').bind(cursor).all<{id:string;geometry:string;real_votes:number;not_votes:number;override:string|null}>();
      if(!rows.results.length)break;
      for(const row of rows.results){
        const types=await db.prepare('SELECT type,COUNT(*) AS count FROM community_votes WHERE line_id=? AND vote IS NOT NULL AND type IS NOT NULL GROUP BY type ORDER BY count DESC,type').bind(row.id).all<{type:string;count:number}>();
        const {geometry,...metadata}=row;
        yield {type:'Feature',id:row.id,geometry:{type:'LineString',coordinates:JSON.parse(geometry)},properties:{...metadata,dataset:'labeled_lines',hidden:hidden(row.real_votes,row.not_votes,row.override),types:types.results,majority_types:types.results.filter(t=>t.count===types.results[0]?.count).map(t=>t.type)}};
        cursor=row.id;
      }
    }
    cursor='';
    while(true){
      const rows=await db.prepare('SELECT * FROM community_hikes WHERE id>? AND withdrawn=0 AND deleted=0 ORDER BY id LIMIT 100').bind(cursor).all<HikeRow>();
      if(!rows.results.length)break;
      for(const row of rows.results){
        const f=hikeFeature(row);
        yield {...f,properties:{...f.properties,dataset:'hikes',source:'gps_track',label:'positive',hidden:row.override==='hide'||(row.override!=='show'&&row.reports>=HIKE_REPORT_THRESHOLD),reports:row.reports,override:row.override}};
        cursor=row.id;
      }
    }
    let seq=0;
    while(true){
      const rows=await db.prepare('SELECT * FROM community_vote_log WHERE seq>? ORDER BY seq LIMIT 100').bind(seq).all<{seq:number}>();
      if(!rows.results.length)break;
      for(const row of rows.results){yield {type:'Feature',geometry:null,properties:{...row,dataset:'votes'}};seq=row.seq;}
    }
  }
  const iterator=features(),encoder=new TextEncoder();
  return new Response(new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(JSON.stringify(next.value)+'\n'));}catch(error){controller.error(error);}},async cancel(){await iterator.return();}}),{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','Content-Disposition':'attachment; filename="community.ndjson"'}});
}
