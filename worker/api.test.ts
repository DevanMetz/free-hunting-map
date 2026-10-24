import 'fake-indexeddb/auto';
import { Repo } from '../src/storage/repo';
import { CloudSync } from '../src/sync/cloud';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import worker, { type Env } from './index';
const mf = new Miniflare(convertV4MiniflareOptions({workers:[{name:'test',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-10-13',d1Databases:['DB']}]}));
let env: Env;
const origin='http://localhost:8787';
async function call(path: string, body?: unknown, cookie?: string, requestOrigin=origin) {
 return worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
}
const item=(id='marker-0001',updatedAt=1,deleted=false)=>({kind:'waypoint',id,name:'Camp',note:'',icon:'pin',coord:[-90,40],createdAt:1,updatedAt,deviceId:'a',deleted});
beforeAll(async()=>{const db=await mf.getD1Database('DB','test'); await db.exec(readFileSync('migrations/0001_cloud_sync.sql','utf8').replace(/\n/g,' ')); await db.exec(readFileSync('migrations/0002_usage.sql','utf8').replace(/\n/g,' ')); env={DB:db as unknown as D1Database,DEV_AUTH:'1',ASSETS:{fetch:async()=>new Response('SPA')} as Fetcher};});
afterAll(async()=>mf.dispose());
describe('Worker with real local D1',()=>{
 it('hides unconfigured Google sign in and protects APIs',async()=>{
  expect(await (await call('/api/config')).json()).toEqual({googleClientId:null});
  expect((await call('/api/sync',{cursor:0,changes:[]})).status).toBe(401);
  expect((await call('/api/sync',{cursor:0,changes:[]},undefined,'https://evil.example')).status).toBe(403);
  expect((await worker.fetch(new Request(origin+'/api/auth/logout',{method:'POST',headers:{origin},body:'{}'}),env)).status).toBe(415);
  expect(await (await call('/map/route')).text()).toBe('SPA');
 });
 it('merges two devices, isolates users, preserves tombstones and advances cursors',async()=>{
  const a=await call('/api/auth/google',{credential:'dev:alice'}); expect(a.status).toBe(200); const cookie=a.headers.get('set-cookie')!.split(';')[0]!;
  const b=await call('/api/auth/google',{credential:'dev:alice'}); const cookieB=b.headers.get('set-cookie')!.split(';')[0]!;
  const c=await call('/api/auth/google',{credential:'dev:bob'}); const cookieC=c.headers.get('set-cookie')!.split(';')[0]!;
  expect(a.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  const first=await (await call('/api/sync',{cursor:0,changes:[item()]},cookie)).json() as {cursor:number;changes:unknown[]};
  expect(first.changes).toHaveLength(1);
  const pull=await (await call('/api/sync',{cursor:0,changes:[]},cookieB)).json() as {cursor:number;changes:unknown[]}; expect(pull).toMatchObject(first);
  await call('/api/sync',{cursor:pull.cursor,changes:[item('marker-0001',2,true)]},cookieB);
  const stale=await (await call('/api/sync',{cursor:first.cursor,changes:[item()]},cookie)).json() as {cursor:number;changes:{deleted:boolean}[]};
  expect(stale.changes[0]?.deleted).toBe(true); expect(stale.cursor).toBeGreaterThan(first.cursor);
  expect(await (await call('/api/sync',{cursor:0,changes:[]},cookieC)).json()).toMatchObject({changes:[]});
  expect((await call('/api/sync',{cursor:0,changes:[{bad:true}]},cookie)).status).toBe(400);
  expect((await call('/api/auth/logout',{},cookie)).status).toBe(200);
  expect((await call('/api/sync',{cursor:0,changes:[]},cookie)).status).toBe(401);
 });
 it('never enables development auth on production hosts',async()=>{
 const response=await worker.fetch(new Request('https://freehuntingmap.com/api/auth/google',{method:'POST',headers:{origin:'https://freehuntingmap.com','content-type':'application/json'},body:JSON.stringify({credential:'dev:alice'})}),env); expect(response.status).toBe(401);
 });
});

it('syncs two offline-first client engines against the Worker', async()=>{
 const makeDevice=async()=>{
  const repo=await Repo.open(crypto.randomUUID()); let session='';
  const fetcher=(async(input: RequestInfo | URL,init?: RequestInit)=>{
   const headers=new Headers(init?.headers); headers.set('origin',origin); if(session) headers.set('cookie',session);
   const response=await worker.fetch(new Request(new URL(String(input),origin),{...init,headers}),env);
   const cookie=response.headers.get('set-cookie'); if(cookie) session=cookie.split(';')[0]!; return response;
  }) as typeof fetch;
  let online=true; const engine=new CloudSync(repo,fetcher,()=>online);
  return {repo,engine,setOnline:(value:boolean)=>{online=value;}};
 };
 const a=await makeDevice(), b=await makeDevice();
 try {
  await a.repo.create({kind:'waypoint',name:'Offline camp',note:'',icon:'pin',coord:[-90,40]});
  await a.engine.start(); await b.engine.start();
  await a.engine.signIn('dev:engine'); await b.engine.signIn('dev:engine');
  expect((await b.repo.allSyncRecords()).filter(r=>r.kind==='waypoint')).toHaveLength(1);
  a.setOnline(false); await a.repo.create({kind:'track',name:'Trail',note:'',coords:[[-90,40],[-90.01,40.01]],recorded:true});
  await a.engine.retry(); expect(a.engine.state).toBe('offline');
  a.setOnline(true); await a.engine.retry(); await b.engine.retry();
  expect((await b.repo.allSyncRecords()).filter(r=>r.kind==='track')).toHaveLength(1);
  expect(await a.repo.pending()).toHaveLength(0);
  await a.repo.setMeta('settings',{basemap:'satellite',labels:false,view:{zoom:9}});
  await a.repo.saveLidarRun({box:[-91,40,-90,41],candidates:{type:'FeatureCollection',features:[]}});
  await a.engine.retry(); await b.engine.retry();
  expect(await b.repo.getMeta('settings')).toMatchObject({basemap:'satellite',labels:false});
  expect(await b.repo.getMeta('settings')).not.toHaveProperty('view');
  expect(await b.repo.listLidarRuns()).toHaveLength(1);
  await a.repo.clearLidarRuns(); await a.engine.retry(); await b.engine.retry();
  expect(await b.repo.listLidarRuns()).toHaveLength(0);
  await a.engine.signOut(); expect(a.engine.user).toBeNull();
  await expect(a.engine.signIn('dev:other-account')).rejects.toThrow('another account');
 } finally { a.engine.stop(); b.engine.stop(); }
});

it('paginates server changes and resolves concurrent edits without duplicate history',async()=>{
 const auth=await call('/api/auth/google',{credential:'dev:paging'}); const cookie=auth.headers.get('set-cookie')!.split(';')[0]!;
 const records=Array.from({length:100},(_,i)=>item(`page-${String(i).padStart(8,'0')}`));
 expect((await call('/api/sync',{cursor:0,changes:records},cookie)).status).toBe(200);
 await call('/api/sync',{cursor:0,changes:[item('page-last-0001')]},cookie);
 const page=await (await call('/api/sync',{cursor:0,changes:[]},cookie)).json() as {cursor:number;changes:unknown[];hasMore:boolean};
 expect(page.changes).toHaveLength(100); expect(page.hasMore).toBe(true);
 const tail=await (await call('/api/sync',{cursor:page.cursor,changes:[]},cookie)).json() as {changes:unknown[]}; expect(tail.changes).toHaveLength(1);
 await Promise.all([2,3,4].map(updatedAt=>call('/api/sync',{cursor:0,changes:[item('page-last-0001',updatedAt)]},cookie)));
 const final=await env.DB.prepare('SELECT payload FROM items WHERE user_id=? AND id=?').bind('paging','page-last-0001').first<{payload:string}>(); expect(JSON.parse(final!.payload).updatedAt).toBe(4);
 const count=await env.DB.prepare('SELECT count(*) AS n FROM changes WHERE user_id=?').bind('paging').first<{n:number}>(); expect(count!.n).toBe(101);
},30_000);

it('enforces auth rate limits and sync payload limits',async()=>{
 for(let i=0;i<20;i++) await worker.fetch(new Request(origin+'/api/auth/google',{method:'POST',headers:{origin,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:'{"credential":"invalid"}'}),env);
 const limited=await worker.fetch(new Request(origin+'/api/auth/google',{method:'POST',headers:{origin,'content-type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:'{"credential":"invalid"}'}),env); expect(limited.status).toBe(429);
 const auth=await call('/api/auth/google',{credential:'dev:limits'}); const cookie=auth.headers.get('set-cookie')!.split(';')[0]!;
 expect((await call('/api/sync',{cursor:0,changes:Array.from({length:101},()=>item())},cookie)).status).toBe(400);
 expect((await call('/api/sync',{cursor:0,changes:[{...item(),note:'x'.repeat(1_000_001)}]},cookie)).status).toBe(413);
 await env.DB.prepare('INSERT OR REPLACE INTO rate_limits(key,window,count) VALUES(?,?,120)').bind('sync:limits',Math.floor(Date.now()/60000)).run();
 expect((await call('/api/sync',{cursor:0,changes:[]},cookie)).status).toBe(429);
});

it('deletes all account data and sessions without affecting other users', async () => {
 const login = async (name: string) => (await call('/api/auth/google', {credential:`dev:${name}`})).headers.get('set-cookie')!.split(';')[0]!;
 const cookie = await login('delete-me'), secondSession = await login('delete-me'), other = await login('keep-me');
 await call('/api/sync', {cursor:0,changes:[item('delete-marker-001')]}, cookie);
 await call('/api/sync', {cursor:0,changes:[item('keep-marker-0001')]}, other);
 expect((await call('/api/account/delete', {})).status).toBe(401);
 expect((await call('/api/account/delete', {}, cookie, 'https://evil.example')).status).toBe(403);
 expect((await worker.fetch(new Request(origin+'/api/account/delete',{method:'POST',headers:{origin,cookie},body:'{}'}),env)).status).toBe(415);
 const response = await call('/api/account/delete', {}, cookie);
 expect(response.status).toBe(200);
 expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
 for (const table of ['items','changes','sessions']) {
  const deleted = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).bind('delete-me').first<{n:number}>();
  const kept = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).bind('keep-me').first<{n:number}>();
  expect(deleted!.n).toBe(0); expect(kept!.n).toBeGreaterThan(0);
 }
 expect(await env.DB.prepare('SELECT id FROM users WHERE id=?').bind('delete-me').first()).toBeNull();
 expect(await env.DB.prepare('SELECT id FROM users WHERE id=?').bind('keep-me').first()).not.toBeNull();
 expect(await env.DB.prepare('SELECT key FROM rate_limits WHERE key=?').bind('sync:delete-me').first()).toBeNull();
 expect(await env.DB.prepare('SELECT key FROM rate_limits WHERE key=?').bind('sync:keep-me').first()).not.toBeNull();
 expect((await call('/api/sync',{cursor:0,changes:[]},secondSession)).status).toBe(401);
 expect((await call('/api/account/delete',{},cookie)).status).toBe(401);
 // A sync handler that authenticated before deletion must not recreate the rows.
 const { sync } = await import('./sync');
 await expect(sync(env.DB,'delete-me',{cursor:0,changes:[item('late-marker-0001')]})).rejects.toThrow();
 expect(await env.DB.prepare('SELECT id FROM items WHERE user_id=?').bind('delete-me').first()).toBeNull();
});

it('records anonymous usage, validates limits and protects admin reports',async()=>{
 const day=new Date().toISOString().slice(0,10), ping={id:'anonymous-test-1234',day,installed:true,returning:false,newWeek:true,newMonth:true};
 const countryRequest=new Request(origin+'/api/ping',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(ping)});
 Object.defineProperty(countryRequest,'cf',{value:{country:'US'}});
 expect((await worker.fetch(countryRequest,env)).status).toBe(204);
 expect((await call('/api/ping',ping)).status).toBe(204);
 expect(await env.DB.prepare('SELECT COUNT(*) n,country FROM usage_pings').first()).toMatchObject({n:1,country:'US'});
 expect((await call('/api/ping',{...ping,day:'2026-99-99'})).status).toBe(400);
 expect((await call('/api/ping',{...ping,id:'bad'})).status).toBe(400);
 expect((await call('/api/ping',{...ping,pad:'x'.repeat(1024)})).status).toBe(413);
 expect((await call('/api/ping',ping,undefined,'https://evil.example')).status).toBe(403);
 const event={id:ping.id,installed:true,version:'0.1.0',events:[{f:'marker_add',day,fw:true,fm:true},{f:'unknown'}]};
 expect((await call('/api/events',event)).status).toBe(204);await call('/api/events',event);
 expect(await env.DB.prepare('SELECT count,country FROM feature_uses').first()).toMatchObject({count:2,country:'XX'});
 expect((await call('/api/admin/usage')).status).toBe(401);
 const login=await call('/api/auth/google',{credential:'dev:admin-usage'}), session=login.headers.get('set-cookie')!.split(';')[0]!;
 expect((await call('/api/admin/usage',undefined,session)).status).toBe(403);
 await env.DB.prepare('UPDATE users SET email=? WHERE id=?').bind('MetzDevan@gmail.com','admin-usage').run();
 const report=await call('/api/admin/usage',undefined,session);expect(report.status).toBe(200);expect(await report.json()).toMatchObject({dau:1,wau:1,mau:1});
 for(let i=0;i<30;i++) await call('/api/ping',ping);
 expect((await call('/api/ping',ping)).status).toBe(429);
});
