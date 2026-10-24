import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import worker,{type Env} from './index';
import { encode } from '../src/community/codec';
import { tileXY,type Scan } from '../src/community/geometry';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'community',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-13',d1Databases:['DB'],r2Buckets:['TILES']}]}));
let env:Env;const origin='http://localhost:8787';
const scan=(offset=0):Scan=>({model:'v4',day:new Date().toISOString().slice(0,10),area:[-90.01,39.99,-89.99,40.01],lines:[{confidence:.8,coordinates:[[-90+offset,40],[-89.999+offset,40]]}]});
const call=(path:string,body?:unknown,extra:Record<string,string>={})=>worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
beforeAll(async()=>{const db=await mf.getD1Database('DB','community');for(const name of ['0001_cloud_sync','0002_usage','0003_community_trails'])await db.exec(readFileSync(`migrations/${name}.sql`,'utf8').replace(/\n/g,' '));env={TILES:await mf.getR2Bucket('TILES','community') as unknown as R2Bucket,DB:db as unknown as D1Database,COMMUNITY_ADMIN_TOKEN:'test-secret',ASSETS:{fetch:async()=>new Response('SPA')} as Fetcher};});
afterAll(async()=>mf.dispose());
it('accepts anonymous scans, rejects duplicates, merges confirmations and serves tile GeoJSON',async()=>{
 expect((await call('/api/community/scans',encode(scan()))).status).toBe(201);
 expect((await call('/api/community/scans',encode(scan()))).status).toBe(409);
 const next=scan(.00001);next.lines.push(...next.lines);expect((await call('/api/community/scans',encode(next))).status).toBe(201);
 const [x,y]=tileXY(-89.9995,40);const tile=await call(`/tiles/community/12/${x}/${y}.geojson`);expect(tile.status).toBe(200);expect(tile.headers.get('cache-control')).toContain('max-age=300');
 const data=await tile.json() as {features:{properties:Record<string,unknown>}[]};expect(data.features).toHaveLength(1);expect(data.features[0]!.properties).toMatchObject({scan_count:2,model:'v4'});
 expect(JSON.stringify(data)).not.toMatch(/deviceId|email|user_id|session|ip_address/);
 expect((await call('/tiles/community/11/0/0.geojson')).status).toBe(404);
});
it('validates origins, content type, size, malformed payload and rate limits',async()=>{
 expect((await call('/api/community/scans',{}, {origin:'https://evil.example'})).status).toBe(403);
 expect((await call('/api/community/scans',{}, {'content-type':'text/plain'})).status).toBe(415);
 expect((await call('/api/community/scans',{})).status).toBe(400);
 expect((await call('/api/community/scans',{padding:'a'.repeat(4000001)})).status).toBe(413);
 for(let i=0;i<10;i++)expect((await call('/api/community/scans',{}, {'CF-Connecting-IP':'192.0.2.23'})).status).toBe(400);
 expect((await call('/api/community/scans',{}, {'CF-Connecting-IP':'192.0.2.23'})).status).toBe(429);
});
it('protects moderation and deletes both geometry and tile indexes by id and area',async()=>{
 const row=await env.DB.prepare('SELECT id FROM community_lines LIMIT 1').first<{id:string}>();expect(row).toBeTruthy();
 expect((await call('/api/community/delete',{id:row!.id})).status).toBe(403);
 expect((await call('/api/community/delete',{bbox:scan().area},{Authorization:'Bearer wrong'})).status).toBe(403);
 expect((await call('/api/community/delete',{id:row!.id},{Authorization:'Bearer test-secret'})).status).toBe(200);
 expect((await env.DB.prepare('SELECT * FROM community_tiles').all()).results).toHaveLength(0);
 expect((await call('/api/community/scans',encode(scan(.0001)),{'CF-Connecting-IP':'192.0.2.24'})).status).toBe(201);
 expect((await call('/api/community/delete',{bbox:[-91,39,-89,41]},{Authorization:'Bearer test-secret'})).status).toBe(200);
 expect((await env.DB.prepare('SELECT * FROM community_lines').all()).results).toHaveLength(0);
 expect((await env.DB.prepare('SELECT * FROM community_tiles').all()).results).toHaveLength(0);
 expect((await call('/api/community/delete',{bbox:[0,0,0,0]},{Authorization:'Bearer test-secret'})).status).toBe(400);
});
it('serializes concurrent confirmations without losing scan counts',async()=>{
 const results=await Promise.all([.0002,.00021,.00022].map(offset=>call('/api/community/scans',encode(scan(offset)),{'CF-Connecting-IP':'192.0.2.25'})));
 expect(results.map(r=>r.status)).toEqual([201,201,201]);
 expect(await env.DB.prepare('SELECT scan_count FROM community_lines LIMIT 1').first()).toMatchObject({scan_count:3});
});

it('purges affected edge tile keys after uploads and moderation',async()=>{
 const cache={match:vi.fn().mockResolvedValue(undefined),put:vi.fn().mockResolvedValue(undefined),delete:vi.fn().mockResolvedValue(true)};
 vi.stubGlobal('caches',{default:cache});
 try{
 const headers={'CF-Connecting-IP':'192.0.2.26'};
 expect((await call('/api/community/scans',encode(scan(.003)),headers)).status).toBe(201);
 expect(cache.delete).toHaveBeenCalled();expect(cache.delete.mock.calls[0]![0].url).toContain('/tiles/community/12/');
 expect(cache.delete.mock.calls.every(([request])=>new URL(request.url).origin===origin)).toBe(true);
 const [x,y]=tileXY(-89.997,40);await call(`/tiles/community/12/${x}/${y}.geojson`);expect(cache.put).toHaveBeenCalled();
 cache.delete.mockClear();await call('/api/community/delete',{bbox:scan().area},{Authorization:'Bearer test-secret'});expect(cache.delete).toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});

it('retains raw pre-display geometry and metadata in D1 + R2, including empty scans',async()=>{
 const raw=scan(.004);raw.threshold=.1;raw.sources=['WI_Clark_2018','USGS_3DEP_DEM'];
 raw.lines[0]!.coordinates=[[-89.996,40],[-89.9955,40.000009],[-89.995,40]];
 expect((await call('/api/community/scans',encode(raw),{'CF-Connecting-IP':'192.0.2.30'})).status).toBe(201);
 const row=await env.DB.prepare('SELECT * FROM community_scans WHERE threshold=.1 LIMIT 1').first<{hash:string;raw_key:string;sources:string;threshold:number}>();
 expect(row).toMatchObject({threshold:.1,sources:JSON.stringify(raw.sources)});
 expect(row!.raw_key).toBe(`training/scans/${row!.hash}.json`);
 expect(await (await env.TILES!.get(row!.raw_key))!.json()).toEqual(raw);
 expect(JSON.parse((await env.DB.prepare('SELECT geometry FROM community_lines WHERE west>? LIMIT 1').bind(-89.997).first<{geometry:string}>())!.geometry)).toHaveLength(2);
 const empty=scan(.004);empty.lines=[];expect((await call('/api/community/scans',encode(empty),{'CF-Connecting-IP':'192.0.2.30'})).status).toBe(201);
});
it('changes, clears and logs votes, hides at the margin, honors overrides and purges caches',async()=>{
 const id=(await env.DB.prepare('SELECT id FROM community_lines LIMIT 1').first<{id:string}>())!.id;
 const vote=(token:string,value:string|null,type:string|null=null)=>call('/api/community/vote',{id,token:token.repeat(64),vote:value,type},{'CF-Connecting-IP':'192.0.2.31'});
 const counts=()=>env.DB.prepare('SELECT real_votes,not_votes FROM community_lines WHERE id=?').bind(id).first();
 const visible=async()=>{const t=await env.DB.prepare('SELECT tile FROM community_tiles WHERE line_id=? LIMIT 1').bind(id).first<{tile:string}>();const data=await (await call(`/tiles/community/12/${t!.tile}.geojson`)).json() as {features:{id:string}[]};return data.features.some(f=>f.id===id);};
 expect((await vote('a','real')).status).toBe(200);
 expect((await vote('a','not','ditch / other non-trail')).status).toBe(200);
 expect(await counts()).toEqual({real_votes:0,not_votes:1});expect(await visible()).toBe(true);
 expect((await vote('b','not')).status).toBe(200);expect(await visible()).toBe(false);
 const admin={Authorization:'Bearer test-secret'};
 expect((await call('/api/community/override',{id,override:'show'})).status).toBe(403);
 expect((await call('/api/community/override',{id,override:'other'},admin)).status).toBe(400);
 expect((await call('/api/community/override',{id,override:'show'},admin)).status).toBe(200);expect(await visible()).toBe(true);
 expect((await call('/api/community/override',{id,override:null},admin)).status).toBe(200);expect(await visible()).toBe(false);
 expect((await vote('b',null)).status).toBe(200);expect(await visible()).toBe(true);
 expect((await call('/api/community/override',{id,override:'hide'},admin)).status).toBe(200);expect(await visible()).toBe(false);
 expect((await call('/api/community/override',{id,override:null},admin)).status).toBe(200);
 const log=(await env.DB.prepare('SELECT * FROM community_vote_log WHERE line_id=? ORDER BY seq').bind(id).all()).results;
 expect(log).toHaveLength(4);expect(log.map(v=>v.vote)).toEqual(['real','not','not',null]);
 expect(log[1]).toMatchObject({type:'ditch / other non-trail'});expect(String(log[0]!.device_hash)).toMatch(/^[a-f0-9]{64}$/);expect(log[0]!.device_hash).not.toBe('a'.repeat(64));
 expect((await call('/api/community/vote',{id,token:'a'.repeat(64),vote:'fake',type:null})).status).toBe(400);
 expect((await call('/api/community/vote',{id:'missing',token:'a'.repeat(64),vote:'real',type:null})).status).toBe(404);
});
it('rate limits both device hashes and salted IP hashes',async()=>{
 const id=(await env.DB.prepare('SELECT id FROM community_lines LIMIT 1').first<{id:string}>())!.id;
 for(let i=0;i<30;i++)expect((await call('/api/community/vote',{id,token:'c'.repeat(64),vote:'real',type:null},{'CF-Connecting-IP':`192.0.3.${i}`})).status).toBe(200);
 expect((await call('/api/community/vote',{id,token:'c'.repeat(64),vote:'real',type:null},{'CF-Connecting-IP':'192.0.3.31'})).status).toBe(429);
 for(let i=0;i<60;i++)expect((await call('/api/community/vote',{id,token:i.toString(16).padStart(64,'0'),vote:'real',type:null},{'CF-Connecting-IP':'192.0.4.1'})).status).toBe(200);
 expect((await call('/api/community/vote',{id,token:'d'.repeat(64),vote:'real',type:null},{'CF-Connecting-IP':'192.0.4.1'})).status).toBe(429);
});
it('authenticates script-friendly exports and retains training and votes after display deletion',async()=>{
 expect((await call('/api/community/export')).status).toBe(403);
 expect((await call('/api/community/export',undefined,{Authorization:'Bearer wrong'})).status).toBe(403);
 const response=await call('/api/community/export',undefined,{Authorization:'Bearer test-secret'});
 expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('ndjson');
 const data=(await response.text()).trim().split('\n').map(l=>JSON.parse(l));
 const scans=data.filter(f=>f.properties.dataset==='scan_lines'),lines=data.filter(f=>f.properties.dataset==='labeled_lines'),votes=data.filter(f=>f.properties.dataset==='votes');
 expect(scans.length).toBeGreaterThan(0);expect(scans.some(f=>f.geometry?.coordinates.length===3)).toBe(true);
 expect(scans.some(f=>f.properties.empty_scan===true)).toBe(true);
 expect(lines[0].properties).toHaveProperty('real_votes');expect(lines[0].properties).toHaveProperty('majority_types');expect(lines[0].properties).toHaveProperty('hidden');expect(lines[0].properties).toHaveProperty('override');
 expect(votes.length).toBeGreaterThan(0);expect(votes[0].properties).toHaveProperty('device_hash');
 const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM community_scans').first<{n:number}>())!.n;
 const key=(await env.DB.prepare('SELECT raw_key FROM community_scans LIMIT 1').first<{raw_key:string}>())!.raw_key;
 await call('/api/community/delete',{bbox:scan().area},{Authorization:'Bearer test-secret'});
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM community_scans').first<{n:number}>())!.n).toBe(count);
 expect(await env.TILES!.get(key)).toBeTruthy();
 const after=(await (await call('/api/community/export',undefined,{Authorization:'Bearer test-secret'})).text()).trim().split('\n').map(l=>JSON.parse(l));
 expect(after.filter(f=>f.properties.dataset==='scan_lines')).toHaveLength(scans.length);
 expect(after.filter(f=>f.properties.dataset==='votes')).toHaveLength(votes.length);
});

it.each(['throw', 'reject'] as const)('committed writes succeed when cache deletion fails (%s)', async mode => {
 const del=vi.fn((request:Request)=>{
   expect(new URL(request.url).origin).toBe(origin);
   if(mode==='throw')throw new Error('Cache zone mismatch');
   return Promise.reject(new Error('Cache unavailable'));
 });
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.stubGlobal('caches',{default:{delete:del}});
 try {
   const payload=encode(scan(mode==='throw'?.006:.007));
   const headers={'CF-Connecting-IP':mode==='throw'?'192.0.5.1':'192.0.5.2'};
   expect((await call('/api/community/scans',payload,headers)).status).toBe(201);
   expect((await call('/api/community/scans',payload,headers)).status).toBe(409);
   const id=(await env.DB.prepare('SELECT id FROM community_lines ORDER BY west DESC LIMIT 1').first<{id:string}>())!.id;
   expect((await call('/api/community/vote',{id,token:'e'.repeat(64),vote:'real',type:null},headers)).status).toBe(200);
   expect(await env.DB.prepare('SELECT real_votes FROM community_lines WHERE id=?').bind(id).first()).toMatchObject({real_votes:1});
   expect((await call('/api/community/override',{id,override:'show'},{Authorization:'Bearer test-secret'})).status).toBe(200);
   expect(await env.DB.prepare('SELECT override FROM community_lines WHERE id=?').bind(id).first()).toMatchObject({override:'show'});
   expect((await call('/api/community/delete',{id},{Authorization:'Bearer test-secret'})).status).toBe(200);
   expect(await env.DB.prepare('SELECT id FROM community_lines WHERE id=?').bind(id).first()).toBeNull();
   expect(del).toHaveBeenCalled();expect(warn).toHaveBeenCalled();
   expect(del.mock.calls.every(([request])=>new URL(request.url).origin===origin)).toBe(true);
 } finally {vi.unstubAllGlobals();vi.restoreAllMocks();}
});
