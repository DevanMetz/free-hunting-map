import { describe, it, expect } from 'vitest';
import { BoxDrawing, estimateBox } from './boxDrawing';
describe('box drawing', () => {
  it('completes a drag', () => { const d = new BoxDrawing(); d.start([0,0],[1,2]); expect(d.move([50,50],[3,4])).toEqual([1,2,3,4]); expect(d.end([3,4])).toEqual([1,2,3,4]); expect(d.first).toBeUndefined(); });
  it('previews and completes two taps', () => { const d = new BoxDrawing(); d.start([0,0],[1,2]); expect(d.end([1,2])).toBeUndefined(); expect(d.move([20,20],[3,4])).toEqual([1,2,3,4]); d.start([20,20],[3,4]); expect(d.end([3,4])).toEqual([1,2,3,4]); });
  it('treats tiny movement as a click', () => { const d = new BoxDrawing(); d.start([0,0],[1,2]); expect(d.move([2,2],[1.1,2.1])).toBeUndefined(); expect(d.end([1.1,2.1])).toBeUndefined(); expect(d.first).toEqual([1.1,2.1]); });
  it('clears all state on cancel', () => { const d = new BoxDrawing(); d.start([0,0],[1,2]); d.end([1,2]); d.cancel(); expect(d.move([20,20],[3,4])).toBeUndefined(); d.start([0,0],[1,2]); expect(d.end([1,2])).toBeUndefined(); });
  it('estimates download and caps one square mile', () => { const small = estimateBox([-90.825,44.515,-90.815,44.525]); expect(small.area).toBeGreaterThan(.3); expect(small.area).toBeLessThan(.4); expect(small.mb).toBeCloseTo(small.area*645); expect(small.over).toBe(false); expect(estimateBox([-90.84,44.50,-90.80,44.54]).over).toBe(true); });
});
