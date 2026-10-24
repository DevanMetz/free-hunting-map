import { it,expect } from 'vitest';
import { mergeScan,confirms,tiles,type Scan,type CommunityLine } from './geometry';
const scan:Scan={model:'v4',day:'2026-10-20',area:[-90.01,39.99,-89.99,40.01],lines:[{confidence:.8,coordinates:[[-90,40],[-89.999,40]]}]};
it('confirms overlapping lines once per scan and counts distinct scans',()=>{
 let n=0;const id=()=>String(++n);
 const first=mergeScan({...scan,lines:[...scan.lines,...scan.lines]},[],id);expect(first).toHaveLength(1);expect(first[0]!.scan_count).toBe(1);
 const second=mergeScan({...scan,lines:[...scan.lines,...scan.lines]},first,id);expect(second).toHaveLength(1);expect(second[0]!.scan_count).toBe(2);
 const third=mergeScan({...scan,day:'2026-10-21',lines:scan.lines.map(l=>({...l,confidence:.2}))},second,id);expect(third[0]).toMatchObject({scan_count:3,last_confirmed:'2026-10-21',confidence:.6});
});
it('keeps distant parallel trails and crossings separate',()=>{
 const existing=mergeScan(scan,[],()=> 'a');
 const nearby:Scan={...scan,lines:[{confidence:.7,coordinates:[[-90,40.0002],[-89.999,40.0002]]}]};
 expect(mergeScan(nearby,existing,()=> 'b')[0]!.id).toBe('b');
 expect(confirms([[-89.9995,39.999],[-89.9995,40.001]],scan.lines[0]!.coordinates)).toBe(false);
 expect(confirms([[-90,40.00003],[-89.999,40.00003]],scan.lines[0]!.coordinates)).toBe(true);
});
it('does not mutate existing records and indexes crossed tiles',()=>{
 const existing=mergeScan(scan,[],()=> 'a') as CommunityLine[];mergeScan(scan,existing,()=> 'b');expect(existing[0]!.scan_count).toBe(1);expect(tiles([-90.1,39.9,-89.9,40.1]).length).toBeGreaterThan(1);
});
