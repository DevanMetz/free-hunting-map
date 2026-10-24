"""Canopy height model from a USGS 3DEP Entwine Point Tile (EPT) dataset.

Reads EPT nodes down to MAX_DEPTH (roughly 1 point/m^2 of ground for 1-2 m
lidar), keeps the highest non-noise return per CELL x CELL m cell (EPSG:3857),
and subtracts the bare-earth DEM warped onto the same grid.

  python chm.py https://s3-us-west-2.amazonaws.com/usgs-lidar-public/WI_Clark_2018 \
      /content/dem/mosaic.vrt /content/out/chm.tif

Fill a gap from a neighbouring project, then chm_fill.py it into the main grid:

  BBOX=-10121676,5530840,-10104000,5550000 python chm.py .../WI_12County_9_B22 dem.vrt fill.tif
"""
import io, json, math, os, subprocess, sys, urllib.request
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
import numpy as np
import laspy
import rasterio
from numba import njit

MAX_DEPTH = int(os.environ.get('MAX_DEPTH', 8))
CELL = float(os.environ.get('CELL', 4.0))  # metres in EPSG:3857 (~2.9 m on the ground at 44.5 N)
NOISE = (7, 18)
MAX_H = 45.0


def get(url, tries=4):
    for t in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception:
            if t == tries - 1:
                raise


def _hits(key, cube, bbox):
    if bbox is None:
        return True
    d, x, y, _ = map(int, key.split('-'))
    sx, sy = (cube[3] - cube[0]) / 2 ** d, (cube[4] - cube[1]) / 2 ** d
    nx0, ny0 = cube[0] + x * sx, cube[1] + y * sy
    return nx0 < bbox[2] and nx0 + sx > bbox[0] and ny0 < bbox[3] and ny0 + sy > bbox[1]


def hierarchy(base, cube=None, bbox=None):
    nodes, pages = {}, ['0-0-0-0']
    with ThreadPoolExecutor(32) as ex:
        while pages:
            batch, pages = pages, []
            for h in ex.map(lambda k: json.loads(get(f'{base}/ept-hierarchy/{k}.json')), batch):
                for k, v in h.items():
                    if int(k.split('-')[0]) > MAX_DEPTH or not _hits(k, cube, bbox):
                        continue
                    if v == -1:
                        pages.append(k)
                    elif v > 0:
                        nodes[k] = v
    return nodes


@njit(cache=True)
def accumulate(grid, ix, iy, z):
    ny, nx = grid.shape
    for i in range(z.size):
        x, y = ix[i], iy[i]
        if 0 <= x < nx and 0 <= y < ny and z[i] > grid[y, x]:
            grid[y, x] = z[i]


_grid = None
_geo = None


def init(geo):
    global _grid, _geo
    _geo = geo
    _grid = np.full((geo['ny'], geo['nx']), -np.inf, np.float32)


def work(chunk):
    with ThreadPoolExecutor(8) as ex:
        blobs = ex.map(lambda k: get(f"{_geo['base']}/ept-data/{k}.laz"), chunk)
        for blob in blobs:
            _add(laspy.read(io.BytesIO(blob)))
    np.save(f"{_geo['tmp']}/part_{os.getpid()}.npy", _grid)
    return len(chunk)


def _add(las):
    keep = ~np.isin(np.asarray(las.classification), NOISE)
    if hasattr(las, 'withheld'):
        keep &= ~np.asarray(las.withheld, bool)
    x, y, z = np.asarray(las.x)[keep], np.asarray(las.y)[keep], np.asarray(las.z)[keep]
    ix = np.floor((x - _geo['x0']) / CELL).astype(np.int64)
    iy = np.floor((_geo['y1'] - y) / CELL).astype(np.int64)
    accumulate(_grid, ix, iy, z.astype(np.float32))


def main(base, dem, out):
    meta = json.loads(get(f'{base}/ept.json'))
    bx0, by0, _, bx1, by1, _ = meta['boundsConforming']
    # Optional BBOX="minx,miny,maxx,maxy" (EPSG:3857) to fill a gap from a neighbouring project.
    bbox = [float(v) for v in os.environ['BBOX'].split(',')] if os.environ.get('BBOX') else None
    if bbox:
        bx0, by0, bx1, by1 = max(bx0, bbox[0]), max(by0, bbox[1]), min(bx1, bbox[2]), min(by1, bbox[3])
    x0, y1 = math.floor(bx0 / CELL) * CELL, math.ceil(by1 / CELL) * CELL
    nx, ny = math.ceil((bx1 - x0) / CELL), math.ceil((y1 - by0) / CELL)
    tmp = os.path.splitext(out)[0] + '_tmp'
    os.makedirs(tmp, exist_ok=True)
    nodes = hierarchy(base, meta['bounds'], bbox)
    print(len(nodes), 'nodes', sum(nodes.values()), 'points', nx, ny, flush=True)
    keys = sorted(nodes, key=nodes.get, reverse=True)
    workers = int(os.environ.get('WORKERS', os.cpu_count() or 4))
    chunks = [keys[i::workers * 8] for i in range(workers * 8)]
    geo = dict(base=base, x0=x0, y1=y1, nx=nx, ny=ny, tmp=tmp)
    done = 0
    with ProcessPoolExecutor(workers, initializer=init, initargs=(geo,)) as ex:
        for n in ex.map(work, chunks):
            done += n
            print(f'{done}/{len(keys)} nodes', flush=True)
    top = np.full((ny, nx), -np.inf, np.float32)
    for f in os.listdir(tmp):
        np.maximum(top, np.load(f'{tmp}/{f}'), out=top)
    ground_path = f'{tmp}/ground.tif'
    subprocess.run(['gdalwarp', '-overwrite', '-t_srs', 'EPSG:3857', '-te', str(x0), str(y1 - ny * CELL), str(x0 + nx * CELL), str(y1),
                    '-ts', str(nx), str(ny), '-r', 'average', '-multi', '-wo', 'NUM_THREADS=ALL_CPUS', '-dstnodata', '-9999',
                    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=YES', dem, ground_path], check=True)
    with rasterio.open(ground_path) as g:
        ground = g.read(1)
        profile = g.profile
    valid = np.isfinite(top) & (ground > -9000)
    chm = np.where(valid, np.clip(top - ground, 0, MAX_H), np.nan)
    # Datum sanity check: open ground should sit near zero.
    print('chm p5/p50/p95', np.nanpercentile(chm[::7, ::7], [5, 50, 95]), flush=True)
    profile.update(dtype='float32', nodata=np.nan, compress='deflate', predictor=3, bigtiff='yes')
    with rasterio.open(out, 'w', **profile) as dst:
        dst.write(chm.astype(np.float32), 1)
    print('wrote', out, flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:4])
