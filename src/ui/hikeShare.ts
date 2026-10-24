import { bbox } from '../community/geometry';
import { decodeHike, encodeHike, HIKE_TYPES, randomHikeToken, trimHike, type Hike } from '../community/hike';
import { formatDistance } from '../map/geo';
import type { Track } from '../types';
import type { AppContext } from './context';
import { h, toast } from './dom';
export function hikeShareControl(ctx:AppContext,track:Track) {
  const root=h('div',{class:'form hike-share-control'});
  let closed=false;
  const close=()=>{closed=true;ctx.map.setSketch([]);};
  const render=async()=>{
    const current=await ctx.repo.hikeShare(track.id);
    if(closed)return;
    root.classList.remove('hike-share-open');
    root.replaceChildren();
    if(current?.shared) {
      root.append(h('button',{type:'button',class:'btn',onclick:()=>{
        void ctx.repo.saveHikeShare({...current,shared:false}).then(()=>render()).catch(()=>toast('Could not unshare hike'));
      }},'Unshare from community'));
      return;
    }
    const open=h('button',{type:'button',class:'btn',onclick:()=>{
      root.classList.add('hike-share-open');
      const name=h('input',{class:'field',placeholder:'Public name', 'aria-label':'Public name',maxlength:60,value:''});
      const type=h('select',{class:'field','aria-label':'Hike type'},h('option',{value:''},'Type'),...HIKE_TYPES.map(t=>h('option',{value:t},t)));
      const trim=h('input',{type:'range',min:100,max:500,step:50,value:200,'aria-label':'Trim each end (meters)',title:'Trim each end (meters)'});
      const amount=h('output',{},'200 m');
      const trimEnds=h('input',{type:'checkbox',checked:true});
      const trimControl=h('div',{class:'hike-trim'},trim,amount);
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
        trimControl.hidden=!trimEnds.checked;
        const coords=trimHike(track.coords,trimEnds.checked?Number(trim.value):0);
        amount.value=`${trim.value} m`;
        ctx.map.setSketch(coords,'#b85cff');
        if(coords.length) {
          const [w,s,e,n]=bbox(coords);
          const height=root.closest('.sheet-body')?.parentElement?.getBoundingClientRect().height??400;
          const padding=window.innerWidth>=760?{left:440,right:80,top:40,bottom:40}:{left:30,right:30,top:30,bottom:Math.min(height+80,window.innerHeight-120)};
          ctx.map.map?.fitBounds([[w,s],[e,n]],{padding,maxZoom:16,duration:350});
        }
        try { wire=encodeHike(coords,month);const hike=decodeHike(wire);preview.textContent=`${formatDistance(hike.distance).imperial} · ${new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'})}`;submit.disabled=false; }
        catch { wire=undefined;preview.textContent='Too short to share';submit.disabled=true; }
      };
      trim.oninput=update;
      trimEnds.onchange=update;
      root.replaceChildren(name,type,h('label',{class:'row'},trimEnds,'Trim ends'),trimControl,preview,h('div',{class:'actions'},h('button',{type:'button',class:'btn',onclick:()=>{ctx.map.setSketch([]);void render();}},'Cancel'),submit));
      update();
    }},'Share to community');
    root.append(open);
  };
  void render();
  return {element:root,close};
}
