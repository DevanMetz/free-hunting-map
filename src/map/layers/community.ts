import { communityVotes } from '../../community/votes';
import { registerLayer } from '../layerRegistry';
import { communityLoader } from './communityLoader';
const ID='community-trails';
const loader=communityLoader(ID,'/tiles/community/12');
registerLayer({
  id:ID,category:'trails',name:'Community trails',swatch:'#00b8c7',defaultOn:true,defaultOpacity:1,minzoom:12,
  attribution:'Free Hunting Map community',cacheRoute:/\/tiles\/community\/12\/\d+\/\d+\.geojson(?:\?|$)/,cacheStrategy:'NetworkFirst',layerIds:[ID],
  install(map,ctx){
    if(!map.getSource(ID))map.addSource(ID,{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'Free Hunting Map community'});
    if(!map.getLayer(ID))map.addLayer({id:ID,type:'line',source:ID,minzoom:12,paint:{'line-color':'#00b8c7','line-width':['interpolate',['linear'],['get','scan_count'],1,2,5,4,20,6],'line-opacity':['interpolate',['linear'],['get','scan_count'],1,.55,5,.9,20,1]}},ctx.beforeId);
    const filter=()=>{if(map.getLayer(ID))map.setFilter(ID,['!', ['in', ['get','id'], ['literal', communityVotes?.hiddenIds() ?? []]]]);};
    filter();
    communityVotes?.addEventListener('change',filter);
    loader.install(map);
  },
  setVisible(map,on){loader.visible(map,on);},
  setOpacity(map,opacity){if(map.getLayer(ID))map.setPaintProperty(ID,'line-opacity',['*',opacity,['interpolate',['linear'],['get','scan_count'],1,.55,5,.9,20,1]]);},
  identifyPresentation:'sheet',
  async identify(_lng,_lat,_signal,map,point){
    if(!map.getLayer(ID))return null;
    const p=map.queryRenderedFeatures(point,{layers:[ID]})[0]?.properties;
    return p?{communityLineId:String(p.id),title:'Community trails',rows:[['Scans',String(p.scan_count)],['Model',String(p.model)],['Last confirmed',String(p.last_confirmed)]]}:null;
  },
});
