import { decodeHike, encodeHike, HIKE_TYPES, randomHikeToken, trimHike, type Hike } from '../community/hike';
import { formatDistance } from '../map/geo';
import type { Track } from '../types';
import type { AppContext } from './context';
import { h, toast } from './dom';
export function hikeShareControl(ctx:AppContext,track:Track) {
  const root=h('div',{class:'form'});
  let closed=false;
  const close=()=>{closed=true;ctx.map.setSketch([]);};
  const render=async()=>{
    const current=await ctx.repo.hikeShare(track.id);
    if(closed)return;
    root.replaceChildren();
    if(current?.shared) {
      root.append(h('button',{type:'button',class:'btn',onclick:()=>{
        void ctx.repo.saveHikeShare({...current,shared:false}).then(()=>render()).catch(()=>toast('Could not unshare hike'));
      }},'Unshare from community'));
      return;
    }
    const open=h('button',{type:'button',class:'btn',onclick:()=>{
      const name=h('input',{class:'field',placeholder:'Public name', 'aria-label':'Public name',maxlength:60,value:''});
      const type=h('select',{class:'field','aria-label':'Hike type'},h('option',{value:''},'Type'),...HIKE_TYPES.map(t=>h('option',{value:t},t)));
      const trim=h('input',{type:'range',min:100,max:500,step:50,value:200,'aria-label':'Trim each end (meters)',title:'Trim each end (meters)'});
      const amount=h('output',{},'200 m');
      const preview=h('div',{class:'row'});
      const month=new Date(track.createdAt).toISOString().slice(0,7);
      let wire:ReturnType<typeof encodeHike>|undefined;
      const submit=h('button',{type:'button',class:'btn primary',onclick:()=>{
        if(!wire)return;
        submit.disabled=true;
        const payload=encodeHike(decodeHike(wire).coordinates,month,name.value,type.value as Hike['type']||null);
        void ctx.repo.saveHikeShare({trackId:track.id,shareId:randomHikeToken(),secret:randomHikeToken(),shared:true,hike:payload}).then(()=>{ctx.map.setSketch([]);return render();}).catch(()=>{submit.disabled=false;toast('Could not share hike');});
      }},'Share to community');
      const update=()=>{
        const coords=trimHike(track.coords,Number(trim.value));
        amount.value=`${trim.value} m`;
        ctx.map.setSketch(coords,'#b85cff');
        try { wire=encodeHike(coords,month);const hike=decodeHike(wire);preview.textContent=`${formatDistance(hike.distance).imperial} · ${new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'})}`;submit.disabled=false; }
        catch { wire=undefined;preview.textContent='Too short to share';submit.disabled=true; }
      };
      trim.oninput=update;
      root.replaceChildren(name,type,h('div',{class:'hike-trim'},trim,amount),preview,h('div',{class:'actions'},h('button',{type:'button',class:'btn',onclick:()=>{ctx.map.setSketch([]);void render();}},'Cancel'),submit));
      update();
    }},'Share to community');
    root.append(open);
  };
  void render();
  return {element:root,close};
}
