import { fromArrayBuffer } from 'geotiff';
import { haversine } from '../map/geo';
import { LIDAR_DEM_ROOT } from '../map/sources';
import type { BBox } from '../stands/load';

const MERCATOR_R = 6378137;
const MERCATOR_MAX = Math.PI * MERCATOR_R;

export class TerrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerrainError';
  }
}

export interface ElevationGrid {
  z: Float32Array;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  box: BBox;
}

/** About 6 m on a small box, coarsening so a phone stays near 144 cells on a side. */
export function gridShape(box: BBox): { cols: number; rows: number } {
  const [west, south, east, north] = box;
  const mid = (south + north) / 2;
  const cos = Math.max(0.2, Math.cos(mid * Math.PI / 180));
  const widthM = (east - west) * 111_320 * cos;
  const heightM = (north - south) * 111_320;
  const cell = Math.max(6, Math.max(widthM, heightM) / 144);
  return {
    cols: Math.max(20, Math.min(144, Math.round(widthM / cell))),
    rows: Math.max(20, Math.min(144, Math.round(heightM / cell))),
  };
}

export async function loadElevation(box: BBox, signal: AbortSignal): Promise<ElevationGrid> {
  const { cols, rows } = gridShape(box);
  const [west, south, east, north] = box;
  const [minX, minY] = mercator(west, south);
  const [maxX, maxY] = mercator(east, north);
  const params = new URLSearchParams({
    bbox: `${minX},${minY},${maxX},${maxY}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${cols},${rows}`,
    format: 'tiff',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  let response: Response;
  try {
    response = await fetch(`${LIDAR_DEM_ROOT}?${params}`, { signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new TerrainError('Elevation unavailable');
  }
  if (!response.ok) throw new TerrainError('Elevation unavailable');
  try {
    const tiff = await fromArrayBuffer(await response.arrayBuffer());
    const image = await tiff.getImage();
    if (image.getSamplesPerPixel() !== 1) throw new TerrainError('Elevation unavailable');
    const width = image.getWidth();
    const height = image.getHeight();
    const raster = await image.readRasters({ interleave: true });
    const raw = raster instanceof Float32Array ? raster : Float32Array.from(raster as ArrayLike<number>);
    if (raw.length !== width * height || width < 8 || height < 8) throw new TerrainError('Elevation unavailable');
    const nodata = image.getGDALNoData();
    let valid = 0;
    for (const value of raw) if (usable(value, nodata)) valid++;
    if (valid < raw.length * 0.45) throw new TerrainError('No elevation');
    const resolution = image.getResolution();
    const northUp = resolution[1]! <= 0;
    const z = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const src = northUp ? row : height - 1 - row;
      for (let col = 0; col < width; col++) {
        const value = raw[src * width + col]!;
        z[row * width + col] = usable(value, nodata) ? value : Number.NaN;
      }
    }
    const lng = (col: number): number => unmercator(minX + (col + 0.5) * (maxX - minX) / width, minY)[0];
    const lat = (row: number): number => unmercator(minX, maxY - (row + 0.5) * (maxY - minY) / height)[1];
    const mid = Math.floor(height / 2);
    const dx = Math.max(4, haversine([lng(0), lat(mid)], [lng(Math.min(1, width - 1)), lat(mid)]));
    const dy = Math.max(4, haversine([lng(0), lat(0)], [lng(0), lat(Math.min(1, height - 1))]));
    return { z, cols: width, rows: height, dx, dy, box };
  } catch (err) {
    if (err instanceof TerrainError || signal.aborted) throw err;
    throw new TerrainError('Elevation unavailable');
  }
}

function usable(value: number, nodata: number | null): boolean {
  return Number.isFinite(value) && value > -100 && value < 9000 && value !== nodata;
}

function mercator(lng: number, lat: number): [number, number] {
  const x = lng * MERCATOR_MAX / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + clamped * Math.PI / 360)) * MERCATOR_R;
  return [x, y];
}

function unmercator(x: number, y: number): [number, number] {
  const lng = x * 180 / MERCATOR_MAX;
  const lat = Math.atan(Math.sinh(y / MERCATOR_R)) * 180 / Math.PI;
  return [lng, lat];
}
