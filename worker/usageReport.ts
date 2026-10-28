import type { AnalyticsReport, Audience, TrafficSummary } from '../src/analyticsReport';
import { ApiError } from './sync';
const dayOf=(time:number)=>new Date(time).toISOString().slice(0,10);
const emptyAudience=():Audience=>({users:0,new:0,returning:0,installed:0,browser:0});
export async function usageReport(db:D1Database, params=new URLSearchParams()):Promise<AnalyticsReport> {
  const today=dayOf(Date.now()), since7=dayOf(Date.now()-6*86400000), since30=dayOf(Date.now()-29*86400000);
  const from=params.get('from')??since30, to=params.get('to')??today;
  const valid=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && dayOf(Date.parse(day))===day;
  if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>=400) throw new ApiError(400,'Invalid date range');
  // Inspect each table once: older local databases may predate internal traffic flags.
  const [pingColumns,featureColumns]=await Promise.all(['usage_pings','feature_uses'].map(table=>db.prepare(`PRAGMA table_info(${table})`).all<{name:string}>()));
  const pingInternal=pingColumns!.results.some(c=>c.name==='internal')?'internal':'0';
  const featureInternal=featureColumns!.results.some(c=>c.name==='internal')?'internal':'0';
  type Daily=Audience & {day:string; internal:number};
  type Feature={feature:string; internal:number; users:number; uses:number; ok:number; fail:number};
  const [daily,features,countries]=await db.batch([
    db.prepare(`SELECT day,${pingInternal} AS internal,COUNT(*) users,SUM(1-[returning]) new,SUM([returning]) [returning],SUM(installed) installed,SUM(1-installed) browser FROM usage_pings WHERE day BETWEEN ? AND ? GROUP BY day,${pingInternal==='0'?'day':'internal'} ORDER BY day`).bind(from<since30?from:since30,to>today?to:today),
    // Collapse outcomes into one device-day per feature, independently of open delivery.
    db.prepare(`SELECT feature,internal,COUNT(*) users,SUM(uses) uses,SUM(ok) ok,SUM(fail) fail FROM (SELECT feature,day,anon,${featureInternal} AS internal,SUM(count) uses,SUM(CASE WHEN outcome='ok' THEN count ELSE 0 END) ok,SUM(CASE WHEN outcome='fail' THEN count ELSE 0 END) fail FROM feature_uses WHERE day BETWEEN ? AND ? GROUP BY feature,day,anon${featureInternal==='0'?'':',internal'}) GROUP BY feature,internal ORDER BY users DESC,uses DESC,feature`).bind(from,to),
    db.prepare(`SELECT country,COUNT(*) users FROM usage_pings WHERE day BETWEEN ? AND ? AND ${pingInternal}=0 GROUP BY country ORDER BY users DESC,country LIMIT 25`).bind(from,to),
  ]);
  const summary=():TrafficSummary=>({today:0,days7:0,days30:0,audience:emptyAudience(),opens:0,featureUses:0});
  const real=summary(), internal=summary(), days:AnalyticsReport['days']=[];
  for(let time=Date.parse(from);time<=Date.parse(to);time+=86400000) days.push({day:dayOf(time),...emptyAudience(),internal:0});
  const byDay=new Map(days.map(day=>[day.day,day]));
  for(const row of daily!.results as unknown as Daily[]) {
    const target=row.internal?internal:real;
    if(row.day===today) target.today+=row.users;
    if(row.day>=since7 && row.day<=today) target.days7+=row.users;
    if(row.day>=since30 && row.day<=today) target.days30+=row.users;
    if(row.day<from || row.day>to) continue;
    target.opens+=row.users;
    for(const key of ['users','new','returning','installed','browser'] as const) target.audience[key]+=row[key];
    const day=byDay.get(row.day)!;
    if(row.internal) day.internal=row.users;
    else for(const key of ['users','new','returning','installed','browser'] as const) day[key]=row[key];
  }
  const ranking:AnalyticsReport['features']=[];
  for(const row of features!.results as unknown as Feature[]) {
    (row.internal?internal:real).featureUses+=row.uses;
    if(!row.internal) { const outcomes=row.ok+row.fail; ranking.push({feature:row.feature,users:row.users,uses:row.uses,ok:row.ok,fail:row.fail,okRate:outcomes?row.ok/outcomes:null,failRate:outcomes?row.fail/outcomes:null}); }
  }
  return {from,to,real,internal,days,features:ranking,countries:countries!.results as unknown as AnalyticsReport['countries']};
}
