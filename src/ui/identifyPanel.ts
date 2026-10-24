import { communityVotes } from '../community/votes';
import { TRAIL_TYPES, type Vote } from '../community/vote';
import { toast } from './dom';
import type { IdentifyResult } from '../map/layerRegistry';
import type { Sheet } from './sheet';
import { h } from './dom';

export function openIdentifyPanel(sheet: Sheet, key: string, result: IdentifyResult): void {
  const content=h('div', {}, h('dl', { class: 'identify-details' },
    ...result.rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])));
  const id=result.communityLineId, votes=communityVotes;
  if(id && votes){
    const current=votes.get(id);
    let selected=current.vote;
    const real=h('button',{type:'button',class:'btn'},'Real trail');
    const negative=h('button',{type:'button',class:'btn'},'Not a trail');
    const picker=h('select',{'aria-label':'Trail type',title:'Trail type'},h('option',{value:''},'Type'),...TRAIL_TYPES.map(type=>h('option',{value:type},type)));
    picker.value=current.type??'';
    const update=()=>{real.setAttribute('aria-pressed',String(selected==='real'));negative.setAttribute('aria-pressed',String(selected==='not'));picker.disabled=selected===null;};
    const save=async()=>{try{await votes.set({id,vote:selected,type:selected?picker.value as Vote['type']||null:null});}catch{toast('Could not save vote');}};
    real.onclick=()=>{selected=selected==='real'?null:'real';update();void save();};
    negative.onclick=()=>{selected=selected==='not'?null:'not';update();void save();};
    picker.onchange=()=>{void save();};update();
    content.append(h('div',{class:'community-vote'},h('div',{class:'community-vote-buttons'},real,negative),picker));
  }
  sheet.open(key, result.title ?? '', content);
}
