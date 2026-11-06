import { fromArrayBuffer } from 'geotiff';
import { DEM_ROOT, emptyStats, get } from './ept';

/** Ground mesh in the same local Y-up frame as the point cloud. */
export interface TerrainSurface {
  positions: Float32Array;
  height: Float32Array;
  indices: Uint16Array;
  heightRange: [number, number];
}

type MercatorBox = [number, number, number, number];

function gridShape(xy: MercatorBox): { cols: number; rows: number } {
  const spanX = xy[2] - xy[0], spanY = xy[3] - xy[1];
  const cell = Math.max(2.5, Math.max(spanX, spanY) / 128);
  return {
    cols: Math.max(24, Math.min(128, Math.round(spanX / cell))),
    rows: Math.max(24, Math.min(128, Math.round(spanY / cell))),
  };
}

function usable(value: number, nodata: number | null): boolean {
  return Number.isFinite(value) && value > -100 && value < 9000 && value !== nodata;
}

function fillHoles(grid: Float32Array, cols: number, rows: number, nodata: number | null): void {
  for (let i = 0; i < grid.length; i++) if (!usable(grid[i]!, nodata)) grid[i] = Number.NaN;
  for (let pass = 0; pass < 8; pass++) {
    let holes = 0;
    const next = grid.slice();
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      if (Number.isFinite(grid[index]!)) continue;
      let sum = 0, count = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const r = row + dr, c = col + dc;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const value = grid[r * cols + c]!;
        if (Number.isFinite(value)) { sum += value; count++; }
      }
      if (count) next[index] = sum / count;
      else holes++;
    }
    grid.set(next);
    if (!holes) return;
  }
  let sum = 0, count = 0;
  for (const value of grid) if (Number.isFinite(value)) { sum += value; count++; }
  const mean = count ? sum / count : 0;
  for (let i = 0; i < grid.length; i++) if (!Number.isFinite(grid[i]!)) grid[i] = mean;
}

interface ElevationGrid {
  values: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

async function fetchGrid(xy: MercatorBox, signal: AbortSignal): Promise<ElevationGrid> {
  const { cols, rows } = gridShape(xy);
  const params = new URLSearchParams({
    bbox: xy.join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${cols},${rows}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  const tiff = await fromArrayBuffer(await get(`${DEM_ROOT}?${params}`, emptyStats(), true, signal));
  const image = await tiff.getImage();
  if (image.getSamplesPerPixel() !== 1) throw new Error('Invalid 3DEP raster');
  const width = image.getWidth(), height = image.getHeight();
  const raster = await image.readRasters({ interleave: true });
  const grid = raster instanceof Float32Array ? raster.slice() : Float32Array.from(raster as ArrayLike<number>);
  if (grid.length !== width * height) throw new Error('Invalid 3DEP raster');
  const nodata = image.getGDALNoData();
  let valid = 0;
  for (const value of grid) if (usable(value, nodata)) valid++;
  if (valid < grid.length * 0.5) throw new Error('No ground lidar coverage');
  fillHoles(grid, width, height, nodata);
  const [ox, oy] = image.getOrigin();
  const [dx, dy] = image.getResolution();
  return { values: grid, width, height, originX: ox!, originY: oy!, dx: dx!, dy: dy! };
}

function meshGrid(grid: ElevationGrid, origin: { x: number; y: number; z: number }): TerrainSurface {
  const { values, width, height, originX, originY, dx, dy } = grid;
  const positions = new Float32Array(width * height * 3);
  const elevation = new Float32Array(width * height);
  let lo = Infinity, hi = -Infinity;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const index = row * width + col;
    const z = values[index]!;
    const mx = originX + (col + 0.5) * dx;
    const my = originY + (row + 0.5) * dy;
    const out = index * 3;
    positions[out] = mx - origin.x;
    positions[out + 1] = z - origin.z;
    positions[out + 2] = -(my - origin.y);
    elevation[index] = z;
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  const indices = new Uint16Array((width - 1) * (height - 1) * 6);
  let triangle = 0;
  for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
    const a = row * width + col;
    const b = a + 1;
    const c = a + width;
    const d = c + 1;
    indices[triangle++] = a; indices[triangle++] = c; indices[triangle++] = b;
    indices[triangle++] = b; indices[triangle++] = c; indices[triangle++] = d;
  }
  return { positions, height: elevation, indices, heightRange: hi > lo ? [lo, hi] : [lo, lo + 1] };
}

/** Start the 3DEP download so it overlaps the point-cloud fetch. Mesh once the origin is known. */
export function beginTerrain(xy: MercatorBox, signal: AbortSignal): Promise<(origin: { x: number; y: number; z: number }) => TerrainSurface> {
  const grid = fetchGrid(xy, signal).catch(err => {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    return fetchGrid(xy, signal);
  });
  return grid.then(values => origin => meshGrid(values, origin));
}
