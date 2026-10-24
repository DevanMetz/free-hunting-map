import { moderationSelector, sha256 } from './communityShared';
import { HIDE_MARGIN } from '../src/community/vote';
import { decode } from '../src/community/codec';
import { bbox, mergeScan, tiles, simplify, type CommunityLine } from '../src/community/geometry';
import { ApiError } from './sync';
interface Row { id:string; geometry:string; scan_count:number; model:string; confidence:number; first_seen:string; last_confirmed:string }
export const edgeCache=()=>typeof caches !== 'undefined' && 'default' in caches ? (caches as CacheStorage & {default:Cache}).default : undefined;
const line=(r:Row):CommunityLine=>({...r,coordinates:JSON.parse(r.geometry) as CommunityLine['coordinates']});
export const tilePath=(tile:string)=>`/tiles/community/12/${tile}.geojson`;
export async function purge(origin: string, keys: string[], path = tilePath) {
  // Cache API keys are zone-scoped. Other origins expire via max-age.
  // Invalidation is best effort: a committed write must still report success.
  try {
    const cache = edgeCache();
    if (!cache) return;
    await Promise.all([...new Set(keys)].map(async key => {
      try { await cache.delete(new Request(origin + path(key))); }
      catch (error) { console.warn('Community tile cache purge failed', key, error); }
    }));
  } catch (error) { console.warn('Community tile cache unavailable', error); }
}
export async function uploadCommunity(db:D1Database,raw:unknown,origin:string,bucket?:R2Bucket){
  let scan;try{scan=decode(raw);}catch{throw new ApiError(400,'Invalid community scan');}
  const hash=await sha256(JSON.stringify(scan));
  if (!bucket) throw new ApiError(503,'Training storage unavailable');
  const rawKey = `training/scans/${hash}.json`;
  // Immutable, content-addressed raw scan. An interrupted D1 write can safely retry.
  await bucket.put(rawKey, JSON.stringify(scan), {httpMetadata:{contentType:'application/json'}});
  const display = {...scan, lines:scan.lines.map(l=>({...l,coordinates:simplify(l.coordinates)}))};
  for(let attempt=0;attempt<5;attempt++){
    if(await db.prepare('SELECT hash FROM community_scans WHERE hash=?').bind(hash).first())throw new ApiError(409,'Duplicate scan');
    const revision=(await db.prepare('SELECT version FROM community_revision WHERE id=1').first<{version:number}>())!.version;
    const [w,s,e,n]=scan.area;
    const rows=await db.prepare('SELECT * FROM community_lines WHERE west<=? AND east>=? AND south<=? AND north>=?').bind(e+.0003,w-.0003,n+.0003,s-.0003).all<Row>();
    const changed=mergeScan(display,rows.results.map(line),()=>crypto.randomUUID());
    const guard='(SELECT version FROM community_revision WHERE id=1)=?';
    const statements=[db.prepare(`INSERT INTO community_scans SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(hash,scan.day,scan.model,JSON.stringify(scan.area),scan.lines.length,scan.threshold ?? null,JSON.stringify(scan.sources ?? []),rawKey,revision)];
    const affected:string[]=[];
    for(const l of changed){const b=bbox(l.coordinates);statements.push(db.prepare(`INSERT INTO community_lines (id,geometry,west,south,east,north,scan_count,model,confidence,first_seen,last_confirmed) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET scan_count=excluded.scan_count,model=excluded.model,confidence=excluded.confidence,first_seen=MIN(first_seen,excluded.first_seen),last_confirmed=excluded.last_confirmed`).bind(l.id,JSON.stringify(l.coordinates),...b,l.scan_count,l.model,l.confidence,l.first_seen,l.last_confirmed,revision));
      for(const key of tiles(b)){affected.push(key);statements.push(db.prepare(`INSERT OR IGNORE INTO community_tiles SELECT ?,? WHERE ${guard}`).bind(key,l.id,revision));}
    }
    statements.push(db.prepare('UPDATE community_revision SET version=version+1 WHERE id=1 AND version=?').bind(revision));
    let result;try{result=await db.batch(statements);}catch(error){if(await db.prepare('SELECT hash FROM community_scans WHERE hash=?').bind(hash).first())throw new ApiError(409,'Duplicate scan');throw error;}
    if(result[0]!.meta.changes){await purge(origin,affected);return Response.json({accepted:true},{status:201,headers:{'Cache-Control':'no-store'}});}
  }
  throw new ApiError(503,'Please retry');
}
export async function communityTile(request:Request,db:D1Database):Promise<Response>{
  const url=new URL(request.url), match=/^\/tiles\/community\/12\/(\d+)\/(\d+)\.geojson$/.exec(url.pathname);
  if(request.method!=='GET'||!match||+match[1]!>4095||+match[2]!>4095)return new Response(null,{status:404});
  const key=new Request(url.origin+url.pathname);
  const cache=edgeCache();
  if(cache){const cached=await cache.match(key);if(cached)return cached;}
  const rows=await db.prepare("SELECT l.* FROM community_lines l JOIN community_tiles t ON t.line_id=l.id WHERE t.tile=? AND (l.override='show' OR (l.override IS NULL AND l.not_votes-l.real_votes<?))").bind(`${+match[1]!}/${+match[2]!}`,HIDE_MARGIN).all<Row>();
  const response=Response.json({type:'FeatureCollection',features:rows.results.map(r=>({type:'Feature',id:r.id,geometry:{type:'LineString',coordinates:JSON.parse(r.geometry)},properties:{id:r.id,scan_count:r.scan_count,model:r.model,confidence:r.confidence,first_seen:r.first_seen,last_confirmed:r.last_confirmed}}))},{headers:{'Cache-Control':'public, max-age=300','Content-Type':'application/geo+json; charset=utf-8'}});
  if(cache)await cache.put(key,response.clone());return response;
}
export async function authorized(request:Request,secret?:string){
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
  const [a,b]=await Promise.all([digest(token),digest(secret??'')]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]!^b[i]!;return !!secret&&!!token&&diff===0;
}
export async function deleteCommunity(request:Request,db:D1Database,raw:unknown,secret?:string){
  if(!await authorized(request,secret))throw new ApiError(403,'Forbidden');
  const {query,values}=moderationSelector(raw);
  // One atomic batch also invalidates optimistic upload snapshots.
  const result=await db.batch([
    db.prepare(`SELECT DISTINCT tile FROM community_tiles WHERE line_id IN (SELECT id FROM community_lines WHERE ${query})`).bind(...values),
    db.prepare(`DELETE FROM community_tiles WHERE line_id IN (SELECT id FROM community_lines WHERE ${query})`).bind(...values),
    db.prepare(`DELETE FROM community_lines WHERE ${query}`).bind(...values),
    db.prepare('UPDATE community_revision SET version=version+1 WHERE id=1'),
  ]);
  await purge(new URL(request.url).origin,(result[0]!.results as {tile:string}[]).map(r=>r.tile));
  return Response.json({deleted:result[2]!.meta.changes},{headers:{'Cache-Control':'no-store'}});
}
