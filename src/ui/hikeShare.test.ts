// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { it,expect,vi } from 'vitest';
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
 expect(map.setSketch.mock.calls.at(-1)![0][0][0]).toBeGreaterThan(-90);
 const trim=ui.element.querySelector<HTMLInputElement>('input[type=range]')!;trim.value='500';trim.dispatchEvent(new Event('input'));
 expect(ui.element.textContent).toContain('500 m');
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
 expect(Array.from(ui.element.querySelectorAll('button')).find(b=>b.textContent==='Share to community')!.disabled).toBe(true);
});
