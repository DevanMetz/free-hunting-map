"""Canopy height model from a USGS 3DEP Entwine Point Tile (EPT) dataset.

Reads EPT nodes down to MAX_DEPTH (roughly 1 point/m^2 of ground for 1-2 m
lidar), keeps the highest non-noise return per CELL x CELL m cell (EPSG:3857),
and subtracts the bare-earth DEM warped onto the same grid.

  python chm.py https://s3-us-west-2.amazonaws.com/usgs-lidar-public/WI_Clark_2018 \
      /content/dem/mosaic.vrt /content/out/chm.tif

Fill a gap from a neighbouring project, then chm_fill.py it into the main grid:

  BBOX=-10121676,5530840,-10104000,5550000 python chm.py .../WI_12County_9_B22 dem.vrt fill.tif
"""
import json, math, mmap, os, shutil, subprocess, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
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
            time.sleep(2 ** t)


def _hits(key, cube, bbox):
    if bbox is None:
        return True
    d, x, y, _ = map(int, key.split('-'))
    sx, sy = (cube[3] - cube[0]) / 2 ** d, (cube[4] - cube[1]) / 2 ** d
    nx0, ny0 = cube[0] + x * sx, cube[1] + y * sy
    return nx0 < bbox[2] and nx0 + sx > bbox[0] and ny0 < bbox[3] and ny0 + sy > bbox[1]


def hierarchy(base, cube=None, bbox=None):
    nodes, pages = {}, ['0-0-0-0']
    with ThreadPoolExecutor(2) as ex:
        while pages:
            batch, pages = pages[:2], pages[2:]
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


def _add(las):
    keep = ~np.isin(np.asarray(las.classification), NOISE)
    if hasattr(las, 'withheld'):
        keep &= ~np.asarray(las.withheld, bool)
    x, y, z = np.asarray(las.x)[keep], np.asarray(las.y)[keep], np.asarray(las.z)[keep]
    ix = np.floor((x - _geo['x0']) / CELL).astype(np.int64)
    iy = np.floor((_geo['y1'] - y) / CELL).astype(np.int64)
    accumulate(_grid, ix, iy, z.astype(np.float32))


def main(base, dem, out):
    # One disk-backed top grid, one streamed LAZ node, bounded point chunks.
    # Release mapped pages after each chunk so the cgroup never retains the full grid.
    global _grid, _geo
    from rasterio.windows import Window
    from rasterio.transform import from_origin
    from shapely.geometry import shape, box
    from shapely.ops import transform
    from pyproj import Transformer
    meta = json.loads(get(f'{base}/ept.json'))
    if int(meta.get('srs', {}).get('horizontal', 0)) != 3857:
        raise ValueError('EPT must use EPSG:3857')
    bx0, by0, _, bx1, by1, _ = meta['boundsConforming']
    bbox = [float(v) for v in os.environ['BBOX'].split(',')] if os.environ.get('BBOX') else None
    if bbox:
        bx0, by0, bx1, by1 = max(bx0, bbox[0]), max(by0, bbox[1]), min(bx1, bbox[2]), min(by1, bbox[3])
    if bx0 >= bx1 or by0 >= by1:
        raise ValueError('EPT bounds do not intersect BBOX')
    x0, y1 = math.floor(bx0 / CELL) * CELL, math.ceil(by1 / CELL) * CELL
    nx, ny = math.ceil((bx1 - x0) / CELL), math.ceil((y1 - by0) / CELL)
    tmp = os.path.splitext(out)[0] + '_tmp'
    os.makedirs(tmp, exist_ok=True)
    clip = None
    if os.environ.get('CUTLINE'):
        feature = json.load(open(os.environ['CUTLINE']))['features'][0]
        clip = transform(Transformer.from_crs(4326, 3857, always_xy=True).transform, shape(feature['geometry']))
    nodes = hierarchy(base, meta['bounds'], bbox)
    if clip is not None:
        cube = meta['bounds']
        def intersects(k):
            d, x, y, _ = map(int, k.split('-'))
            sx, sy = (cube[3]-cube[0])/2**d, (cube[4]-cube[1])/2**d
            return clip.intersects(box(cube[0]+x*sx, cube[1]+y*sy, cube[0]+(x+1)*sx, cube[1]+(y+1)*sy))
        nodes = {k: n for k, n in nodes.items() if intersects(k)}
    print(len(nodes), 'nodes', sum(nodes.values()), 'points', nx, ny, flush=True)
    top_path = f'{tmp}/top.bin'
    _grid = np.memmap(top_path, dtype='float32', mode='w+', shape=(ny, nx))
    top_fd = os.open(top_path, os.O_RDWR)
    def release_top():
        _grid.flush()
        _grid._mmap.madvise(mmap.MADV_DONTNEED)
        os.posix_fadvise(top_fd, 0, 0, os.POSIX_FADV_DONTNEED)
    for row in range(0, ny, 128):
        _grid[row:row+128] = -np.inf
        release_top()
    _geo = dict(x0=x0, y1=y1)
    downloaded = 0
    node_path = f'{tmp}/node.laz'
    for i, key in enumerate(sorted(nodes, key=nodes.get, reverse=True)):
        for attempt in range(4):
            try:
                with urllib.request.urlopen(f'{base}/ept-data/{key}.laz', timeout=120) as response, open(node_path, 'wb') as f:
                    shutil.copyfileobj(response, f, 1 << 20)
                    expected = response.headers.get('Content-Length')
                if expected and os.path.getsize(node_path) != int(expected):
                    raise IOError('Truncated LAZ')
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        downloaded += os.path.getsize(node_path)
        with laspy.open(node_path, laz_backend=laspy.LazBackend.Lazrs) as reader:
            for points in reader.chunk_iterator(8192):
                _add(points)
                release_top()
        os.unlink(node_path)
        if i % 50 == 0:
            print(f'{i+1}/{len(nodes)} nodes; {downloaded} bytes', flush=True)
    ground_path = f'{tmp}/ground.tif'
    subprocess.run(['gdalwarp', '-overwrite', '-t_srs', 'EPSG:3857', '-te', str(x0), str(y1 - ny * CELL), str(x0 + nx * CELL), str(y1),
                    '-ts', str(nx), str(ny), '-r', 'average', '-wm', '128', '-wo', 'NUM_THREADS=1', '-dstnodata', '-9999',
                    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=YES', dem, ground_path], check=True)
    with rasterio.open(ground_path) as g:
        profile = g.profile.copy()
        profile.update(dtype='float32', nodata=np.nan, compress='deflate', predictor=3, bigtiff='yes')
        with rasterio.open(out, 'w', **profile) as dst:
            for row in range(0, ny, 128):
                win = Window(0, row, nx, min(128, ny-row))
                ground = g.read(1, window=win)
                top = _grid[row:row+int(win.height)]
                valid = np.isfinite(top) & (ground > -9000)
                chm = np.where(valid, np.clip(top-ground, 0, MAX_H), np.nan).astype('float32')
                dst.write(chm, 1, window=win)
                _grid._mmap.madvise(mmap.MADV_DONTNEED)
    _grid._mmap.close()
    os.close(top_fd)
    _grid = None
    shutil.rmtree(tmp)
    with open(out + '.stats.json', 'w') as f:
        json.dump({'bytes_downloaded': downloaded, 'nodes': len(nodes)}, f)
    print('wrote', out, flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:4])
