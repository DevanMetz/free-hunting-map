import { describe,it,expect } from 'vitest';
import { encode,decode } from './codec';
import { simplify, type Scan } from './geometry';
export const scan=():Scan=>({model:'v4',day:new Date().toISOString().slice(0,10),area:[-90.01,39.99,-89.99,40.01],lines:[{confidence:.8,coordinates:[[-90,40],[-89.999,40]]}]});
describe('anonymous scan wire boundary',()=>{
 it('round trips delta coordinates and simplifies in metres',()=>{
  expect(decode(encode(scan()))).toEqual(scan());
  expect(simplify([[-90,40],[-89.9995,40.000001],[-89.999,40]])).toHaveLength(2);
  expect(simplify([[-90,40],[-89.9995,40.0001],[-89.999,40]])).toHaveLength(3);
 });
 it('validates model, date, bounds, confidence and structure',()=>{
  const valid=encode(scan());
  for(const raw of [null,{}, {...valid,v:2},{...valid,model:'arbitrary model'}, {...valid,day:'2099-01-01'},{...valid,day:'2000-01-01'},{...valid,day:'2026-02-30'},{...valid,area:[-91,39,-89,41]}, {...valid,area:[0,0,.01,.01]}, {...valid,area:[-90.001,39.99,-89.99,40.01]}, {...valid,lines:[{c:NaN,d:[-90000000,40000000,100,0]}]}, {...valid,lines:[{c:1.1,d:[1,2,3,4]}]}, {...valid,lines:[{c:.8,d:[1,2,3]}]}, {...valid,lines:[{c:.8,d:[-90000000,40000000,0,0]}]}, {...valid,lines:[{c:.8,d:[-90000000,40000000,1000000,0]}]}])expect(()=>decode(raw)).toThrow();
 });
 it('caps line and vertex counts and rejects noninteger deltas',()=>{
  const valid=encode(scan()),l=valid.lines[0]!;
  for(const lines of [[],Array(201).fill(l),[{...l,d:Array(4002).fill(0)}],Array(11).fill({...l,d:Array(4000).fill(0)}),[{...l,d:[-90000000,40000000,.5,0]}]])expect(()=>decode({...valid,lines})).toThrow();
 });
});
