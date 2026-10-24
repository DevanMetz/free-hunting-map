import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { FeatureCollection, Feature, LineString } from 'geojson';
import { tiles } from '../../community/geometry';
/** Shared viewport loader for anonymous community GeoJSON tile layers. */
export function communityLoader(id:string,path:string) {
  const loaders=new WeakMap<Map,{update:()=>void;on:boolean}>();
  return {
    install(map:Map) {
      if(loaders.has(map))return;
      let controller:AbortController|undefined;
      const loader={on:true,update:()=>{
        controller?.abort();
        if(!loader.on||map.getZoom()<12)return;
        const bounds=map.getBounds(),west=Math.max(-180,bounds.getWest()),east=Math.min(180,bounds.getEast());
        if(west>=east)return;
        const keys=tiles([west,Math.max(-85,bounds.getSouth()),east,Math.min(85,bounds.getNorth())]);
        if(keys.length>100)return;
        controller=new AbortController();const signal=controller.signal;
        void Promise.all(keys.map(async key=>{try{const r=await fetch(`${path}/${key}.geojson`,{signal,credentials:'omit'});return r.ok?await r.json() as FeatureCollection<LineString>:null;}catch{return null;}})).then(collections=>{
          if(signal.aborted)return;
          const features=new globalThis.Map<string,Feature<LineString>>();
          for(const collection of collections)for(const f of collection?.features??[])features.set(String(f.id),f);
          (map.getSource(id) as GeoJSONSource|undefined)?.setData({type:'FeatureCollection',features:[...features.values()]});
        });
      }};
      loaders.set(map,loader);map.on('moveend',loader.update);
      globalThis.addEventListener?.('community-hikes-change',loader.update);
    },
    visible(map:Map,on:boolean) {
      if(map.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');
      const loader=loaders.get(map);if(loader){loader.on=on;loader.update();}
    },
  };
}
