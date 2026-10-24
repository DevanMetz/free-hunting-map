import { afterEach,it,expect,vi } from 'vitest';
import type { Map } from 'maplibre-gl';
import { layerRegistry } from '../layerRegistry';
import './community';
const def=layerRegistry.get('community-trails')!;
afterEach(()=>vi.unstubAllGlobals());
it('fetches only visible z12 tiles, deduplicates tile features, stops below minzoom and identifies rows',async()=>{
 const feature={type:'Feature',id:'line-a',geometry:{type:'LineString',coordinates:[[-90,40],[-89.999,40]]},properties:{scan_count:3,model:'v4',last_confirmed:'2026-10-24'}};
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({type:'FeatureCollection',features:[feature]})});vi.stubGlobal('fetch',fetcher);
 let zoom=11;const source={setData:vi.fn()};const layers=new Set<string>();const listeners=new globalThis.Map<string,()=>void>();
 const map={getSource:()=>source,addSource:vi.fn(),getLayer:(id:string)=>layers.has(id),addLayer:(l:{id:string})=>layers.add(l.id),on:(event:string,handler:()=>void)=>listeners.set(event,handler),getZoom:()=>zoom,getBounds:()=>({getWest:()=>-90.01,getEast:()=>-89.99,getSouth:()=>39.99,getNorth:()=>40.01}),setLayoutProperty:vi.fn(),setPaintProperty:vi.fn(),queryRenderedFeatures:()=>[feature]} as unknown as Map;
 const ctx={basemap:'topo' as const,setParcelsEnabled:vi.fn()};def.install!(map,ctx);def.setVisible!(map,true,ctx);expect(fetcher).not.toHaveBeenCalled();
 zoom=13;listeners.get('moveend')!();await vi.waitFor(()=>expect(source.setData).toHaveBeenCalled());
 expect(fetcher.mock.calls.every(([path])=>/^\/tiles\/community\/12\/\d+\/\d+\.geojson$/.test(path))).toBe(true);
 expect(source.setData.mock.calls[0]![0].features).toHaveLength(1);
 const count=fetcher.mock.calls.length;def.setVisible!(map,false,ctx);listeners.get('moveend')!();expect(fetcher).toHaveBeenCalledTimes(count);
 expect(await def.identify!(0,0,new AbortController().signal,map,[0,0])).toEqual({title:'Community trails',rows:[['Scans','3'],['Model','v4'],['Last confirmed','2026-10-24']]});
 expect(def.defaultOn).toBe(true);expect(def.cacheStrategy).toBe('NetworkFirst');expect(def.cacheRoute!.test('https://freehuntingmap.com/tiles/community/12/1024/1550.geojson')).toBe(true);
});
