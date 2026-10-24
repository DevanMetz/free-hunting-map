import { estimateBox } from "./boxDrawing";
import { LIDAR_EPT_ROOT, LIDAR_DEM_ROOT } from "../map/sources";
import { Las } from "copc";
import { createLazPerf } from "laz-perf";
import proj4 from "proj4";
import { fromArrayBuffer } from "geotiff";
import { fillGround } from "./features";
export type Box = [number, number, number, number];
export const UTM = "+proj=utm +zone=15 +datum=NAD83 +units=m +no_defs";
const mercatorToUTM = proj4("EPSG:3857", UTM);
export const PROJECTS = ["WI_Clark_2018", "WI_12County_9_B22"] as const;
export const EPT_ROOT = LIDAR_EPT_ROOT;
export const DEM_ROOT = LIDAR_DEM_ROOT;
export interface Stats {
  bytes: number;
  downloadMs: number;
  decodeMs: number;
  featureMs: number;
  inferenceMs: number;
  postMs: number;
  nodes: number;
}
export const emptyStats = (): Stats => ({
  bytes: 0,
  downloadMs: 0,
  decodeMs: 0,
  featureMs: 0,
  inferenceMs: 0,
  postMs: 0,
  nodes: 0,
});
export function toUTM(p: number[]): number[] {
  return proj4("EPSG:4326", UTM, p);
}
export function toLngLat(p: number[]): number[] {
  return proj4(UTM, "EPSG:4326", p).map((v) => Math.round(v * 1e6) / 1e6);
}
export function checkedBox(box: Box): Box {
  if (
    !box.every(Number.isFinite) ||
    box[0] >= box[2] ||
    box[1] >= box[3] ||
    box[0] < -180 ||
    box[2] > 180 ||
    box[1] < -85 ||
    box[3] > 85
  )
    throw new Error("Invalid box");
  const a = toUTM(box.slice(0, 2)),
    b = toUTM(box.slice(2));
  const area = (b[0]! - a[0]!) * (b[1]! - a[1]!);
  if (area <= 0 || estimateBox(box).over)
    throw new Error("Box exceeds 1 square mile");
  if (b[0]! - a[0]! > 4000 || b[1]! - a[1]! > 4000)
    throw new Error("Box side exceeds 4 km");
  return [
    Math.floor(a[0]!),
    Math.floor(a[1]!),
    Math.ceil(b[0]!),
    Math.ceil(b[1]!),
  ];
}
export async function get(
  url: string,
  stats: Stats,
  timed = true,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const t = performance.now(),
    r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${new URL(url).pathname}`);
  const b = await r.arrayBuffer();
  stats.bytes += b.byteLength;
  if (timed) stats.downloadMs += performance.now() - t;
  return b;
}
export async function nodes(
  project: string,
  bb: Box,
  stats: Stats,
  signal?: AbortSignal,
): Promise<string[]> {
  const base = `${EPT_ROOT}/${project}`,
    metadata = JSON.parse(
      new TextDecoder().decode(await get(`${base}/ept.json`, stats, true, signal)),
    ) as { bounds: number[]; dataType: string };
  if (metadata.dataType !== "laszip")
    throw new Error("Unsupported EPT encoding");
  const corners = [
    proj4(UTM, "EPSG:3857", bb.slice(0, 2)),
    proj4(UTM, "EPSG:3857", bb.slice(2)),
    proj4(UTM, "EPSG:3857", [bb[0], bb[3]]),
    proj4(UTM, "EPSG:3857", [bb[2], bb[1]]),
  ];
  const mb = [
    Math.min(...corners.map((p) => p[0]!)),
    Math.min(...corners.map((p) => p[1]!)),
    Math.max(...corners.map((p) => p[0]!)),
    Math.max(...corners.map((p) => p[1]!)),
  ];
  const pending = ["0-0-0-0"],
    out = new Set<string>();
  while (pending.length) {
    const key = pending.pop()!,
      hierarchy = JSON.parse(
        new TextDecoder().decode(
          await get(`${base}/ept-hierarchy/${key}.json`, stats, true, signal),
        ),
      ) as Record<string, number>;
    for (const [k, n] of Object.entries(hierarchy)) {
      const [d, x, y] = k.split("-").map(Number),
        s = (metadata.bounds[3]! - metadata.bounds[0]!) / 2 ** d!;
      const lx = metadata.bounds[0]! + x! * s,
        ly = metadata.bounds[1]! + y! * s;
      if (lx >= mb[2]! || lx + s <= mb[0]! || ly >= mb[3]! || ly + s <= mb[1]!)
        continue;
      if (n === -1) pending.push(k);
      else if (n > 0) out.add(k);
    }
    if (out.size > 12000) throw new Error("EPT node limit exceeded");
  }
  return [...out];
}
let laz: ReturnType<typeof createLazPerf> | undefined;
export function tileBounds(tx: number, ty: number): Box {
  return [tx * 1000 - 64, ty * 1000 - 64, tx * 1000 + 1064, ty * 1000 + 1064];
}
export async function groundTile(
  tx: number,
  ty: number,
  stats: Stats,
  progress: (s: string) => void,
): Promise<Float32Array> {
  const n = 1128,
    bb = tileBounds(tx, ty);
  const sums = new Float64Array(4 * n * n),
    counts = new Uint32Array(sums.length),
    m2 = Math.floor(n / 2) + 1,
    coverage = new Uint8Array(m2 * m2);
  laz ??= createLazPerf({ locateFile: () => "/lidar/laz-perf.wasm" });
  const decoder = await laz;
  for (const project of PROJECTS) {
    if (
      project === PROJECTS[1] &&
      coverage.reduce((a, b) => a + b, 0) / coverage.length >= 0.97
    )
      break;
    const keys = await nodes(project, bb, stats);
    const pending = new Map<number, Promise<ArrayBuffer>>();
    const enqueue = (j: number): void => {
      if (j < keys.length)
        pending.set(
          j,
          get(`${EPT_ROOT}/${project}/ept-data/${keys[j]}.laz`, stats, false),
        );
    };
    for (let j = 0; j < Math.min(4, keys.length); j++) enqueue(j);
    for (let j = 0; j < keys.length; j++) {
      progress(`${project} ${j + 1}/${keys.length}`);
      const wait = performance.now();
      const bytes = new Uint8Array(await pending.get(j)!);
      stats.downloadMs += performance.now() - wait;
      pending.delete(j);
      enqueue(j + 4);
      const t = performance.now(),
        header = Las.Header.parse(bytes),
        data = await Las.PointData.decompressFile(bytes, decoder);
      const view = Las.View.create(data, header),
        x = view.getter("X"),
        y = view.getter("Y"),
        z = view.getter("Z"),
        cl = view.getter("Classification");
      for (let i = 0; i < header.pointCount; i++) {
        const p = mercatorToUTM.forward([x(i), y(i)]),
          px = p[0]!,
          py = p[1]!;
        if (px < bb[0] || px >= bb[2] || py < bb[1] || py >= bb[3]) continue;
        const ci = Math.min(
          coverage.length - 1,
          Math.floor((bb[3] - py) / 2) * m2 + Math.floor((px - bb[0]) / 2),
        );
        if (project === PROJECTS[1] && coverage[ci]) continue;
        if (project === PROJECTS[0]) coverage[ci] = 1;
        if (cl(i) !== 2) continue;
        const index =
          Math.min(2 * n - 1, Math.floor((bb[3] - py) * 2)) * 2 * n +
          Math.min(2 * n - 1, Math.floor((px - bb[0]) * 2));
        sums[index] = sums[index]! + Math.fround(z(i));
        counts[index] = counts[index]! + 1;
      }
      stats.decodeMs += performance.now() - t;
      stats.nodes++;
    }
  }
  if (!counts.some((n) => n > 0)) throw new Error("No ground lidar coverage");
  const params = new URLSearchParams({
    bbox: bb.join(","),
    bboxSR: "26915",
    imageSR: "26915",
    size: `${n},${n}`,
    format: "tiff",
    pixelType: "F32",
    f: "image",
    interpolation: "RSP_BilinearInterpolation",
  });
  const tiff = await fromArrayBuffer(await get(`${DEM_ROOT}?${params}`, stats)),
    image = await tiff.getImage();
  const d3 = (await image.readRasters({ interleave: true })) as Float32Array;
  if (
    image.getWidth() !== n ||
    image.getHeight() !== n ||
    !d3.every((v) => Number.isFinite(v) && v >= 0)
  )
    throw new Error("Invalid 3DEP raster");
  const t = performance.now(),
    dtm = fillGround(sums, counts, d3, n, n);
  stats.featureMs += performance.now() - t;
  return dtm;
}
