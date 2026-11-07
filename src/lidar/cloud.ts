import { Las } from 'copc';
import { createLazPerf } from 'laz-perf';
import proj4 from 'proj4';
import { checkedBox, emptyStats, get, EPT_ROOT, PROJECTS, type Box, type Stats } from './ept';
import { beginTerrain, type TerrainSurface } from './terrain';

/** Deepest EPT level that still fits a phone download. Each level is its own sample. */
const NODE_CAP = 20;
const POINT_BUDGET = 140_000;

export interface CloudProgress {
  done: number;
  total: number;
  stage?: string;
}

export interface PointCloud {
  /** Local meters, Y up, centered on the cloud. */
  positions: Float32Array;
  /** Absolute elevation, meters. */
  height: Float32Array;
  intensity: Float32Array;
  count: number;
  /** Longest axis of the centered cloud, meters. */
  span: number;
  /** Mercator easting, northing, and elevation subtracted from local positions. */
  origin: { x: number; y: number; z: number };
  heightRange: [number, number];
  intensityRange: [number, number];
  /** Ground surface in the same local frame. Absent when the DEM request fails. */
  surface?: TerrainSurface;
}

interface EptMetadata {
  bounds: number[];
  boundsConforming?: number[];
  dataType: string;
}

interface NodeRef {
  key: string;
  fileKey: string;
  count: number;
}

type MercatorBox = [number, number, number, number];
type Column = [number, number, number, number, number, number];
type LazModule = Awaited<ReturnType<typeof createLazPerf>>;

const metaCache = new Map<string, EptMetadata>();
const hierarchyCache = new Map<string, Record<string, number>>();
let lazPromise: ReturnType<typeof createLazPerf> | undefined;

const emptyRange: [number, number] = [0, 1];

function emptyCloud(): PointCloud {
  return {
    positions: new Float32Array(),
    height: new Float32Array(),
    intensity: new Float32Array(),
    count: 0,
    span: 1,
    origin: { x: 0, y: 0, z: 0 },
    heightRange: emptyRange,
    intensityRange: emptyRange,
  };
}

function aborted(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function mercatorBox(box: Box): MercatorBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const corner of [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]]) {
    const [x, y] = proj4('EPSG:4326', 'EPSG:3857', corner);
    if (x! < minX) minX = x!;
    if (y! < minY) minY = y!;
    if (x! > maxX) maxX = x!;
    if (y! > maxY) maxY = y!;
  }
  return [minX, minY, maxX, maxY];
}

function verticalColumn(meta: EptMetadata, xy: MercatorBox): Column {
  const z0 = (meta.boundsConforming?.[2] ?? meta.bounds[2]!) - 30;
  const z1 = (meta.boundsConforming?.[5] ?? meta.bounds[5]!) + 30;
  return [xy[0], xy[1], z0, xy[2], xy[3], z1];
}

function intersects(bounds: number[], column: Column): boolean {
  return column[0] < bounds[3]! && column[3] > bounds[0]!
    && column[1] < bounds[4]! && column[4] > bounds[1]!
    && column[2] < bounds[5]! && column[5] > bounds[2]!;
}

function nodeCube(bounds: number[], key: string): { x: number; y: number; z: number; s: number } {
  const [d, x, y, z] = key.split('-').map(Number);
  const s = (bounds[3]! - bounds[0]!) / 2 ** d!;
  return { x: bounds[0]! + x! * s, y: bounds[1]! + y! * s, z: bounds[2]! + z! * s, s };
}

function overlaps(cube: { x: number; y: number; z: number; s: number }, column: Column): boolean {
  return cube.x < column[3] && cube.x + cube.s > column[0]
    && cube.y < column[4] && cube.y + cube.s > column[1]
    && cube.z < column[5] && cube.z + cube.s > column[2];
}

function octants(key: string): string[] {
  const [d, x, y, z] = key.split('-').map(Number);
  const out: string[] = [];
  const depth = d! + 1;
  const x2 = x! * 2, y2 = y! * 2, z2 = z! * 2;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    out.push(`${depth}-${x2 + dx}-${y2 + dy}-${z2 + dz}`);
  }
  return out;
}

async function metadata(project: string, stats: Stats, signal: AbortSignal): Promise<EptMetadata> {
  const cached = metaCache.get(project);
  if (cached) return cached;
  const meta = JSON.parse(new TextDecoder().decode(await get(`${EPT_ROOT}/${project}/ept.json`, stats, true, signal))) as EptMetadata;
  if (meta.dataType !== 'laszip' || !Array.isArray(meta.bounds) || meta.bounds.length < 6) throw new Error('Unsupported EPT encoding');
  metaCache.set(project, meta);
  return meta;
}

async function hierarchy(project: string, key: string, stats: Stats, signal: AbortSignal): Promise<Record<string, number>> {
  const id = `${project}/${key}`;
  const cached = hierarchyCache.get(id);
  if (cached) return cached;
  const data = JSON.parse(new TextDecoder().decode(await get(`${EPT_ROOT}/${project}/ept-hierarchy/${key}.json`, stats, true, signal))) as Record<string, number>;
  if (hierarchyCache.size >= 32) hierarchyCache.delete(hierarchyCache.keys().next().value!);
  hierarchyCache.set(id, data);
  return data;
}

/** Deepest overlapping level whose node count stays within the download cap. */
async function selectNodes(project: string, meta: EptMetadata, column: Column, stats: Stats, signal: AbortSignal): Promise<NodeRef[]> {
  const root = await hierarchy(project, '0-0-0-0', stats, signal);
  const files = new Map<string, Record<string, number>>([['0-0-0-0', root]]);
  let frontier: { key: string; fileKey: string }[] = [{ key: '0-0-0-0', fileKey: '0-0-0-0' }];
  let chosen: NodeRef[] = [];
  for (let depth = 0; depth <= 16 && frontier.length; depth++) {
    if (signal.aborted) throw aborted();
    const resolved: NodeRef[] = [];
    for (const item of frontier) {
      if (resolved.length > NODE_CAP) break;
      const cube = nodeCube(meta.bounds, item.key);
      if (!overlaps(cube, column)) continue;
      let file = files.get(item.fileKey);
      if (!file) continue;
      let count = file[item.key];
      let fileKey = item.fileKey;
      if (count === -1) {
        file = await hierarchy(project, item.key, stats, signal);
        files.set(item.key, file);
        fileKey = item.key;
        count = file[item.key];
      }
      if (typeof count !== 'number' || count <= 0) continue;
      resolved.push({ key: item.key, fileKey, count });
    }
    if (!resolved.length || resolved.length > NODE_CAP) break;
    chosen = resolved;
    const next: { key: string; fileKey: string }[] = [];
    let refined = false;
    for (const node of resolved) {
      const file = files.get(node.fileKey);
      if (!file) continue;
      const kids = octants(node.key).filter(key => {
        const count = file[key];
        return count !== undefined && count !== 0;
      });
      if (!kids.length) next.push({ key: node.key, fileKey: node.fileKey });
      else {
        refined = true;
        for (const key of kids) next.push({ key, fileKey: node.fileKey });
      }
    }
    if (!refined || next.length > 512) break;
    frontier = next;
  }
  return chosen;
}

class Samples {
  private x = new Float32Array(4096);
  private y = new Float32Array(4096);
  private z = new Float32Array(4096);
  private intensity = new Float32Array(4096);
  count = 0;

  push(x: number, y: number, z: number, intensity: number): void {
    if (this.count >= POINT_BUDGET) return;
    if (this.count === this.z.length) {
      const n = this.z.length * 2;
      this.x = grow(this.x, n);
      this.y = grow(this.y, n);
      this.z = grow(this.z, n);
      this.intensity = grow(this.intensity, n);
    }
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.intensity[i] = intensity;
  }

  pack(): PointCloud {
    const n = this.count;
    if (!n) return emptyCloud();
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = this.x[i]!, py = this.y[i]!, pz = this.z[i]!;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const positions = new Float32Array(n * 3);
    const height = this.z.slice(0, n);
    const intensity = this.intensity.slice(0, n);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = this.x[i]! - cx;
      positions[i * 3 + 1] = this.z[i]! - cz;
      positions[i * 3 + 2] = -(this.y[i]! - cy);
    }
    return {
      positions,
      height,
      intensity,
      count: n,
      span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
      origin: { x: cx, y: cy, z: cz },
      heightRange: spread(height),
      intensityRange: spread(intensity),
    };
  }
}

function grow(from: Float32Array, n: number): Float32Array<ArrayBuffer> {
  const next = new Float32Array(n);
  next.set(from);
  return next;
}

function spread(values: Float32Array): [number, number] {
  const copy = Float32Array.from(values);
  copy.sort();
  const last = copy.length - 1;
  const lo = copy[Math.floor(0.02 * last)]!;
  const hi = copy[Math.floor(0.98 * last)]!;
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

async function wasm(): Promise<LazModule> {
  lazPromise ??= createLazPerf({ locateFile: () => '/lidar/laz-perf.wasm' });
  return lazPromise;
}

async function decodeNode(bytes: Uint8Array, laz: LazModule, xy: MercatorBox, stride: number, samples: Samples): Promise<void> {
  const header = Las.Header.parse(bytes);
  const data = await Las.PointData.decompressFile(bytes, laz);
  const view = Las.View.create(data, header);
  const gx = view.getter('X'), gy = view.getter('Y'), gz = view.getter('Z'), gi = view.getter('Intensity');
  let seen = 0;
  for (let i = 0; i < header.pointCount; i++) {
    const px = gx(i), py = gy(i), pz = gz(i);
    if (px < xy[0] || px >= xy[2] || py < xy[1] || py >= xy[3] || !Number.isFinite(pz)) continue;
    if (seen++ % stride !== 0) continue;
    const iv = gi(i);
    samples.push(px, py, pz, Number.isFinite(iv) ? iv : 0);
    if (samples.count >= POINT_BUDGET) return;
  }
}

async function readNodes(project: string, nodes: NodeRef[], xy: MercatorBox, stats: Stats, signal: AbortSignal, progress: (p: CloudProgress) => void): Promise<PointCloud> {
  const laz = await wasm();
  const samples = new Samples();
  const perNode = Math.max(1, Math.floor(POINT_BUDGET / nodes.length));
  const pending = new Map<number, Promise<ArrayBuffer>>();
  const enqueue = (index: number): void => {
    const node = nodes[index];
    if (!node) return;
    pending.set(index, get(`${EPT_ROOT}/${project}/ept-data/${node.key}.laz`, stats, false, signal));
  };
  const drain = (): Promise<unknown> => Promise.all([...pending.values()].map(task => task.catch(() => undefined)));
  for (let index = 0; index < Math.min(4, nodes.length); index++) enqueue(index);
  try {
    for (let index = 0; index < nodes.length; index++) {
      if (signal.aborted) throw aborted();
      const bytes = new Uint8Array(await pending.get(index)!);
      pending.delete(index);
      enqueue(index + 4);
      const node = nodes[index]!;
      await decodeNode(bytes, laz, xy, Math.max(1, Math.ceil(node.count / perNode)), samples);
      progress({ done: index + 1, total: nodes.length });
      if (samples.count >= POINT_BUDGET) break;
    }
  } catch (err) {
    await drain();
    throw err;
  }
  await drain();
  return samples.pack();
}

/** Download a phone-sized sample of the USGS EPT cloud inside a trail-finder box. */
export async function loadPointCloud(box: Box, signal: AbortSignal, progress: (p: CloudProgress) => void): Promise<PointCloud> {
  checkedBox(box);
  if (signal.aborted) throw aborted();
  const xy = mercatorBox(box);
  const terrain = beginTerrain(xy, signal);
  void terrain.catch(() => undefined);
  const stats = emptyStats();
  let best: { project: string; nodes: NodeRef[]; points: number } | undefined;
  for (const project of PROJECTS) {
    if (signal.aborted) throw aborted();
    const meta = await metadata(project, stats, signal);
    const column = verticalColumn(meta, xy);
    if (!intersects(meta.bounds, column)) continue;
    const nodes = await selectNodes(project, meta, column, stats, signal);
    const points = nodes.reduce((sum, node) => sum + node.count, 0);
    if (points > (best?.points ?? 0)) best = { project, nodes, points };
  }
  if (!best?.nodes.length) {
    terrain.catch(() => undefined);
    return emptyCloud();
  }
  progress({ done: 0, total: best.nodes.length });
  const cloud = await readNodes(best.project, best.nodes, xy, stats, signal, progress);
  if (!cloud.count || signal.aborted) {
    terrain.catch(() => undefined);
    return cloud;
  }
  progress({ done: best.nodes.length, total: best.nodes.length, stage: 'Surface' });
  try {
    cloud.surface = (await terrain)(cloud.origin);
    cloud.span = Math.max(cloud.span, xy[2] - xy[0], xy[3] - xy[1]);
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
  }
  return cloud;
}
