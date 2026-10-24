import { registerLayer } from '../layerRegistry';
import { formatDistance } from '../geo';
import { communityLoader } from './communityLoader';
const ID='community-hikes',loader=communityLoader(ID,'/tiles/community-hikes/12');
registerLayer({
  id:ID,category:'trails',name:'Community hikes',swatch:'#b85cff',defaultOn:true,defaultOpacity:1,minzoom:12,
  attribution:'Free Hunting Map community',cacheRoute:/\/tiles\/community-hikes\/12\/\d+\/\d+\.geojson(?:\?|$)/,cacheStrategy:'NetworkFirst',layerIds:[ID],
  install(map,ctx){
    if(!map.getSource(ID))map.addSource(ID,{type:'geojson',data:{type:'FeatureCollection',features:[]},attribution:'Free Hunting Map community'});
    if(!map.getLayer(ID))map.addLayer({id:ID,type:'line',source:ID,minzoom:12,paint:{'line-color':'#b85cff','line-width':3,'line-dasharray':[3,2],'line-opacity':.9}},ctx.beforeId);
    loader.install(map);
  },
  setVisible(map,on){loader.visible(map,on);},
  setOpacity(map,opacity){if(map.getLayer(ID))map.setPaintProperty(ID,'line-opacity',opacity*.9);},
  identifyPresentation:'sheet',
  async identify(_lng,_lat,_signal,map,point){
    if(!map.getLayer(ID))return null;
    const p=map.queryRenderedFeatures(point,{layers:[ID]})[0]?.properties;
    if(!p)return null;
    const rows:[string,string][]=[['Distance',formatDistance(Number(p.distance)).imperial],['Month',String(p.month)]];
    if(p.type)rows.push(['Type',String(p.type)]);
    return {communityHikeId:String(p.id),title:p.name?String(p.name):'Community hike',rows};
  },
});
