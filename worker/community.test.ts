import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import worker,{type Env} from './index';
import { encode } from '../src/community/codec';
import { tileXY,type Scan } from '../src/community/geometry';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'community',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-13',d1Databases:['DB']}]}));
let env:Env;const origin='http://localhost:8787';
const scan=(offset=0):Scan=>({model:'v4',day:new Date().toISOString().slice(0,10),area:[-90.01,39.99,-89.99,40.01],lines:[{confidence:.8,coordinates:[[-90+offset,40],[-89.999+offset,40]]}]});
const call=(path:string,body?:unknown,extra:Record<string,string>={})=>worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
beforeAll(async()=>{const db=await mf.getD1Database('DB','community');for(const name of ['0001_cloud_sync','0002_usage','0003_community_trails'])await db.exec(readFileSync(`migrations/${name}.sql`,'utf8').replace(/\n/g,' '));env={DB:db as unknown as D1Database,COMMUNITY_ADMIN_TOKEN:'test-secret',ASSETS:{fetch:async()=>new Response('SPA')} as Fetcher};});
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
 expect((await call('/api/community/scans',{padding:'a'.repeat(600001)})).status).toBe(413);
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
 const [x,y]=tileXY(-89.997,40);await call(`/tiles/community/12/${x}/${y}.geojson`);expect(cache.put).toHaveBeenCalled();
 cache.delete.mockClear();await call('/api/community/delete',{bbox:scan().area},{Authorization:'Bearer test-secret'});expect(cache.delete).toHaveBeenCalled();
 }finally{vi.unstubAllGlobals();}
});
