import { periods, type Feature } from './usageSchema';
declare const __APP_VERSION__: string;
const prefix = 'fhm.usage.';
const keys = ['identity','last','pending','events','features'];
type Open = { id: string; day: string; installed: boolean; returning: boolean; newWeek: boolean; newMonth: boolean };
type Entry = { id: string; installed: boolean; day: string; f: Feature; o?: 'ok'|'fail'; fw: boolean; fm: boolean };
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
const seen = new Set<string>();
const read = <T>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(prefix+key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => localStorage.setItem(prefix+key,JSON.stringify(value));
export function privacyBlocked() { return navigator.doNotTrack === '1' || (navigator as Navigator & {globalPrivacyControl?: boolean}).globalPrivacyControl === true; }
export function usageAllowed() { try { return !privacyBlocked() && read('enabled',true); } catch { return false; } }
function clear() { for (const key of keys) localStorage.removeItem(prefix+key); seen.clear(); clearTimeout(timer); document.getElementById('usage-beacon')?.remove(); }
export function setUsageEnabled(enabled: boolean) { try { write('enabled',enabled); if (!usageAllowed()) { clear(); /* Unload any already executing beacon listeners. */ location.reload(); } else beacon(); } catch { /* Storage unavailable. */ } }
function identity(day: string) {
  let value = read('identity',{day:'',id:''});
  if (value.day !== day || !/^[\w-]{16,64}$/.test(value.id)) { value = { day, id: crypto.randomUUID() }; write('identity',value); }
  return value.id;
}
function installed() { return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true; }
function beacon() {
  if (!usageAllowed() || !navigator.onLine || !['freehuntingmap.com','www.freehuntingmap.com'].includes(location.hostname) || document.getElementById('usage-beacon')) return;
  const script = document.createElement('script'); script.id = 'usage-beacon'; script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js'; script.dataset.cfBeacon = JSON.stringify({token:'8066feb4be214817802fafca4b77a683'}); document.head.append(script);
}
function queue(): Entry[] { const min = new Date(Date.now()-7*86400000).toISOString().slice(0,10); return read<Entry[]>('events',[]).filter(e=>e.day>=min).slice(-100); }
export async function flushUsage(keepalive = false) {
  try {
    if (!usageAllowed()) { clear(); return; }
    if (busy || !navigator.onLine) return;
    beacon(); busy = true;
    const pending = read<Open|null>('pending',null);
    if (pending) {
      const response = await fetch('/api/ping',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending),keepalive});
      if (response.ok || response.status === 400) { if (read<Open|null>('pending',null)?.id === pending.id) localStorage.removeItem(prefix+'pending'); }
    }
    const events = queue(); write('events',events);
    // Group by original daily identity; never link IDs from different days in a batch.
    const first = events[0];
    if (first && usageAllowed()) {
      const batch = events.filter(e=>e.id===first.id).slice(0,60);
      const response = await fetch('/api/events',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:first.id,installed:first.installed,version:__APP_VERSION__,events:batch.map(({f,o,day,fw,fm})=>({f,o,day,fw,fm}))}),keepalive});
      if (response.ok || response.status===400) { const current=queue(); let remaining=batch.length; write('events',current.filter(e=>{ if(e.id===first.id && remaining>0) { remaining--; return false; } return true; })); }
    }
  } catch { /* Analytics must never affect the map. */ }
  finally { busy=false; try { if (usageAllowed() && navigator.onLine && queue().length) { clearTimeout(timer); timer=setTimeout(()=>void flushUsage(),10000); } } catch { /* Storage unavailable. */ } }
}
export function useFeature(f: Feature, o?: 'ok'|'fail') {
  try {
    if (!usageAllowed()) { clear(); return; }
    const day = new Date().toISOString().slice(0,10), key=`${day}:${f}:${o ?? ''}`;
    if (['layer_toggle','basemap_change','sync'].includes(f) && seen.has(key)) return;
    seen.add(key);
    const last = read<Record<string,string>>('features',{}), prior=last[f], now=periods(day);
    const events=queue(); events.push({id:identity(day),installed:installed(),day,f,o,fw:!prior || periods(prior).week!==now.week,fm:!prior || periods(prior).month!==now.month});
    write('events',events.slice(-100)); last[f]=day; write('features',last);
    clearTimeout(timer); timer=setTimeout(()=>void flushUsage(),10000);
  } catch { /* Storage unavailable. */ }
}
export function startUsage() {
  try {
    if (!usageAllowed()) { clear(); return; }
    const day=new Date().toISOString().slice(0,10), last=read<string>('last',''), now=periods(day);
    const open: Open={id:identity(day),day,installed:installed(),returning:!!last && last<day,newWeek:!last || periods(last).week!==now.week,newMonth:!last || periods(last).month!==now.month};
    // Keep the older offline open; one pending open is the intentional cap.
    const previous=read<Open|null>('pending',null);
    if (!previous) write('pending',open);
    else if (navigator.onLine) void flushUsage().then(()=>{ try { if (usageAllowed() && !read('pending',null)) { write('pending',open); void flushUsage(); } } catch { /* Storage unavailable. */ } });
    write('last',day);
    window.addEventListener('online',()=>void flushUsage());
    document.addEventListener('visibilitychange',()=>{ if(document.hidden) void flushUsage(true); });
    void flushUsage();
  } catch { /* Storage unavailable. */ }
}
