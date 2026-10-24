import { it,expect } from 'vitest';
import { validateVote,hidden,HIDE_MARGIN,TRAIL_TYPES } from './vote';
const valid={id:'line-1',token:'a'.repeat(64),vote:'real',type:null};
it('strictly validates anonymous votes, optional types and clearing',()=>{
 expect(validateVote(valid)).toEqual(valid);
 for(const type of TRAIL_TYPES)expect(validateVote({...valid,type}).type).toBe(type);
 expect(validateVote({...valid,vote:null}).vote).toBeNull();
 for(const patch of [{id:'bad/id'},{token:'short'},{token:'A'.repeat(64)},{vote:'yes'},{vote:undefined},{type:'unknown'},{type:undefined},{vote:null,type:TRAIL_TYPES[0]},{userId:'private'}])expect(()=>validateVote({...valid,...patch})).toThrow();
});
it('uses the hiding margin and gives overrides precedence',()=>{
 expect(hidden(0,HIDE_MARGIN-1)).toBe(false);expect(hidden(0,HIDE_MARGIN)).toBe(true);
 expect(hidden(4,5)).toBe(false);expect(hidden(4,6)).toBe(true);
 expect(hidden(0,10,'show')).toBe(false);expect(hidden(10,0,'hide')).toBe(true);
});
