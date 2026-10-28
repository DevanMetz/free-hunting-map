import { excludeDeviceSwitch } from './analyticsExclude';
import { h } from './dom';
import { loadGoogle } from './accountPanel';
import './analytics.css';
export async function renderAnalytics(root: HTMLElement) {
  const main=h('main',{class:'analytics'},h('a',{href:'/'},'Map'),h('h1',{},'Analytics'));
  root.replaceChildren(main);
  try {
    const response=await fetch('/api/admin/usage',{cache:'no-store'});
    if(response.status===401) {
      const config=await (await fetch('/api/config')).json();
      const button=h('div',{}); main.append(button);
      const google=await loadGoogle();
      google.initialize({client_id:config.googleClientId,callback:({credential})=>{void fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential})}).then(r=>{if(r.ok) location.reload(); else button.textContent='Sign in failed';});}});
      google.renderButton(button,{type:'standard',theme:'outline',size:'large',text:'signin_with'}); return;
    }
    if(!response.ok) { main.append(h('p',{},response.status===403?'Forbidden':'Unavailable')); return; }
    const data=await response.json();
    main.append(excludeDeviceSwitch());
    main.append(h('div',{class:'metrics'},...['dau','wau','mau'].map(key=>h('div',{},h('strong',{},String(data[key]??0)),h('span',{},key.toUpperCase())))));
    const days=Array.from({length:30},(_,i)=>{const day=new Date(Date.now()-(29-i)*86400000).toISOString().slice(0,10); return data.days.find((d:any)=>d.day===day)??{day,users:0,pwa:0,browser:0,new:0,returning:0};});
    const max=Math.max(1,...days.map(d=>d.users));
    main.append(h('h2',{},'30 days'),h('div',{class:'usage-chart',role:'img','aria-label':days.map(d=>`${d.day}: ${d.users}`).join(', ')},...days.map(d=>h('div',{title:`${d.day}: ${d.users}`,style:`height:${Math.max(1,d.users/max*100)}%`}))));
    const table=(head:string[],rows:unknown[][])=>h('div',{class:'table-scroll'},h('table',{},h('thead',{},h('tr',{},...head.map(v=>h('th',{scope:'col'},v)))),h('tbody',{},...rows.map(row=>h('tr',{},...row.map(v=>h('td',{},String(v??0))))))));
    main.append(table(['PWA','Browser','New','Returning'],[['pwa','browser','new','returning'].map(k=>days.reduce((n,d)=>n+d[k],0))]),h('h2',{},'Countries'),table(['Country','Users'],data.countries.map((r:any)=>[r.country,r.users])),h('h2',{},'Features'));
    for(const group of data.features) { const denominator=data[group.period==='today'?'dau':group.period==='week'?'wau':'mau']??0;
      main.append(h('h3',{},group.period==='today'?'Today':group.period==='week'?'Week':'Month'),table(['Feature','Uses','Users','Active %','OK','Fail'],group.rows.map((r:any)=>[r.feature,r.uses,r.users,denominator?`${Math.min(100,Math.round(r.users/denominator*100))}%`:'0%',r.ok,r.fail])));
    }
    main.append(h('h3',{},'30 days'),table(['Day','Feature','Uses'],data.daily.map((r:any)=>[r.day,r.feature,r.uses])));
  } catch { main.append(h('p',{},'Unavailable')); }
}
