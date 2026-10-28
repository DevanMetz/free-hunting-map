import { FEATURES } from '../src/usageSchema';
import { ApiError } from './sync';
import type { Env } from './index';
const dayOf = (time: number) => new Date(time).toISOString().slice(0,10);
export async function recordUsage(input: unknown, request: Request, env: Env, events: boolean) {
  const value = input as Record<string,unknown> | null;
  const validDay = (day: unknown): day is string => typeof day==='string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day>=dayOf(Date.now()-7*86400000) && day<=dayOf(Date.now()) && Number.isFinite(Date.parse(day)) && dayOf(Date.parse(day))===day;
  if (!value || typeof value!=='object' || typeof value.id!=='string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value.id) || typeof value.installed!=='boolean' || (value.internal!==undefined && typeof value.internal!=='boolean')) throw new ApiError(400,'Invalid usage');
  const country = /^[A-Z]{2}$/.test(String(request.cf?.country)) ? String(request.cf?.country) : 'XX';
  const ae = (point: AnalyticsEngineDataPoint) => { try { if (!value.internal) env.USAGE?.writeDataPoint(point); } catch { /* Optional analytics. */ } };
  if (!events) {
    if (!validDay(value.day) || ['returning','newWeek','newMonth'].some(key=>typeof value[key]!=='boolean')) throw new ApiError(400,'Invalid open');
    const result=await env.DB.prepare('INSERT OR IGNORE INTO usage_pings (day,anon,installed,[returning],new_week,new_month,country,internal) VALUES(?,?,?,?,?,?,?,?)').bind(value.day,value.id,+value.installed,+!!value.returning,+!!value.newWeek,+!!value.newMonth,country,+!!value.internal).run();
    if(result.meta.changes) ae({indexes:[value.day],blobs:[country,value.installed?'pwa':'browser',value.returning?'returning':'new'],doubles:[1,value.newWeek?1:0,value.newMonth?1:0]});
  } else {
    if (!Array.isArray(value.events) || value.events.length>100 || typeof value.version!=='string' || !/^[\w.+-]{1,40}$/.test(value.version)) throw new ApiError(400,'Invalid events');
    const entries: {f:string;o:string;day:string;fw:boolean;fm:boolean}[]=[];
    for (const e of value.events) {
      if (!e || typeof e!=='object' || !FEATURES.includes(e.f)) continue;
      if (!validDay(e.day) || (e.o!==undefined && e.o!=='ok' && e.o!=='fail') || typeof e.fw!=='boolean' || typeof e.fm!=='boolean') throw new ApiError(400,'Invalid event');
      entries.push({...e,o:e.o??''});
    }
    if(entries.length) await env.DB.batch(entries.map(e=>env.DB.prepare('INSERT INTO feature_uses (day,anon,feature,outcome,installed,version,country,count,new_week,new_month,internal) VALUES(?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(day,anon,feature,outcome) DO UPDATE SET count=count+1,new_week=MAX(new_week,excluded.new_week),new_month=MAX(new_month,excluded.new_month),internal=MAX(internal,excluded.internal)').bind(e.day,value.id,e.f,e.o,+value.installed!,value.version,country,+e.fw,+e.fm,+!!value.internal)));
    for(const e of entries) ae({indexes:[e.f],blobs:[e.f,e.o,value.version,value.installed?'pwa':'browser',country],doubles:[1]});
  }
  await env.DB.batch([...['usage_pings','feature_uses'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE day<?`).bind(dayOf(Date.now()-400*86400000))),env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'ping:%' AND window<?").bind(Math.floor(Date.now()/60_000)-5)]);
  return new Response(null,{status:204});
}
