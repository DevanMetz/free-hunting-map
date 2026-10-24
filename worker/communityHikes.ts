import { decodeHike, HIKE_REPORT_THRESHOLD, validHikeId } from '../src/community/hike';
import { bbox, tiles, simplify } from '../src/community/geometry';
import { authorized, edgeCache, purge } from './community';
import { moderationSelector, sha256 } from './communityShared';
import { pathLength } from '../src/map/geo';
import { ApiError } from './sync';
export const hikeTilePath = (key: string) => `/tiles/community-hikes/12/${key}.geojson`;
export interface HikeRow { id:string; geometry:string; month:string; name:string; type:string|null; distance:number; reports:number; override:string|null }
export function hikeFeature(r:HikeRow) { return {type:'Feature',id:r.id,geometry:{type:'LineString',coordinates:JSON.parse(r.geometry)},properties:{id:r.id,month:r.month,name:r.name,type:r.type,distance:r.distance}}; }
const ok = () => Response.json({accepted:true},{headers:{'Cache-Control':'no-store'}});
function credentials(raw:unknown) {
  const r=raw as {id?:unknown;secret?:unknown}|null;
  if(!r || !validHikeId(r.id) || !validHikeId(r.secret)) throw new ApiError(400,'Invalid hike credentials');
  return {id:r.id,secret:r.secret};
}
export async function shareHike(request:Request,db:D1Database,raw:unknown) {
  const {id,secret}=credentials(raw);
  if(Object.keys(raw as object).some(k=>!['id','secret','hike'].includes(k)))throw new ApiError(400,'Invalid hike');
  let hike;try{hike=decodeHike((raw as {hike:unknown}).hike);}catch{throw new ApiError(400,'Invalid hike');}
  hike.coordinates=simplify(hike.coordinates,2.5);
  hike.distance=Math.round(pathLength(hike.coordinates));
  if(hike.distance<=200)throw new ApiError(400,'Hike too short');
  // Geometry-only duplicate hash: metadata edits cannot bypass duplicate protection.
  const content=await sha256(JSON.stringify(hike.coordinates)),secretHash=await sha256(secret);
  const existing=await db.prepare('SELECT id FROM community_hikes WHERE id=? OR content_hash=?').bind(id,content).first();
  if(existing)throw new ApiError(409,'Duplicate hike');
  const bounds=bbox(hike.coordinates), keys=tiles(bounds);
  try {
    await db.batch([
      db.prepare('INSERT INTO community_hikes(id,secret_hash,content_hash,geometry,month,name,type,distance,west,south,east,north) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,secretHash,content,JSON.stringify(hike.coordinates),hike.month,hike.name,hike.type,hike.distance,...bounds),
      ...keys.map(key=>db.prepare('INSERT INTO community_hike_tiles(tile,hike_id) VALUES(?,?)').bind(key,id)),
    ]);
  } catch(error) {
    if(await db.prepare('SELECT id FROM community_hikes WHERE id=? OR content_hash=?').bind(id,content).first())throw new ApiError(409,'Duplicate hike');
    throw error;
  }
  await purge(new URL(request.url).origin,keys,hikeTilePath);
  return Response.json({accepted:true},{status:201,headers:{'Cache-Control':'no-store'}});
}
export async function unshareHike(request:Request,db:D1Database,raw:unknown) {
  const {id,secret}=credentials(raw), hash=await sha256(secret);
  if(Object.keys(raw as object).some(k=>!['id','secret'].includes(k)))throw new ApiError(400,'Invalid withdrawal');
  // A withdrawal arriving before its upload creates a tombstone, preventing delayed resurrection.
  const result=await db.batch([
    db.prepare('INSERT OR IGNORE INTO community_hikes(id,secret_hash,withdrawn) VALUES(?,?,1)').bind(id,hash),
    db.prepare('SELECT secret_hash FROM community_hikes WHERE id=?').bind(id),
    db.prepare('SELECT tile FROM community_hike_tiles WHERE hike_id=? AND EXISTS(SELECT 1 FROM community_hikes WHERE id=? AND secret_hash=?)').bind(id,id,hash),
    db.prepare('DELETE FROM community_hike_tiles WHERE hike_id=? AND EXISTS(SELECT 1 FROM community_hikes WHERE id=? AND secret_hash=?)').bind(id,id,hash),
    db.prepare('UPDATE community_hikes SET withdrawn=1,content_hash=NULL,geometry=NULL,month=NULL,name=NULL,type=NULL,distance=NULL,west=NULL,south=NULL,east=NULL,north=NULL WHERE id=? AND secret_hash=?').bind(id,hash),
  ]);
  if((result[1]!.results[0] as {secret_hash:string}).secret_hash!==hash)throw new ApiError(403,'Forbidden');
  await purge(new URL(request.url).origin,(result[2]!.results as {tile:string}[]).map(r=>r.tile),hikeTilePath);
  return ok();
}
export async function reportHike(request:Request,db:D1Database,raw:unknown,rate:(key:string,limit:number)=>Promise<void>) {
  const r=raw as {id:unknown;token:unknown}|null;
  if(!r || !validHikeId(r.id) || !validHikeId(r.token) || Object.keys(r).some(k=>!['id','token'].includes(k)))throw new ApiError(400,'Invalid report');
  const device=await sha256(r.token);await rate(`hike-device:${device}`,30);
  const at=new Date().toISOString();
  const result=await db.batch([
    db.prepare('INSERT OR IGNORE INTO community_hike_reports(hike_id,device_hash,at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM community_hikes WHERE id=? AND withdrawn=0 AND deleted=0)').bind(r.id,device,at,r.id),
    db.prepare('INSERT INTO community_hike_report_log(hike_id,device_hash,at) SELECT ?,?,? WHERE changes()>0').bind(r.id,device,at),
    db.prepare('UPDATE community_hikes SET reports=(SELECT COUNT(*) FROM community_hike_reports WHERE hike_id=?) WHERE id=?').bind(r.id,r.id),
    db.prepare('SELECT tile FROM community_hike_tiles WHERE hike_id=?').bind(r.id),
    db.prepare('SELECT id FROM community_hikes WHERE id=? AND withdrawn=0 AND deleted=0').bind(r.id),
  ]);
  if(!result[4]!.results.length)throw new ApiError(404,'Hike not found');
  await purge(new URL(request.url).origin,(result[3]!.results as {tile:string}[]).map(r=>r.tile),hikeTilePath);
  return ok();
}
export async function moderateHikes(request:Request,db:D1Database,raw:unknown,secret:string|undefined,action:'delete'|'override') {
  if(!await authorized(request,secret))throw new ApiError(403,'Forbidden');
  const {query,values}=moderationSelector(raw);
  const r=raw as {id?:unknown;override?:unknown};
  if(action==='override' && (!validHikeId(r.id) || !['show','hide',null].includes(r.override as string|null) || Object.keys(r).some(k=>!['id','override'].includes(k))))throw new ApiError(400,'Invalid override');
  const result=await db.batch([
    db.prepare(`SELECT DISTINCT tile FROM community_hike_tiles WHERE hike_id IN (SELECT id FROM community_hikes WHERE ${query})`).bind(...values),
    action==='delete'
      ? db.prepare(`UPDATE community_hikes SET deleted=1 WHERE ${query}`).bind(...values)
      : db.prepare('UPDATE community_hikes SET override=? WHERE id=? AND withdrawn=0 AND deleted=0').bind(r.override,r.id),
  ]);
  await purge(new URL(request.url).origin,(result[0]!.results as {tile:string}[]).map(r=>r.tile),hikeTilePath);
  return ok();
}
export async function hikesTile(request:Request,db:D1Database) {
  const url=new URL(request.url),m=/^\/tiles\/community-hikes\/12\/(\d+)\/(\d+)\.geojson$/.exec(url.pathname);
  if(request.method!=='GET'||!m||+m[1]!>4095||+m[2]!>4095)return new Response(null,{status:404});
  const key=new Request(url.origin+hikeTilePath(`${+m[1]!}/${+m[2]!}`)),cache=edgeCache();
  const cached=await cache?.match(key);if(cached)return cached;
  const rows=await db.prepare("SELECT h.* FROM community_hikes h JOIN community_hike_tiles t ON t.hike_id=h.id WHERE t.tile=? AND h.withdrawn=0 AND h.deleted=0 AND (h.override='show' OR (h.override IS NULL AND h.reports<?))").bind(`${+m[1]!}/${+m[2]!}`,HIKE_REPORT_THRESHOLD).all<HikeRow>();
  const response=Response.json({type:'FeatureCollection',features:rows.results.map(hikeFeature)},{headers:{'Cache-Control':'public, max-age=300','Content-Type':'application/geo+json; charset=utf-8'}});
  try{await cache?.put(key,response.clone());}catch{/* cache failures cannot break reads */}
  return response;
}
