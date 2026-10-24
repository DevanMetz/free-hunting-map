import { validateVote } from '../src/community/vote';
import { authorized, purge } from './community';
import { ApiError } from './sync';
export async function voteCommunity(request: Request, db: D1Database, raw: unknown, rate: (key:string,limit:number)=>Promise<void>) {
  let v; try { v=validateVote(raw); } catch { throw new ApiError(400,'Invalid vote'); }
  const device=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v.token))),n=>n.toString(16).padStart(2,'0')).join('');
  await rate(`vote-device:${device}`,30);
  const at=new Date().toISOString();
  const result=await db.batch([
    db.prepare('INSERT INTO community_votes(line_id,device_hash,vote,type,at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM community_lines WHERE id=?) ON CONFLICT(line_id,device_hash) DO UPDATE SET vote=excluded.vote,type=excluded.type,at=excluded.at').bind(v.id,device,v.vote,v.type,at,v.id),
    db.prepare('INSERT INTO community_vote_log(line_id,device_hash,vote,type,at) SELECT line_id,device_hash,vote,type,at FROM community_votes WHERE line_id=? AND device_hash=? AND at=?').bind(v.id,device,at),
    db.prepare("UPDATE community_lines SET real_votes=(SELECT COUNT(*) FROM community_votes WHERE line_id=? AND vote='real'),not_votes=(SELECT COUNT(*) FROM community_votes WHERE line_id=? AND vote='not') WHERE id=?").bind(v.id,v.id,v.id),
    db.prepare('SELECT tile FROM community_tiles WHERE line_id=?').bind(v.id),
  ]);
  if(!result[0]!.meta.changes)throw new ApiError(404,'Trail not found');
  await purge(new URL(request.url).origin,(result[3]!.results as {tile:string}[]).map(r=>r.tile));
  return Response.json({accepted:true},{headers:{'Cache-Control':'no-store'}});
}
export async function overrideCommunity(request:Request,db:D1Database,raw:unknown,secret?:string){
  if(!await authorized(request,secret))throw new ApiError(403,'Forbidden');
  const r=raw as {id?:unknown;override?:unknown}|null;
  if(!r||typeof r.id!=='string'||!/^[\w-]{1,64}$/.test(r.id)||!['show','hide',null].includes(r.override as string|null)||Object.keys(r).some(k=>!['id','override'].includes(k)))throw new ApiError(400,'Invalid override');
  const result=await db.batch([db.prepare('UPDATE community_lines SET override=? WHERE id=?').bind(r.override,r.id),db.prepare('SELECT tile FROM community_tiles WHERE line_id=?').bind(r.id)]);
  if(!result[0]!.meta.changes)throw new ApiError(404,'Trail not found');
  await purge(new URL(request.url).origin,(result[1]!.results as {tile:string}[]).map(r=>r.tile));
  return Response.json({accepted:true},{headers:{'Cache-Control':'no-store'}});
}
