import { communityHikes } from '../community/hikes';
import { communityVotes } from '../community/votes';
import { TRAIL_TYPES, type Vote } from '../community/vote';
import { toast } from './dom';
import type { IdentifyResult } from '../map/layerRegistry';
import type { Sheet } from './sheet';
import { h } from './dom';

export function identifyContent(result: IdentifyResult): HTMLElement {
  const content=h('div', {}, h('dl', { class: 'identify-details' },
    ...result.rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])));
  for (const link of result.links ?? []) if (/^https:\/\//.test(link.url)) {
    content.append(h('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer' }, link.label));
  }
  const id=result.communityLineId, votes=communityVotes;
  if(id && votes){
    const current=votes.get(id);
    let selected: Vote = current;
    const choices: { label: string; vote: Vote['vote']; type: Vote['type'] }[] = [
      { label: 'Game trail', vote: 'real', type: 'game trail' },
      { label: 'ATV / UTV', vote: 'real', type: 'ATV' },
      { label: 'Old logging road', vote: 'real', type: 'logging road / two-track' },
      { label: 'Hiking path', vote: 'real', type: 'hiking path' },
      { label: 'Real trail', vote: 'real', type: null },
      { label: 'Not a trail', vote: 'not', type: null },
    ];
    const otherTypes = TRAIL_TYPES.filter(type => !choices.some(choice => choice.type === type));
    const picker=h('select',{'aria-label':'Other trail type',title:'Other trail type'},h('option',{value:''},'Other type'),...otherTypes.map(type=>h('option',{value:type},type)));
    const buttons=choices.map(choice=>h('button',{type:'button',class:'btn',onclick:()=>{
      select(selected.vote===choice.vote && selected.type===choice.type ? {id,vote:null,type:null} : {id,vote:choice.vote,type:choice.type});
    }},choice.label));
    const update=()=>{
      choices.forEach((choice,i)=>buttons[i]?.setAttribute('aria-pressed',String(selected.vote===choice.vote && selected.type===choice.type)));
      picker.value=selected.type && otherTypes.includes(selected.type) ? selected.type : '';
    };
    const select=(next:Vote)=>{selected=next;update();void votes.set(next).catch(()=>{selected=votes.get(id);update();toast('Could not save vote');});};
    picker.onchange=()=>{if(picker.value)select({id,vote:'real',type:picker.value as Vote['type']});};update();
    content.append(h('div',{class:'community-vote'},h('div',{class:'community-vote-buttons'},...buttons),picker));
  }
  if(result.communityHikeId && communityHikes){
    const hikeId=result.communityHikeId,hikes=communityHikes;
    const report=h('button',{type:'button',class:'btn',onclick:()=>{
      report.disabled=true;
      void hikes.report(hikeId).then(()=>{report.textContent='Reported';}).catch(()=>{report.disabled=false;toast('Could not save report');});
    }},'Report');
    void hikes.reported(hikeId).then(reported=>{report.disabled=reported;if(reported)report.textContent='Reported';});
    content.append(report);
  }
  return content;
}

export function openIdentifyPanel(sheet: Sheet, key: string, result: IdentifyResult): void {
  sheet.open(key, result.title ?? '', identifyContent(result));
}
