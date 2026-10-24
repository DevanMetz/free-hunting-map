// @vitest-environment happy-dom
import { it,expect,vi,afterEach } from 'vitest';
import { trailDetails } from '../map/trails';
import { Sheet } from './sheet';
import { openIdentifyPanel } from './identifyPanel';
const state=vi.hoisted(()=>({vote:null as 'real'|'not'|null,type:null as string|null}));
const set=vi.hoisted(()=>vi.fn(async(v:{vote:'real'|'not'|null;type:string|null})=>{state.vote=v.vote;state.type=v.type;}));
vi.mock('../community/votes',()=>({communityVotes:{get:()=>state,set}}));
afterEach(()=>{document.body.replaceChildren();state.vote=null;state.type=null;set.mockClear();});
it('supports voting, type changes, reopening selected state and clearing without helper labels',async()=>{
 const root=document.createElement('section');document.body.append(root);const sheet=new Sheet(root);
 const result={communityLineId:'trail',title:'Community trails',rows:[]};
 openIdentifyPanel(sheet,'community-trails',result);
 const buttons=root.querySelectorAll<HTMLButtonElement>('.community-vote button'),picker=root.querySelector<HTMLSelectElement>('select')!;
 expect(buttons).toHaveLength(2);expect(picker.disabled).toBe(true);
 buttons[0]!.click();expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');expect(picker.disabled).toBe(false);
 picker.value='skid trail';picker.dispatchEvent(new Event('change'));await vi.waitFor(()=>expect(set).toHaveBeenLastCalledWith({id:'trail',vote:'real',type:'skid trail'}));
 openIdentifyPanel(sheet,'community-trails',result);
 expect(root.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Real trail');expect(root.querySelector('select')!.value).toBe('skid trail');
 root.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!.click();await vi.waitFor(()=>expect(set).toHaveBeenLastCalledWith({id:'trail',vote:null,type:null}));
 expect(picker.getAttribute('aria-label')).toBe('Trail type');expect(picker.title).toBe('Trail type');
});

it('renders trail information as accessible plain text with only populated rows', () => {
  const root = document.createElement('section');
  const sheet = new Sheet(root);
  openIdentifyPanel(sheet, 'public-trails', trailDetails({ name: '<img src=x>', type: 'bike', uses: 'Hike, Bike', agency: 'BLM', src: 'blm_gtlf', date: '2026-10-24' }));
  expect(root.hidden).toBe(false); expect(sheet.current).toBe('public-trails');
  expect(root.querySelector('h2')?.textContent).toBe('<img src=x>'); expect(root.querySelector('img')).toBeNull();
  expect([...root.querySelectorAll('dt')].map(row => row.textContent)).toEqual(['Type', 'Allowed uses', 'Agency', 'Source']);
  expect([...root.querySelectorAll('dd')].map(row => row.textContent)).toEqual(['Bike trail', 'Hike, Bike', 'BLM', 'BLM Ground Transportation · 2026-10-24']);
  root.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(); expect(root.hidden).toBe(true);
});
