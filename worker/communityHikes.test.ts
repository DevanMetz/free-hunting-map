import { beforeAll,beforeEach,afterEach,afterAll,it,expect,vi } from 'vitest';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import worker,{type Env} from './index';
import { encodeHike, trimHike } from '../src/community/hike';
import { tileXY, type Point } from '../src/community/geometry';
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'hikes',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-13',d1Databases:['DB'],r2Buckets:['TILES']}]}));
let env:Env;const origin='http://localhost:8787',admin={Authorization:'Bearer test-secret'};
const id=(n:number)=>n.toString(16).padStart(64,'0'),secret='f'.repeat(64);
const payload=(n:number,offset=0)=>({id:id(n),secret,hike:encodeHike([[-90+offset,40],[-89.99+offset,40]],new Date().toISOString().slice(0,7),'Public hike','hike')});
const call=(path:string,body?:unknown,headers:Record<string,string>={})=>worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
const api=(action:string,body:unknown,headers:Record<string,string>={})=>call(`/api/community/hikes/${action}`,body,headers);
const tile=async()=>{const [x,y]=tileXY(-89.995,40);return await (await call(`/tiles/community-hikes/12/${x}/${y}.geojson`)).json() as {features:{id:string;properties:Record<string,unknown>}[]};};
const exported=async()=>{const response=await call('/api/community/export',undefined,admin);expect(response.status).toBe(200);return (await response.text()).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s) as {id:string;properties:Record<string,unknown>});};
beforeAll(async()=>{const db=await mf.getD1Database('DB','hikes');for(const name of ['0001_cloud_sync','0002_usage','0003_community_trails','0004_community_hikes'])await db.exec(readFileSync(`migrations/${name}.sql`,'utf8').replace(/\n/g,' '));env={DB:db as unknown as D1Database,TILES:await mf.getR2Bucket('TILES','hikes') as unknown as R2Bucket,COMMUNITY_ADMIN_TOKEN:'test-secret',ASSETS:{fetch:async()=>new Response('SPA')} as Fetcher};});
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(1792843200000);});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>mf.dispose());
it('shares signed out, rejects duplicates and invalid payloads, and exports positive GPS labels without secrets',async()=>{
 expect((await api('share',payload(1))).status).toBe(201);
 expect((await api('share',payload(1))).status).toBe(409);
 expect((await api('share',payload(2))).status).toBe(409);
 expect((await api('share',{...payload(3),hike:{...payload(3).hike,month:'2099-01'}})).status).toBe(400);
 expect((await api('share',{...payload(3),hike:{...payload(3).hike,d:[0,0,1,1]}})).status).toBe(400);
 expect((await api('share',payload(3),{origin:'https://evil.example'})).status).toBe(403);
 expect((await api('share',payload(3),{'content-type':'text/plain'})).status).toBe(415);
 expect((await api('share',{padding:'x'.repeat(250001)})).status).toBe(413);
 const features=(await tile()).features;expect(features).toHaveLength(1);expect(features[0]!.properties).toMatchObject({name:'Public hike',type:'hike',month:new Date().toISOString().slice(0,7)});
 expect(JSON.stringify(features)).not.toMatch(/secret|hash|device|account|email/);
 const hikes=(await exported()).filter(f=>f.properties.dataset==='hikes');expect(hikes).toHaveLength(1);expect(hikes[0]!.properties).toMatchObject({source:'gps_track',label:'positive',hidden:false});
 expect(JSON.stringify(hikes)).not.toContain(secret);
 expect((await call('/tiles/community-hikes/11/0/0.geojson')).status).toBe(404);
});
it('logs one report per hike/device, hides at three, and honors admin overrides',async()=>{
 const visible=async()=>(await tile()).features.some(f=>f.id===id(1));
 for(const token of [id(100),id(100),id(101)])expect((await api('report',{id:id(1),token})).status).toBe(200);
 expect(await visible()).toBe(true);
 expect((await api('report',{id:id(1),token:id(102)})).status).toBe(200);expect(await visible()).toBe(false);
 expect((await env.DB.prepare('SELECT * FROM community_hike_report_log').all()).results).toHaveLength(3);
 expect((await api('override',{id:id(1),override:'show'})).status).toBe(403);
 expect((await api('override',{id:id(1),override:'show'},admin)).status).toBe(200);expect(await visible()).toBe(true);
 expect((await api('override',{id:id(1),override:'hide'},admin)).status).toBe(200);expect(await visible()).toBe(false);
 expect((await api('override',{id:id(1),override:null},admin)).status).toBe(200);expect(await visible()).toBe(false);
 expect((await exported()).find(f=>f.id===id(1))!.properties.hidden).toBe(true);
 expect((await api('report',{id:id(1),token:'short'})).status).toBe(400);
 expect((await api('report',{id:id(999),token:id(100)})).status).toBe(404);
});
it('requires the private withdrawal secret, removes training geometry, and prevents delayed uploads resurrecting it',async()=>{
 expect((await api('unshare',{id:id(1),secret:id(1)})).status).toBe(403);
 expect((await api('unshare',{id:id(1),secret})).status).toBe(200);
 expect((await api('unshare',{id:id(1),secret})).status).toBe(200);
 expect((await api('share',payload(1))).status).toBe(409);
 expect((await exported()).filter(f=>f.properties.dataset==='hikes')).toHaveLength(0);
 expect(await env.DB.prepare('SELECT geometry,withdrawn FROM community_hikes WHERE id=?').bind(id(1)).first()).toEqual({geometry:null,withdrawn:1});
 expect((await env.DB.prepare('SELECT * FROM community_hike_report_log').all()).results).toHaveLength(3);
 expect((await api('unshare',{id:id(4),secret})).status).toBe(200);
 expect((await api('share',payload(4,.001))).status).toBe(409);
});
it('supports authenticated delete by ID/bbox, retains moderation geometry, and purges only its origin without failing writes',async()=>{
 const cache={match:vi.fn().mockResolvedValue(undefined),put:vi.fn().mockResolvedValue(undefined),delete:vi.fn().mockResolvedValue(true)};vi.stubGlobal('caches',{default:cache});
 try {
 expect((await api('share',payload(5,.002))).status).toBe(201);
 expect(cache.delete.mock.calls.every(([r])=>r.url.startsWith(origin+'/tiles/community-hikes/12/'))).toBe(true);
 await tile();expect(cache.put).toHaveBeenCalled();cache.delete.mockClear();
 expect((await api('delete',{id:id(5)})).status).toBe(403);
 expect((await api('delete',{id:id(5)},admin)).status).toBe(200);expect(cache.delete).toHaveBeenCalled();
 expect((await tile()).features).toHaveLength(0);
 expect((await exported()).filter(f=>f.properties.dataset==='hikes')).toHaveLength(0);
 expect((await env.DB.prepare('SELECT geometry FROM community_hikes WHERE id=?').bind(id(5)).first<{geometry:string}>())!.geometry).toBeTruthy();
 expect((await api('share',payload(6,.003))).status).toBe(201);
 cache.delete.mockRejectedValue(new Error('cache unavailable'));const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{expect((await api('delete',{bbox:[-91,39,-89,41]},admin)).status).toBe(200);}finally{warning.mockRestore();}
 expect((await tile()).features).toHaveLength(0);
 }finally{vi.unstubAllGlobals();}
});
it('rate limits salted IPs and anonymous reporting device hashes',async()=>{
 for(let i=0;i<60;i++)expect((await api('share',{}, {'CF-Connecting-IP':'192.0.2.44'})).status).toBe(400);
 expect((await api('share',{}, {'CF-Connecting-IP':'192.0.2.44'})).status).toBe(429);
 const token=id(500);
 for(let i=0;i<30;i++)expect((await api('report',{id:id(999),token},{'CF-Connecting-IP':`192.0.3.${i}`})).status).toBe(404);
 expect((await api('report',{id:id(999),token},{'CF-Connecting-IP':'192.0.3.31'})).status).toBe(429);
});

it.each([0,200])('accepts selected full/trimmed geometry and keeps secrets and point metadata out of tile/export (trim %s)',async trim=>{
 const coordinates=[[-90,40,123,987654321],[-89.997,40.000001,234,987654322],[-89.99,40,345,987654323]] as unknown as Point[];
 const selected=trimHike(coordinates,trim),shareId=id(1000+trim);
 expect((await api('share',{id:shareId,secret,hike:encodeHike(selected,'2026-10')})).status).toBe(201);
 const row=await env.DB.prepare('SELECT secret_hash FROM community_hikes WHERE id=?').bind(shareId).first<{secret_hash:string}>();
 expect(row!.secret_hash).toMatch(/^[a-f0-9]{64}$/);
 const publicTile=(await tile()).features.find(f=>f.id===shareId)!;
 const training=(await exported()).find(f=>f.id===shareId)!;
 for(const feature of [publicTile,training]){
   const json=JSON.stringify(feature);
   expect(json).not.toContain(secret);expect(json).not.toContain(row!.secret_hash);
   expect(json).not.toMatch(/secret|hash|timestamp|elevation|98765432/);
   expect((feature as unknown as {geometry:{coordinates:Point[]}}).geometry.coordinates).toEqual(selected);
 }
 expect((await api('unshare',{id:shareId,secret})).status).toBe(200);
});
