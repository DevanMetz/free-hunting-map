"""Lidar terrain derivatives for road/skid-trail spotting.

Reads a 1 m DEM mosaic (VRT, metres) and writes, per 5 km block, single-band
Byte GeoTIFFs (0-254 value, 255 nodata) for: lrm, openness, hillshade, slope.
Palettes are applied later by tile.py. Run on a multi-core VM (Colab CPU).

  python derive.py /content/dem/mosaic.vrt /content/out
"""
import math, os, sys
from pathlib import Path
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import rasterio
from rasterio.windows import Window
from scipy.ndimage import gaussian_filter, uniform_filter
from numba import njit, prange

BLOCK, PAD = int(os.environ.get('BLOCK', '2500')), 40
NODATA = 255
LRM_WINDOW, LRM_RANGE, LRM_SMOOTH = 21, 0.6, 1.5  # metres
OPEN_RADIUS, OPEN_LO, OPEN_HI = 15, 78.0, 93.0  # pixels (1 m), degrees
SLOPE_MAX = 45.0
Z = 4.0                                  # hillshade vertical exaggeration


@njit(parallel=True, cache=True)
def openness(dem, radius):
    h, w = dem.shape
    out = np.full((h, w), np.nan, np.float32)
    DI = np.array([0, 1, 1, 1, 0, -1, -1, -1])
    DJ = np.array([1, 1, 0, -1, -1, -1, 0, 1])
    for i in prange(h):
        for j in range(w):
            z0 = dem[i, j]
            if np.isnan(z0):
                continue
            total = 0.0
            for d in range(8):
                di, dj = DI[d], DJ[d]
                inv = 1.0 / math.sqrt(di * di + dj * dj)
                best = -1e30  # max tangent of the elevation angle
                for r in range(1, radius + 1):
                    ii, jj = i + di * r, j + dj * r
                    if ii < 0 or jj < 0 or ii >= h or jj >= w:
                        break
                    z = dem[ii, jj]
                    if np.isnan(z):
                        break
                    t = (z - z0) * inv / r
                    if t > best:
                        best = t
                if best == -1e30:
                    best = 0.0
                total += 90.0 - math.degrees(math.atan(best))
            out[i, j] = total / 8.0
    return out


def scale(v, lo, hi, gamma=1.0):
    t = np.clip((v - lo) / (hi - lo), 0, 1) ** gamma
    return np.round(t * 254).astype(np.uint8)


def block(args):
    src_path, out, bx, by = args
    checkpoint = Path(out)/'done'/f'b_{bx:03d}_{by:03d}'
    if os.environ.get('DEM_CONSUME') and checkpoint.exists():
        return (bx, by)
    def done():
        if os.environ.get('DEM_CONSUME'):
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            tmp = checkpoint.with_suffix('.tmp')
            tmp.write_text('done\n')
            os.replace(tmp, checkpoint)
    with rasterio.open(src_path) as src:
        W, H = src.width, src.height
        x0, y0 = bx * BLOCK, by * BLOCK
        w, h = min(BLOCK, W - x0), min(BLOCK, H - y0)
        rx0, ry0 = max(0, x0 - PAD), max(0, y0 - PAD)
        rx1, ry1 = min(W, x0 + w + PAD), min(H, y0 + h + PAD)
        dem = src.read(1, window=Window(rx0, ry0, rx1 - rx0, ry1 - ry0), masked=True)
        if dem.mask.all():
            done()
            return None
        res = src.res[0]
        profile = src.profile
        transform = src.window_transform(Window(x0, y0, w, h))
    a = dem.filled(np.nan).astype(np.float32)
    valid = ~np.isnan(a)
    sl = (slice(y0 - ry0, y0 - ry0 + h), slice(x0 - rx0, x0 - rx0 + w))
    # Fill gaps with the local mean so filters don't smear nodata.
    filled = np.where(valid, a, np.nanmean(a))
    gy, gx = np.gradient(filled, res)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    # GDAL-style multidirectional hillshade (Mark 1992 weighting).
    zx, zy = gx * Z, gy * Z
    sl_r = np.arctan(np.hypot(zx, zy))
    aspect = np.arctan2(-zx, zy)  # radians, 0 = north, clockwise
    alt = math.radians(45)
    hs = np.zeros_like(filled)
    for az_deg in (225, 270, 315, 360):
        az = math.radians(az_deg)
        wgt = np.sin(aspect - az) ** 2
        val = math.sin(alt) * np.cos(sl_r) + math.cos(alt) * np.sin(sl_r) * np.cos(az - aspect)
        hs += wgt * np.clip(val, 0, 1)
    hs /= 2.0
    smooth = gaussian_filter(filled, LRM_SMOOTH)
    lrm_s = np.clip((smooth - uniform_filter(smooth, LRM_WINDOW, mode='nearest')) / LRM_RANGE, -1, 1)
    op = openness(np.where(valid, a, np.nan).astype(np.float32), OPEN_RADIUS)
    layers = {
        'lrm': np.round((lrm_s + 1) / 2 * 254).astype(np.uint8),
        'openness': scale(np.nan_to_num(op, nan=90.0), OPEN_LO, OPEN_HI, 1.2),
        'hillshade': scale(hs, 0.2, 1.0),
        'slope': scale(slope, 0.0, SLOPE_MAX, 0.6),
    }
    m = valid[sl]
    profile.update(driver='GTiff', dtype='uint8', count=1, nodata=NODATA, width=w, height=h,
                   transform=transform, tiled=True, blockxsize=512, blockysize=512, compress='deflate', predictor=2)
    for name, arr in layers.items():
        os.makedirs(f'{out}/{name}', exist_ok=True)
        with rasterio.open(f'{out}/{name}/b_{bx:03d}_{by:03d}.tif', 'w', **profile) as dst:
            dst.write(np.where(m, arr[sl], NODATA), 1)
    done()
    return (bx, by)


if __name__ == '__main__':
    src_path, out = sys.argv[1], sys.argv[2]
    with rasterio.open(src_path) as src:
        nx, ny = math.ceil(src.width / BLOCK), math.ceil(src.height / BLOCK)
    jobs = [(src_path, out, bx, by) for by in range(ny) for bx in range(nx)]
    workers = min(3, max(1, int(os.environ.get('WORKERS', '2'))))
    with ProcessPoolExecutor(workers) as ex:
        for i, r in enumerate(ex.map(block, jobs)):
            print(f'{i + 1}/{len(jobs)} {r}', flush=True)
            if os.environ.get('DEM_CONSUME') and (i+1) % nx == 0:
                row = i // nx
                # Row r+1's halo can read row r, but never row r-1.
                if row >= 1:
                    for path in Path(os.environ['DEM_CONSUME']).glob(f'dem_*_{row-1:03d}.tif'):
                        path.unlink(missing_ok=True)
