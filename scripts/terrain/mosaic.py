"""Newest-wins DEM mosaics; bounded, checkpoint-friendly incremental merge for WI blocks."""
import json
import math
import os
import subprocess
import sys


def merge_raster(source, target, bounds, fill_only=False, progress=None, halo=40):
    """Merge one source into a native 1 m grid. Call oldest first; nodata never erases data.

    bounds are native CRS metres. Replaying a source after interruption is idempotent.
    Only raster blocks are held in memory. The caller checkpoints after this closes.
    """
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.windows import Window, from_bounds
    with rasterio.open(source) as src:
        if src.res != (1.0, 1.0) or src.transform.b or src.transform.d:
            raise ValueError(f'Expected north-up native 1 m DEM: {source}')
        # Align to the source grid, retaining a 40 m derivative halo.
        west = src.transform.c + math.floor(bounds[0] - src.transform.c) - halo
        north = src.transform.f + math.ceil(bounds[3] - src.transform.f) + halo
        width = math.ceil(bounds[2] - west) + halo
        height = math.ceil(north - bounds[1]) + halo
        if halo == 0:
            west, north = bounds[0], bounds[3]
            width, height = round(bounds[2]-west), round(north-bounds[1])
        if not os.path.exists(target):
            prof = dict(driver='GTiff', width=width, height=height, count=1,
                        dtype='float32', crs=src.crs, transform=from_origin(west, north, 1, 1),
                        nodata=-999999, tiled=True, blockxsize=512, blockysize=512,
                        compress='deflate', predictor=3, BIGTIFF='YES', SPARSE_OK='YES')
            with rasterio.open(target, 'w', **prof):
                pass
        with rasterio.open(target, 'r+') as dst:
            dx = src.transform.c - dst.transform.c
            dy = dst.transform.f - src.transform.f
            if abs(dx - round(dx)) > 1e-5 or abs(dy - round(dy)) > 1e-5:
                # TNM projects in the same CRS can use integer or half-pixel origins.
                # Match mosaic.py's bilinear resampling on the common native grid.
                from rasterio.vrt import WarpedVRT
                with WarpedVRT(src, crs=dst.crs, transform=dst.transform, width=dst.width, height=dst.height,
                               resampling=rasterio.enums.Resampling.bilinear, nodata=dst.nodata, warp_mem_limit=64) as aligned:
                    for _, win in dst.block_windows(1):
                        a = aligned.read(1, window=win, masked=True)
                        valid = ~np.ma.getmaskarray(a) & np.isfinite(a.data)
                        old = dst.read(1, window=win)
                        if fill_only:
                            valid &= old == dst.nodata
                        if valid.any():
                            old[valid] = a.data[valid]
                            dst.write(old, 1, window=win)
                        if progress:
                            progress()
                return
            dx, dy = round(dx), round(dy)
            for _, win in src.block_windows(1):
                x, y = max(0, win.col_off + dx), max(0, win.row_off + dy)
                right = min(dst.width, win.col_off + dx + win.width)
                bottom = min(dst.height, win.row_off + dy + win.height)
                if right <= x or bottom <= y:
                    continue
                sw = Window(x - dx, y - dy, right - x, bottom - y)
                dw = Window(x, y, right - x, bottom - y)
                a = src.read(1, window=sw, masked=True)
                valid = ~np.ma.getmaskarray(a) & np.isfinite(a.data)
                if not valid.any():
                    continue
                old = dst.read(1, window=dw)
                if fill_only:
                    valid &= old == dst.nodata
                if not valid.any():
                    continue
                old[valid] = a.data[valid]
                dst.write(old, 1, window=dw)
                if progress:
                    progress()


def merge_tiles(source, directory, bounds, block=2500, progress=None):
    """Newest-first merge into independently releasable native chunks."""
    from pathlib import Path
    import rasterio
    from rasterio.transform import from_origin
    directory = Path(directory)
    grid_path = directory/'grid.json'
    with rasterio.open(source) as src:
        if grid_path.exists():
            grid = json.loads(grid_path.read_text())
            if grid['block'] != block:
                raise ValueError('BLOCK cannot change during a partially completed block')
        else:
            west = src.transform.c + math.floor(bounds[0]-src.transform.c)-40
            north = src.transform.f + math.ceil(bounds[3]-src.transform.f)+40
            grid = dict(west=west, north=north, width=math.ceil(bounds[2]-west)+40,
                        height=math.ceil(north-bounds[1])+40, block=block)
        nx, ny = math.ceil(grid['width']/block), math.ceil(grid['height']/block)
        def extent(x, y):
            w, n = grid['west']+x*block, grid['north']-y*block
            return w, max(grid['north']-grid['height'], n-block), min(grid['west']+grid['width'], w+block), n
        # Corner files hold the full grid extent even where no source has data.
        for x, y in ((0, 0), (nx-1, ny-1)):
            target = directory/f'dem_{x:03}_{y:03}.tif'
            if not target.exists():
                w, s, e, n = extent(x, y)
                with rasterio.open(target, 'w', driver='GTiff', width=round(e-w), height=round(n-s), count=1,
                                   dtype='float32', crs=src.crs, transform=from_origin(w, n, 1, 1), nodata=-999999,
                                   tiled=True, blockxsize=512, blockysize=512, compress='deflate', predictor=3,
                                   BIGTIFF='YES', SPARSE_OK='YES'):
                    pass
        if not grid_path.exists():
            tmp = grid_path.with_suffix('.tmp')
            tmp.write_text(json.dumps(grid))
            os.replace(tmp, grid_path)
        x0 = max(0, math.floor((src.bounds.left-grid['west'])/block))
        x1 = min(nx-1, math.ceil((src.bounds.right-grid['west'])/block)-1)
        y0 = max(0, math.floor((grid['north']-src.bounds.top)/block))
        y1 = min(ny-1, math.ceil((grid['north']-src.bounds.bottom)/block)-1)
    changed = []
    for y in range(y0, y1+1):
        for x in range(x0, x1+1):
            target = directory/f'dem_{x:03}_{y:03}.tif'
            merge_raster(source, target, extent(x, y), fill_only=True, progress=progress, halo=0)
            changed.append(target)
    return changed


def main(d):
    from pathlib import Path
    items = json.loads(Path(d, 'items.json').read_text())
    items.sort(key=lambda i: i['publicationDate'])
    files = [f"{d}/{os.path.basename(i['downloadURL'])}" for i in items]
    # Missing files must never silently turn into published holes.
    if not all(os.path.exists(f) for f in files):
        raise FileNotFoundError('Missing DEM source')
    Path(d, 'files.txt').write_text('\n'.join(files) + '\n')
    subprocess.run(['gdalbuildvrt', '-overwrite', '-r', 'bilinear', '-srcnodata', '-999999', '-vrtnodata', '-999999',
                    '-input_file_list', f'{d}/files.txt', f'{d}/mosaic.vrt'], check=True)
    print(len(files), 'files')


if __name__ == '__main__':
    main(sys.argv[1])
