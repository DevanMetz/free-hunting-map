import type { Box } from './ept';
export type Point = [number, number];
export const SQUARE_MILE = 2589988.11;
export function estimateBox(box: Box): { area: number; over: boolean } {
  const area = Math.abs((box[2] - box[0]) * Math.PI / 180 * 6371008.8 * Math.cos((box[1] + box[3]) / 2 * Math.PI / 180) * (box[3] - box[1]) * Math.PI / 180 * 6371008.8) / SQUARE_MILE;
  return { area, over: area > 1 };
}
export function boxLabel(box: Box, bytes?: number | null): string {
  const { area, over } = estimateBox(box);
  if (over) return ">1 mi²";
  const size = bytes === null ? "—" : bytes === undefined ? "…" : `${Math.round(bytes / 1e6).toLocaleString("en-US")} MB`;
  return `${area.toFixed(2)} / 1 mi² · ${size}`;
}
export function bounds(a: Point, b: Point): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
export class BoxDrawing {
  first?: Point;
  private down?: { pixel: Point; coord: Point };
  private dragged = false;
  start(pixel: Point, coord: Point): void { this.down = { pixel, coord }; this.dragged = false; }
  move(pixel: Point, coord: Point): Box | undefined {
    if (this.down && Math.hypot(pixel[0] - this.down.pixel[0], pixel[1] - this.down.pixel[1]) >= 6) this.dragged = true;
    const first = this.first ?? (this.dragged ? this.down?.coord : undefined);
    return first ? bounds(first, coord) : undefined;
  }
  end(coord: Point): Box | undefined {
    const first = this.first ?? (this.dragged ? this.down?.coord : undefined);
    this.down = undefined;
    this.dragged = false;
    if (first) { this.first = undefined; return bounds(first, coord); }
    this.first = coord;
    return undefined;
  }
  cancel(): void { this.first = undefined; this.down = undefined; this.dragged = false; }
}
