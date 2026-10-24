import type { FieldOfView, LngLat } from '../types';
import { roundCoord, haversine } from './geo';
import { sanitizeFov } from '../sync/validate';
const RAD = Math.PI / 180;
const R = 6371008.8;
export function destination(origin: LngLat, bearing: number, meters: number): LngLat {
  const [lng, lat] = origin.map(n => n * RAD) as LngLat;
  const b = bearing * RAD, d = meters / R;
  const y = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
  const x = lng + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(y));
  return roundCoord([((x / RAD + 540) % 360) - 180, y / RAD]);
}
export function bearingTo(origin: LngLat, point: LngLat): number {
  const lat = origin[1] * RAD, to = point[1] * RAD, delta = (point[0] - origin[0]) * RAD;
  return (Math.atan2(Math.sin(delta) * Math.cos(to), Math.cos(lat) * Math.sin(to) - Math.sin(lat) * Math.cos(to) * Math.cos(delta)) / RAD + 360) % 360;
}
export function wedge(origin: LngLat, input: FieldOfView, segments = 24): LngLat[] {
  const f = sanitizeFov(input), n = Math.max(16, Math.floor(segments));
  return [origin, ...Array.from({ length: n + 1 }, (_, i) => destination(origin, f.bearing - f.angle / 2 + f.angle * i / n, f.range)), origin];
}
export function dragTip(origin: LngLat, point: LngLat, fov: FieldOfView): FieldOfView {
  return sanitizeFov({ ...fov, bearing: bearingTo(origin, point), range: haversine(origin, point) });
}
export function dragEdge(origin: LngLat, point: LngLat, fov: FieldOfView): FieldOfView {
  const difference = Math.abs(((bearingTo(origin, point) - fov.bearing + 540) % 360) - 180);
  return sanitizeFov({ ...fov, angle: difference * 2 });
}
