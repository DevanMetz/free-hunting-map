import { it, expect } from 'vitest';
import { trimHike, encodeHike, decodeHike } from './hike';
import { pathLength, haversine } from '../map/geo';
import { sanitizeRecord } from '../sync/records';
import { simplify, type Point } from './geometry';
const coords:Point[]=[[-90,40],[-89.99,40],[-89.98,40]];
it('cuts exact along-track distances at both ends and supports adjustable trimming',()=>{
 for(const trim of [100,200,500]){
 const result=trimHike(coords,trim);
 expect(haversine(coords[0]!,result[0]!)).toBeCloseTo(trim,0);
 expect(pathLength(result)).toBeCloseTo(pathLength(coords)-2*trim,0);
 }
 expect(trimHike([[-90,40],[-89.995,40]])).toEqual([]);
 expect(trimHike(coords,99)).toEqual([]);
});
it.each([0, 200])('strips elevations and timestamps, sanitizes names and validates wire data (trim %s)',trim=>{
 const rich=[[-90,40,300,1234],[-89.98,40,400,3456]] as unknown as Point[];
 const wire=encodeHike(trimHike(rich,trim),'2026-10','\u0000Public\n name\u202e','hike');
 const result=decodeHike(wire);
 expect(result.name).toBe('Public name');expect(result.coordinates.every(p=>p.length===2)).toBe(true);
 expect(Object.keys(wire)).toEqual(['v','month','name','type','d']);
 for(const patch of [{month:'2099-01'},{month:'2026-13'},{name:'x'.repeat(61)},{name:'a\nb'},{type:'unknown'},{d:[0,0,1,1]},{d:[-90000000,40000000,.5,0]},{d:Array(20002).fill(0)},{timestamp:1},{v:2}])expect(()=>decodeHike({...wire,...patch})).toThrow();
});
it('keeps ownership credentials in a separate sanitized synced record',()=>{
 const r={kind:'community-hike',id:'a'.repeat(64),shareId:'a'.repeat(64),secret:'b'.repeat(64),trackId:'private-track',shared:true,hike:encodeHike(coords,'2026-10'),createdAt:1,updatedAt:2,deviceId:'device',deleted:false};
 expect(sanitizeRecord(r)).toEqual(r);
 expect(sanitizeRecord({...r,secret:'short'})).toBeNull();
});

it('shares the full simplified line with original endpoints when trimming is off',()=>{
 const rich=[[-90,40,300,1234],[-89.99,40.000001,350,2345],[-89.98,40,400,3456]] as unknown as Point[];
 const expected=simplify(rich.map(p=>[p[0],p[1]]));
 expect(trimHike(rich,0)).toEqual(expected);
 expect(decodeHike(encodeHike(trimHike(rich,0),'2026-10')).coordinates).toEqual(expected);
 expect(trimHike([[-90,40],[-89.996,40]],0)).toHaveLength(2);
});
