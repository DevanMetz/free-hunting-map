import { it,expect } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('streams the hikes dataset into hikes.geojson alongside existing datasets',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fhm-hikes-'));
 const feature={type:'Feature',geometry:{type:'LineString',coordinates:[[-90,40],[-89.99,40]]},properties:{dataset:'hikes',source:'gps_track',label:'positive'}};
 const server=createServer((req,res)=>{
   expect(req.headers.authorization).toBe('Bearer test-token');
   res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.end(JSON.stringify(feature)+'\n');
 });
 try {
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 await promisify(execFile)(process.execPath,['scripts/community-export.mjs','--url',`http://127.0.0.1:${port}`,'--out',dir],{env:{...process.env,FHM_ADMIN_TOKEN:'test-token'}});
 expect(JSON.parse(await readFile(join(dir,'hikes.geojson'),'utf8')).features).toEqual([feature]);
 for(const name of ['scan_lines','labeled_lines','votes'])expect(JSON.parse(await readFile(join(dir,`${name}.geojson`),'utf8')).features).toEqual([]);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
