import { communityVotes } from '../../community/votes';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { FeatureCollection, Feature, LineString } from 'geojson';
import { registerLayer } from '../layerRegistry';
import { tiles } from '../../community/geometry';
const ID='community-trails';
const loaders=new WeakMap<Map,{update:()=>void;on:boolean}>();
registerLayer({
  id:ID,category:'trails',name:'Community trails',swatch:'#00b8c7',defaultOn:true,defaultOpacity:1,minzoom:12,
  attribution:'Free Hunting Map community',cacheRoute:/\/tiles\/community\/12\/\d+\/\d+\.geojson(?:\?|$)/,cacheStrategy:'NetworkFirst',layerIds:[ID],
  install(map,ctx){
    if(!map.getSource(ID))map.addSource(ID,{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'Free Hunting Map community'});
    if(!map.getLayer(ID))map.addLayer({id:ID,type:'line',source:ID,minzoom:12,paint:{'line-color':'#00b8c7','line-width':['interpolate',['linear'],['get','scan_count'],1,2,5,4,20,6],'line-opacity':['interpolate',['linear'],['get','scan_count'],1,.55,5,.9,20,1]}},ctx.beforeId);
    const filter=()=>{if(map.getLayer(ID))map.setFilter(ID,['!', ['in', ['get','id'], ['literal', communityVotes?.hiddenIds() ?? []]]]);};
    filter();
    if(!loaders.has(map)){
      communityVotes?.addEventListener('change',filter);
      let controller:AbortController|undefined;
      const loader={on:true,update:()=>{
        controller?.abort();
        if(!loader.on||map.getZoom()<12)return;
        const bounds=map.getBounds(),west=Math.max(-180,bounds.getWest()),east=Math.min(180,bounds.getEast());
        if(west>=east)return;
        const keys=tiles([west,Math.max(-85,bounds.getSouth()),east,Math.min(85,bounds.getNorth())]);
        if(keys.length>100)return;
        controller=new AbortController();const signal=controller.signal;
        void Promise.all(keys.map(async key=>{try{const r=await fetch(`/tiles/community/12/${key}.geojson`,{signal,credentials:'omit'});return r.ok?await r.json() as FeatureCollection<LineString>:null;}catch{return null;}})).then(collections=>{
          if(signal.aborted)return;
          const features=new globalThis.Map<string,Feature<LineString>>();
          for(const collection of collections)for(const f of collection?.features??[])features.set(String(f.id),f);
          (map.getSource(ID) as GeoJSONSource|undefined)?.setData({type:'FeatureCollection',features:[...features.values()]});
        });
      }};
      loaders.set(map,loader);map.on('moveend',loader.update);
    }
  },
  setVisible(map,on){if(map.getLayer(ID))map.setLayoutProperty(ID,'visibility',on?'visible':'none');const loader=loaders.get(map);if(loader){loader.on=on;loader.update();}},
  setOpacity(map,opacity){if(map.getLayer(ID))map.setPaintProperty(ID,'line-opacity',['*',opacity,['interpolate',['linear'],['get','scan_count'],1,.55,5,.9,20,1]]);},
  identifyPresentation:'sheet',
  async identify(_lng,_lat,_signal,map,point){
    if(!map.getLayer(ID))return null;
    const p=map.queryRenderedFeatures(point,{layers:[ID]})[0]?.properties;
    return p?{communityLineId:String(p.id),title:'Community trails',rows:[['Scans',String(p.scan_count)],['Model',String(p.model)],['Last confirmed',String(p.last_confirmed)]]}:null;
  },
});
