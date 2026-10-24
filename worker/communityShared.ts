import { ApiError } from './sync';
export async function sha256(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), n=>n.toString(16).padStart(2,'0')).join(''); }
export function moderationSelector(raw: unknown): { query: string; values: (string|number)[] } {
  const r = raw as {id?:unknown;bbox?:unknown}|null;
  if (r && typeof r.id==='string' && /^[\w-]{1,64}$/.test(r.id)) return {query:'id=?',values:[r.id]};
  if (r && Array.isArray(r.bbox) && r.bbox.length===4 && r.bbox.every(v=>typeof v==='number' && Number.isFinite(v)) && r.bbox[0]<r.bbox[2] && r.bbox[1]<r.bbox[3]) {
    const [w,s,e,n]=r.bbox as number[]; return {query:'west<=? AND east>=? AND south<=? AND north>=?',values:[e!,w!,n!,s!]};
  }
  throw new ApiError(400,'Expected id or bbox');
}
