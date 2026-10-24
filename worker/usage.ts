import { FEATURES, periods } from '../src/usageSchema';
import { ApiError } from './sync';
import type { Env } from './index';
const dayOf = (time: number) => new Date(time).toISOString().slice(0,10);
export async function recordUsage(input: unknown, request: Request, env: Env, events: boolean) {
  const value = input as Record<string,unknown> | null;
  const validDay = (day: unknown): day is string => typeof day==='string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day>=dayOf(Date.now()-7*86400000) && day<=dayOf(Date.now()) && Number.isFinite(Date.parse(day)) && dayOf(Date.parse(day))===day;
  if (!value || typeof value!=='object' || typeof value.id!=='string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value.id) || typeof value.installed!=='boolean') throw new ApiError(400,'Invalid usage');
  const country = /^[A-Z]{2}$/.test(String(request.cf?.country)) ? String(request.cf?.country) : 'XX';
  const ae = (point: AnalyticsEngineDataPoint) => { try { env.USAGE?.writeDataPoint(point); } catch { /* Optional analytics. */ } };
  if (!events) {
    if (!validDay(value.day) || ['returning','newWeek','newMonth'].some(key=>typeof value[key]!=='boolean')) throw new ApiError(400,'Invalid open');
    const result=await env.DB.prepare('INSERT OR IGNORE INTO usage_pings VALUES(?,?,?,?,?,?,?)').bind(value.day,value.id,+value.installed,+!!value.returning,+!!value.newWeek,+!!value.newMonth,country).run();
    if(result.meta.changes) ae({indexes:[value.day],blobs:[country,value.installed?'pwa':'browser',value.returning?'returning':'new'],doubles:[1,value.newWeek?1:0,value.newMonth?1:0]});
  } else {
    if (!Array.isArray(value.events) || value.events.length>100 || typeof value.version!=='string' || !/^[\w.+-]{1,40}$/.test(value.version)) throw new ApiError(400,'Invalid events');
    const entries: {f:string;o:string;day:string;fw:boolean;fm:boolean}[]=[];
    for (const e of value.events) {
      if (!e || typeof e!=='object' || !FEATURES.includes(e.f)) continue;
      if (!validDay(e.day) || (e.o!==undefined && e.o!=='ok' && e.o!=='fail') || typeof e.fw!=='boolean' || typeof e.fm!=='boolean') throw new ApiError(400,'Invalid event');
      entries.push({...e,o:e.o??''});
    }
    if(entries.length) await env.DB.batch(entries.map(e=>env.DB.prepare('INSERT INTO feature_uses VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(day,anon,feature,outcome) DO UPDATE SET count=count+1,new_week=MAX(new_week,excluded.new_week),new_month=MAX(new_month,excluded.new_month)').bind(e.day,value.id,e.f,e.o,+value.installed!,value.version,country,+e.fw,+e.fm)));
    for(const e of entries) ae({indexes:[e.f],blobs:[e.f,e.o,value.version,value.installed?'pwa':'browser',country],doubles:[1]});
  }
  await env.DB.batch([...['usage_pings','feature_uses'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE day<?`).bind(dayOf(Date.now()-400*86400000))),env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'ping:%' AND window<?").bind(Math.floor(Date.now()/60_000)-5)]);
  return new Response(null,{status:204});
}
export async function usageReport(db: D1Database) {
  const today=dayOf(Date.now()), {week,month}=periods(today), since=dayOf(Date.now()-29*86400000);
  const days=await db.prepare('SELECT day,COUNT(*) users,SUM(1-[returning]) new,SUM([returning]) [returning],SUM(installed) pwa,SUM(1-installed) browser FROM usage_pings WHERE day>=? GROUP BY day ORDER BY day').bind(since).all();
  const totals=await db.prepare('SELECT SUM(day=?) dau,SUM(CASE WHEN day>=? THEN new_week ELSE 0 END) wau,SUM(CASE WHEN day>=? THEN new_month ELSE 0 END) mau FROM usage_pings WHERE day>=?').bind(today,week,month+'-01',week<month+'-01'?week:month+'-01').first();
  const countries=await db.prepare('SELECT country,COUNT(*) users FROM usage_pings WHERE day>=? GROUP BY country ORDER BY users DESC LIMIT 20').bind(since).all();
  // Collapse outcomes before counting feature users: ok + fail is still one device.
  const features=[];
  for(const [period,start,flag] of [['today',today,'1'],['week',week,'new_week'],['month',month+'-01','new_month']]) {
    const result=await db.prepare(`SELECT feature,SUM(uses) uses,SUM(unique_user) users,SUM(ok) ok,SUM(fail) fail FROM (SELECT feature,day,anon,SUM(count) uses,MAX(${flag}) unique_user,SUM(CASE WHEN outcome='ok' THEN count ELSE 0 END) ok,SUM(CASE WHEN outcome='fail' THEN count ELSE 0 END) fail FROM feature_uses WHERE day>=? GROUP BY feature,day,anon) GROUP BY feature`).bind(start).all();
    features.push({period,rows:result.results});
  }
  const daily=await db.prepare('SELECT day,feature,SUM(count) uses FROM feature_uses WHERE day>=? GROUP BY day,feature ORDER BY day').bind(since).all();
  return {...totals,days:days.results,countries:countries.results,features,daily:daily.results};
}
