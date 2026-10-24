import { beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache, verifyGoogleToken } from './token';
const pair = await crypto.subtle.generateKey({ name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' },true,['sign','verify']);
const jwk = await crypto.subtle.exportKey('jwk',pair.publicKey);
const fetcher = (async () => Response.json({keys:[{...jwk,kid:'test'}]}, {headers:{'cache-control':'public,max-age=300'}})) as typeof fetch;
const encode = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
async function token(claims: Record<string,unknown> = {}, kid='test') {
  const text = `${encode({alg:'RS256',kid})}.${encode({sub:'one',aud:'client',iss:'https://accounts.google.com',iat:Date.now()/1000,exp:Date.now()/1000+3600,...claims})}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text)));
  return `${text}.${btoa(String.fromCharCode(...signature)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
}
beforeEach(resetJwksCache);
describe('Google ID tokens',()=>{
 it('verifies RSA signatures and claims',async()=>expect(await verifyGoogleToken(await token(),'client',fetcher)).toEqual({sub:'one'}));
 for (const claims of [{aud:'other'},{iss:'evil'},{exp:0},{iat:Date.now()/1000+4000}]) it(`rejects ${JSON.stringify(claims)}`,async()=>expect(verifyGoogleToken(await token(claims),'client',fetcher)).rejects.toThrow());
 it('rejects unknown kid',async()=>expect(verifyGoogleToken(await token({},'missing'),'client',fetcher)).rejects.toThrow('Unknown key'));
 it('rejects bad signature',async()=>{ const good=await token(); const [h,p,s]=good.split('.'); await expect(verifyGoogleToken(`${h}.${p}.${s![0]==='a'?'b':'a'}${s!.slice(1)}`,'client',fetcher)).rejects.toThrow(); });
});
