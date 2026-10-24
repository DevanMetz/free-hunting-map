#!/usr/bin/env node
// Usage: FHM_ADMIN_TOKEN=... node scripts/community-export.mjs [--out directory]
// Or: node scripts/community-export.mjs --token-file /path/to/secret [--url https://freehuntingmap.com]
import { readFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
const args=process.argv.slice(2);
const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const token=value('--token-file')?(await readFile(value('--token-file'),'utf8')).trim():process.env.FHM_ADMIN_TOKEN;
if(!token)throw new Error('Set FHM_ADMIN_TOKEN or --token-file');
const response=await fetch(new URL('/api/community/export',value('--url')??'https://freehuntingmap.com'),{headers:{Authorization:`Bearer ${token}`}});
if(!response.ok)throw new Error(`Export failed: HTTP ${response.status}`);
const out=value('--out')??'community-export';await mkdir(out,{recursive:true});
const streams=Object.fromEntries(['scan_lines','labeled_lines','votes','hikes'].map(k=>[k,createWriteStream(join(out,`${k}.geojson`),{mode:0o600})]));
const first=new Set(Object.keys(streams));
async function write(stream,text){if(!stream.write(text))await once(stream,'drain');}
for(const stream of Object.values(streams))await write(stream,'{"type":"FeatureCollection","features":[\n');
let pending='';
const decoder=new TextDecoder();
async function consume(line){if(!line.trim())return;const feature=JSON.parse(line),key=feature.properties.dataset;const stream=streams[key];if(!stream)throw new Error('Unknown dataset');await write(stream,(first.delete(key)?'':',\n')+JSON.stringify(feature));}
for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){await consume(pending.slice(0,i));pending=pending.slice(i+1);}}
pending+=decoder.decode();await consume(pending);
await Promise.all(Object.values(streams).map(async stream=>{stream.end('\n]}\n');await once(stream,'finish');}));
console.log(`Exported to ${out}`);
