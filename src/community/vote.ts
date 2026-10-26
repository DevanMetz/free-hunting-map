/** Public vote hiding: negative votes must exceed positive votes by this margin. */
export const HIDE_MARGIN = 2;
export const TRAIL_TYPES = ['logging road / two-track', 'foot / game trail', 'game trail', 'hiking path', 'ATV', 'skid trail', 'fire break', 'ditch / other non-trail'] as const;
export type TrailType = typeof TRAIL_TYPES[number];
export interface Vote { id: string; vote: 'real' | 'not' | null; type: TrailType | null }
export function validateVote(raw: unknown): Vote & { token: string } {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Object.keys(r).some(k => !['id','vote','type','token'].includes(k)) || typeof r.id !== 'string' || !/^[\w-]{1,64}$/.test(r.id)
    || typeof r.token !== 'string' || !/^[a-f0-9]{64}$/.test(r.token) || !['real','not',null].includes(r.vote as string | null)
    || !(r.type === null || TRAIL_TYPES.includes(r.type as TrailType)) || (r.vote === null && r.type !== null)) throw new Error('Invalid vote');
  return {id:r.id, token:r.token, vote:r.vote as Vote['vote'], type:r.type as TrailType | null};
}
export function hidden(real: number, negative: number, override: string | null = null) {
  return override === 'hide' || (override !== 'show' && negative - real >= HIDE_MARGIN);
}
