import type { Map as MlMap } from 'maplibre-gl';
import { wisconsinAccessPoints } from '../map/access/wisconsin';
import { accessStore, type PressureLevel } from '../map/access/store';
import { haversine } from '../map/geo';
import { OPENFREEMAP_TILEJSON } from '../map/sources';
import type { LngLat } from '../types';
import type { BBox } from './load';

export interface AccessPoint {
  coord: LngLat;
  name: string;
  pressure?: PressureLevel;
}

export interface Pressure {
  /** Metres to the nearest road, or Infinity when no road is known within 600 m. */
  roadM(coord: LngLat): number;
  /** Nearest parking or access within 8 km. */
  access(coord: LngLat): (AccessPoint & { meters: number }) | null;
}

const SOURCE = 'ohm-stand-pressure';
const ROADS = 'ohm-stand-pressure-roads';
const PARKING = 'ohm-stand-pressure-parking';
const ROAD_CLASS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path', 'raceway', 'busway', 'living_street', 'residential']);
const ACCESS_LAYER = /parking|access|entrance|trailhead|ramp/i;

let generation = 0;

function remove(map: MlMap): void {
  try {
    if (map.getLayer(ROADS)) map.removeLayer(ROADS);
    if (map.getLayer(PARKING)) map.removeLayer(PARKING);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  } catch { /* style is mid-swap */ }
}

export function clearPressure(map: MlMap): void {
  generation++;
  remove(map);
}

interface Segment { ax: number; ay: number; bx: number; by: number }

function segmentDistance(lng: number, lat: number, segment: Segment): number {
  const mx = 111_320 * Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const ax = (segment.ax - lng) * mx;
  const ay = (segment.ay - lat) * 111_320;
  const bx = (segment.bx - lng) * mx;
  const by = (segment.by - lat) * 111_320;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

function pair(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function addLine(coords: unknown, segments: Segment[], seen: Set<string>): void {
  if (!Array.isArray(coords) || coords.length < 2) return;
  let prev = pair(coords[0]);
  for (let i = 1; i < coords.length; i++) {
    const next = pair(coords[i]);
    if (prev && next) {
      const key = `${prev[0].toFixed(5)},${prev[1].toFixed(5)},${next[0].toFixed(5)},${next[1].toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        segments.push({ ax: prev[0], ay: prev[1], bx: next[0], by: next[1] });
      }
    }
    prev = next;
  }
}

function textProp(properties: Record<string, unknown> | null | undefined): string {
  if (!properties) return '';
  for (const key of ['name:latin', 'name', 'Name', 'NAME', 'title', 'label', 'n']) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80);
  }
  return '';
}

function waitIdle(map: MlMap, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = (): void => { cleanup(); resolve(); };
    const timer = window.setTimeout(finish, 4000);
    const onAbort = (): void => { cleanup(); reject(signal.reason); };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      map.off('idle', finish);
      signal.removeEventListener('abort', onAbort);
    };
    map.once('idle', finish);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function build(segments: Segment[], points: AccessPoint[]): Pressure {
  return {
    roadM(coord) {
      let best = 600;
      const reach = 600 / 111_320;
      for (const segment of segments) {
        const midLng = (segment.ax + segment.bx) / 2;
        const midLat = (segment.ay + segment.by) / 2;
        if (Math.abs(midLng - coord[0]) > reach && Math.abs(segment.ax - coord[0]) > reach && Math.abs(segment.bx - coord[0]) > reach) continue;
        if (Math.abs(midLat - coord[1]) > reach && Math.abs(segment.ay - coord[1]) > reach && Math.abs(segment.by - coord[1]) > reach) continue;
        best = Math.min(best, segmentDistance(coord[0], coord[1], segment));
      }
      return best < 600 ? best : Infinity;
    },
    access(coord) {
      let best: (AccessPoint & { meters: number }) | null = null;
      for (const point of points) {
        const meters = haversine(coord, point.coord);
        if (meters > 8000) continue;
        if (!best || meters < best.meters) best = { ...point, meters };
      }
      return best;
    },
  };
}

/** Roads and parking from OpenFreeMap, loaded road layers, access layers, and saved truck pins. */
export async function collectPressure(map: MlMap, box: BBox, pins: readonly AccessPoint[], signal: AbortSignal): Promise<Pressure> {
  const gen = ++generation;
  const segments: Segment[] = [];
  const seen = new Set<string>();
  const points: AccessPoint[] = [...pins];
  const pointSeen = new Set(pins.map(pin => `${pin.coord[0].toFixed(5)},${pin.coord[1].toFixed(5)}`));
  const addPoint = (coord: LngLat, name: string, pressure?: PressureLevel): void => {
    const key = `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;
    if (pointSeen.has(key)) return;
    pointSeen.add(key);
    points.push({ coord, name, ...(pressure ? { pressure } : {}) });
  };
  const reported = (spotId: string): PressureLevel | undefined => accessStore?.reportsFor(spotId)[0]?.level;
  for (const pullout of accessStore?.pullouts ?? []) addPoint(pullout.coord, pullout.name || 'Pullout', reported(`pullout:${pullout.id}`));
  try {
    map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 28, animate: false, maxZoom: 15 });
    if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: 'vector', url: OPENFREEMAP_TILEJSON });
    if (!map.getLayer(ROADS)) map.addLayer({
      id: ROADS, type: 'line', source: SOURCE, 'source-layer': 'transportation', minzoom: 10,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-opacity': 0.01, 'line-width': 1 },
    });
    if (!map.getLayer(PARKING)) map.addLayer({
      id: PARKING, type: 'circle', source: SOURCE, 'source-layer': 'poi', minzoom: 12,
      filter: ['==', ['get', 'class'], 'parking'],
      paint: { 'circle-opacity': 0.01, 'circle-radius': 2 },
    });
    try {
      const official = await wisconsinAccessPoints(box[0], box[1], box[2], box[3], 14, signal);
      for (const feature of official) {
        const coord = pair(feature.geometry.coordinates);
        const props = feature.properties;
        if (!coord || !props) continue;
        addPoint(coord, props.title || (props.origin === 'access' ? 'Access' : 'Parking'), reported(props.spotId));
      }
    } catch (err) {
      if (signal.aborted) throw err;
    }
    await waitIdle(map, signal);
    if (gen !== generation || signal.aborted) return build(segments, points);
    const sources = Object.entries(map.getStyle()?.sources ?? {}).filter(([, source]) => source.type === 'vector').map(([id]) => id);
    for (const id of sources) {
      let roads: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> | null }[] = [];
      let pois: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> | null }[] = [];
      try { roads = map.querySourceFeatures(id, { sourceLayer: 'transportation' }) as typeof roads; } catch { /* not that schema */ }
      try { pois = map.querySourceFeatures(id, { sourceLayer: 'poi' }) as typeof pois; } catch { /* not that schema */ }
      for (const feature of roads) {
        const cls = feature.properties?.class;
        const brunnel = feature.properties?.brunnel;
        if (brunnel === 'tunnel') continue;
        if (typeof cls === 'string' && !ROAD_CLASS.has(cls)) continue;
        if (feature.geometry.type === 'LineString') addLine(feature.geometry.coordinates, segments, seen);
        else if (feature.geometry.type === 'MultiLineString' && Array.isArray(feature.geometry.coordinates)) {
          for (const line of feature.geometry.coordinates) addLine(line, segments, seen);
        }
      }
      for (const feature of pois) {
        const cls = feature.properties?.class;
        const sub = feature.properties?.subclass;
        if (cls !== 'parking' && sub !== 'parking') continue;
        const coord = pair(feature.geometry.type === 'Point' ? feature.geometry.coordinates : null);
        if (coord) addPoint(coord, textProp(feature.properties) || 'Parking');
      }
    }
    const sw = map.project([box[0], box[1]]);
    const ne = map.project([box[2], box[3]]);
    const rendered = map.queryRenderedFeatures([
      [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
      [Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)],
    ]);
    for (const feature of rendered) {
      if (!ACCESS_LAYER.test(feature.layer.id) || feature.geometry.type !== 'Point') continue;
      const coord = pair(feature.geometry.coordinates);
      if (coord) addPoint(coord, textProp(feature.properties as Record<string, unknown>) || 'Access');
    }
  } catch (err) {
    if (signal.aborted) throw err;
  } finally {
    if (gen === generation) remove(map);
  }
  return build(segments, points);
}
