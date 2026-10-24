// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { it,expect,vi } from 'vitest';
import { decodeHike } from '../community/hike';
import { haversine, pathLength, formatDistance } from '../map/geo';
import { simplify } from '../community/geometry';
import { Repo } from '../storage/repo';
import { hikeShareControl } from './hikeShare';
import type { AppContext } from './context';
import type { Track } from '../types';
it('previews only the trimmed line, starts with blank public name, shares then offers unshare',async()=>{
 const repo=await Repo.open(crypto.randomUUID()),map={setSketch:vi.fn()};
 const track=await repo.create<Track>({kind:'track',name:'Private home',note:'secret',recorded:true,coords:[[-90,40],[-89.98,40]]});
 const ui=hikeShareControl({repo,map} as unknown as AppContext,track);
 await vi.waitFor(()=>expect(ui.element.textContent).toBe('Share to community'));
 ui.element.querySelector('button')!.click();
 expect(ui.element.querySelector<HTMLInputElement>('input[type=text],input.field')!.value).toBe('');
 const toggle=ui.element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
 expect(toggle.checked).toBe(true);
 expect(haversine(track.coords[0]!,map.setSketch.mock.calls.at(-1)![0][0])).toBeCloseTo(200,0);
 const trim=ui.element.querySelector<HTMLInputElement>('input[type=range]')!;expect(trim.value).toBe('200');trim.value='500';trim.dispatchEvent(new Event('input'));
 expect(ui.element.textContent).toContain('500 m');
 expect(haversine(track.coords[0]!,map.setSketch.mock.calls.at(-1)![0][0])).toBeCloseTo(500,0);
 const submit=Array.from(ui.element.querySelectorAll('button')).find(b=>b.textContent==='Share to community')!;expect(submit.disabled).toBe(false);submit.click();
 await vi.waitFor(()=>expect(ui.element.textContent).toBe('Unshare from community'));
 expect((await repo.hikeShare(track.id))!.hike.name).toBe('');
 ui.element.querySelector('button')!.click();await vi.waitFor(async()=>expect((await repo.hikeShare(track.id))!.shared).toBe(false));
 ui.close();expect(map.setSketch).toHaveBeenLastCalledWith([]);
});
it('disables sharing when the trimmed recording is too short',async()=>{
 const repo=await Repo.open(crypto.randomUUID()),track=await repo.create<Track>({kind:'track',name:'',note:'',recorded:true,coords:[[-90,40],[-89.996,40]]});
 const ui=hikeShareControl({repo,map:{setSketch:vi.fn()}} as unknown as AppContext,track);
 await vi.waitFor(()=>expect(ui.element.querySelector('button')).toBeTruthy());ui.element.querySelector('button')!.click();
 const submit=Array.from(ui.element.querySelectorAll('button')).find(b=>b.textContent==='Share to community')!;
 expect(submit.disabled).toBe(true);
 const toggle=ui.element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
 toggle.checked=false;toggle.dispatchEvent(new Event('change'));expect(submit.disabled).toBe(false);
 toggle.checked=true;toggle.dispatchEvent(new Event('change'));expect(submit.disabled).toBe(true);
});

it('updates both previews live when toggled and shares full geometry without point metadata',async()=>{
 const repo=await Repo.open(crypto.randomUUID()),map={setSketch:vi.fn()};
 const track=await repo.create<Track>({kind:'track',name:'Private',note:'',recorded:true,coords:[[-90,40],[-89.99,40.000001],[-89.98,40]]});
 // Exercise the sharing boundary even if a richer recording reaches this UI in future.
 const rich={...track,coords:track.coords.map(p=>[...p,345,123456789])} as unknown as Track;
 const ui=hikeShareControl({repo,map} as unknown as AppContext,rich);
 await vi.waitFor(()=>expect(ui.element.querySelector('button')).toBeTruthy());ui.element.querySelector('button')!.click();
 const toggle=ui.element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
 const slider=ui.element.querySelector<HTMLInputElement>('input[type=range]')!;
 const control=slider.parentElement!,preview=control.nextElementSibling!;
 const trimmedPreview=preview.textContent;
 slider.value='500';slider.dispatchEvent(new Event('input'));
 expect(preview.textContent).not.toBe(trimmedPreview);
 toggle.checked=false;toggle.dispatchEvent(new Event('change'));
 expect(control.hidden).toBe(true);
 const full=simplify(track.coords);
 expect(map.setSketch).toHaveBeenLastCalledWith(full,'#b85cff');
 expect(preview.textContent).toBe(`${formatDistance(Math.round(pathLength(full))).imperial} · ${new Date(track.createdAt).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'})}`);
 toggle.checked=true;toggle.dispatchEvent(new Event('change'));
 expect(control.hidden).toBe(false);expect(slider.value).toBe('500');
 expect(haversine(track.coords[0]!,map.setSketch.mock.calls.at(-1)![0][0])).toBeCloseTo(500,0);
 toggle.checked=false;toggle.dispatchEvent(new Event('change'));
 Array.from(ui.element.querySelectorAll('button')).find(b=>b.textContent==='Share to community')!.click();
 await vi.waitFor(()=>expect(ui.element.textContent).toBe('Unshare from community'));
 const shared=decodeHike((await repo.hikeShare(track.id))!.hike);
 expect(shared.coordinates).toEqual(full);expect(shared.coordinates.every(p=>p.length===2)).toBe(true);
});
