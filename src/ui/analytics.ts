import { excludeDeviceSwitch } from './analyticsExclude';
import { h } from './dom';
import { loadGoogle } from './accountPanel';
import type { AnalyticsReport } from '../analyticsReport';
import './analytics.css';
const dayOf=(time:number)=>new Date(time).toISOString().slice(0,10);
const number=(value:number)=>value.toLocaleString();
const humanize=(name:string)=>name.split('_').map(word=>['gpx','qr','pwa'].includes(word)?word.toUpperCase():word==='geojson'?'GeoJSON':word.charAt(0).toUpperCase()+word.slice(1)).join(' ');
const metric=(value:number,label:string)=>h('div',{class:'analytics-metric'},h('strong',{},number(value)),h('span',{},label));
const section=(title:string,...children:HTMLElement[])=>h('section',{class:'analytics-section'},h('h2',{},title),...children);
function chart(data:AnalyticsReport):HTMLElement {
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 900 240'); svg.setAttribute('role','img');
  svg.setAttribute('aria-label',`Daily users and internal users, ${data.from} to ${data.to}. ${data.days.map(d=>`${d.day}: ${d.users} users, ${d.internal} internal`).join('; ')}`);
  const max=Math.max(1,...data.days.flatMap(d=>[d.users,d.internal]));
  const element=(tag:string,attrs:Record<string,string>)=>{const el=document.createElementNS(ns,tag); for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value); svg.append(el); return el;};
  for(let i=0;i<=4;i++) {const y=20+i*48; element('line',{x1:'44',x2:'884',y1:String(y),y2:String(y),class:'chart-grid'}); element('text',{x:'34',y:String(y+4),'text-anchor':'end',class:'chart-label'}).textContent=number(Math.round(max*(1-i/4)));}
  const points=(key:'users'|'internal')=>data.days.map((d,i)=>`${data.days.length===1?464:44+i/(data.days.length-1)*840},${212-d[key]/max*192}`);
  const real=points('users');
  element('path',{d:`M${real[0]!.split(',')[0]},212 L${real.join(' L')} L${real.at(-1)!.split(',')[0]},212 Z`,class:'chart-area'});
  element('polyline',{points:real.join(' '),class:'chart-real'});
  element('polyline',{points:points('internal').join(' '),class:'chart-internal'});
  if(data.days.length===1) element('circle',{cx:'464',cy:String(212-data.days[0]!.users/max*192),r:'4',class:'chart-dot'});
  return h('div',{class:'analytics-trend'},svg,h('div',{class:'chart-dates'},h('span',{},data.from),h('span',{},data.to)));
}
function renderReport(data:AnalyticsReport):HTMLElement {
  const a=data.real.audience;
  const cards=h('div',{class:'analytics-metrics'},metric(data.real.today,'Today · users'),metric(data.real.days7,'7d · user-days'),metric(data.real.days30,'30d · user-days'));
  const audience=h('div',{class:'analytics-audience'},metric(a.new,'New'),metric(a.returning,'Returning'),metric(a.installed,'Installed'),metric(a.browser,'Browser'));
  const table=h('table',{},h('thead',{},h('tr',{},...['Feature','User-days','Uses','OK %','Fail %'].map(label=>h('th',{scope:'col'},label)))),h('tbody',{},...data.features.map(row=>h('tr',{},h('th',{scope:'row'},humanize(row.feature)),h('td',{},number(row.users)),h('td',{},number(row.uses)),h('td',{},row.okRate===null?'—':`${Math.round(row.okRate*100)}%`),h('td',{class:row.failRate!==null&&row.failRate>=.1?'analytics-failure':''},row.failRate===null?'—':`${Math.round(row.failRate*100)}%`)))));
  const features=section('Features',h('div',{class:'table-scroll',tabindex:0,'aria-label':'Feature ranking'},table));
  if(!data.features.length) features.append(h('p',{},'No activity'));
  const names=new Intl.DisplayNames(['en'],{type:'region'}), max=Math.max(1,...data.countries.map(row=>row.users));
  const countries=section('Countries',h('ul',{class:'analytics-countries'},...data.countries.map(row=>h('li',{},h('div',{},h('span',{},row.country==='XX'?'Unknown':names.of(row.country)??row.country),h('strong',{},number(row.users))),h('div',{class:'country-meter'},h('div',{style:`width:${row.users/max*100}%`})) ))));
  if(!data.countries.length) countries.append(h('p',{},'No activity'));
  return h('div',{class:'analytics-report'},cards,section('Audience · user-days',audience),section('Daily users',h('div',{class:'chart-legend'},h('span',{class:'legend-real'},'Real'),h('span',{class:'legend-internal'},'Internal')),chart(data)),h('div',{class:'analytics-columns'},features,countries),section('Internal',h('div',{class:'analytics-audience'},metric(data.internal.opens,'Opens'),metric(data.internal.featureUses,'Feature uses'))));
}
export async function renderAnalytics(root:HTMLElement) {
  const main=h('main',{class:'analytics'},h('div',{class:'analytics-header'},h('a',{href:'/'},'Map'),h('h1',{},'Analytics')));
  root.replaceChildren(main);
  const today=dayOf(Date.now());
  const from=h('input',{type:'date',value:dayOf(Date.now()-29*86400000),'aria-label':'From',required:true});
  const to=h('input',{type:'date',value:today,'aria-label':'To',required:true});
  const quick=h('div',{class:'analytics-quick',role:'group','aria-label':'Date range'});
  const controls=h('div',{class:'analytics-controls'},quick,h('div',{class:'analytics-dates'},h('label',{},'From',from),h('label',{},'To',to)));
  const content=h('div',{'aria-live':'polite'}), status=h('p',{role:'status'});
  let requestId=0, controller:AbortController|undefined, mounted=false;
  const buttons=[30,90].map(count=>h('button',{type:'button',onclick:()=>{to.value=today; from.value=dayOf(Date.parse(today)-(count-1)*86400000); void refresh();}},`${count}d`)); quick.append(...buttons);
  async function refresh() {
    if(!from.value||!to.value||!from.validity.valid||!to.validity.valid) return;
    const span=(Date.parse(to.value)-Date.parse(from.value))/86400000;
    if(span<0||span>=400) {status.textContent='Choose 1–400 days'; return;}
    const id=++requestId; controller?.abort(); controller=new AbortController();
    buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(to.value===today&&span===[29,89][i])));
    content.setAttribute('aria-busy','true'); status.textContent='Loading';
    try {
      const response=await fetch(`/api/admin/usage?${new URLSearchParams({from:from.value,to:to.value})}`,{cache:'no-store',signal:controller.signal});
      if(id!==requestId) return;
      if(response.status===401) {
        content.replaceChildren(); status.textContent='';
        const config=await (await fetch('/api/config')).json();
        const button=h('div',{}); content.append(button);
        const google=await loadGoogle();
        google.initialize({client_id:config.googleClientId,callback:({credential})=>{void fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential})}).then(r=>{if(r.ok) location.reload(); else button.textContent='Sign in failed';});}});
        google.renderButton(button,{type:'standard',theme:'outline',size:'large',text:'signin_with'}); return;
      }
      if(!response.ok) {content.replaceChildren(); status.textContent=response.status===403?'Forbidden':'Unavailable'; return;}
      const data:AnalyticsReport=await response.json();
      if(id!==requestId) return;
      if(!mounted) {main.insertBefore(h('div',{class:'analytics-settings'},excludeDeviceSwitch()),content); main.insertBefore(controls,content); mounted=true;}
      content.replaceChildren(renderReport(data)); status.textContent='';
    } catch {if(id===requestId) {content.replaceChildren(); status.textContent='Unavailable';}}
    finally {if(id===requestId) content.removeAttribute('aria-busy');}
  }
  from.addEventListener('change',()=>{void refresh();}); to.addEventListener('change',()=>{void refresh();});
  main.append(content,status); await refresh();
}
