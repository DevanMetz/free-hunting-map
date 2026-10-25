"""Turn derive.py / chm.py Byte rasters into RGBA WebP PMTiles.

  python tile.py <layer> <input-glob-or-tif> <out.pmtiles> <maxzoom> [minzoom]
"""
import glob, json, math, os, shutil, subprocess, sys
import numpy as np
import rasterio
from rasterio.windows import Window
from palettes import table

R_Z0 = 2 * math.pi * 6378137 / 256  # metres/px at z0 for 256 px tiles


def run(*cmd):
    print('+', ' '.join(map(str, cmd)), flush=True)
    subprocess.run([str(c) for c in cmd], check=True)


def main(layer, src, out, maxzoom, minzoom=8):
    maxzoom, minzoom = int(maxzoom), int(minzoom)
    work = os.path.splitext(out)[0] + '_work'
    os.makedirs(work, exist_ok=True)
    files = sorted(glob.glob(src))
    vrt = f'{work}/src.vrt'
    run('gdalbuildvrt', '-overwrite', vrt, *files)
    res = R_Z0 / 2 ** (16 if os.environ.get('TILE_BOUNDS') else maxzoom)
    extent = ['-te', *os.environ['TILE_BOUNDS'].split(',')] if os.environ.get('TILE_BOUNDS') else []
    cutline = ['-cutline', os.environ['CUTLINE']] if os.environ.get('CUTLINE') else []
    byte = f'{work}/merc.tif'
    run('gdalwarp', '-overwrite', '-t_srs', 'EPSG:3857', '-tr', res, res, '-tap', '-r', 'average',
        '-srcnodata', 255, '-dstnodata', 255, '-wo', 'NUM_THREADS=1', '-wm', 256,
        *extent, *cutline,
        '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=YES', vrt, byte)
    lut = table(layer)
    rgba = f'{work}/rgba.tif'
    with rasterio.open(byte) as s:
        prof = s.profile.copy()
        prof.update(count=4, nodata=None, photometric='RGB', compress='deflate', predictor=2, bigtiff='yes',
                    tiled=True, blockxsize=512, blockysize=512)
        with rasterio.open(rgba, 'w', **prof) as d:
            d.colorinterp = [rasterio.enums.ColorInterp.red, rasterio.enums.ColorInterp.green,
                             rasterio.enums.ColorInterp.blue, rasterio.enums.ColorInterp.alpha]
            step = int(os.environ.get('RGBA_STEP', '512'))
            data_extent = [s.width, s.height, 0, 0]
            for r in range(0, s.height, step):
                win = Window(0, r, s.width, min(step, s.height - r))
                values = s.read(1, window=win)
                valid = values != 255
                rows = np.flatnonzero(valid.any(axis=1))
                cols = np.flatnonzero(valid.any(axis=0))
                if rows.size:
                    data_extent = [min(data_extent[0], int(cols[0])), min(data_extent[1], r+int(rows[0])),
                                   max(data_extent[2], int(cols[-1])+1), max(data_extent[3], r+int(rows[-1])+1)]
                rgb = lut[values]
                d.write(np.moveaxis(rgb, 2, 0), window=win)
        if data_extent[2] <= data_extent[0]:
            raise ValueError('No valid pixels to tile')
        left, top = s.transform * (data_extent[0], data_extent[1])
        right, bottom = s.transform * (data_extent[2], data_extent[3])
        from rasterio.warp import transform_bounds
        bounds = transform_bounds(s.crs, 'EPSG:4326', left, bottom, right, top)
        with open(out + '.bounds.json', 'w') as f:
            json.dump(bounds, f)
    os.remove(byte)
    run('gdaladdo', '-r', 'average', '--config', 'COMPRESS_OVERVIEW', 'DEFLATE', '--config', 'GDAL_NUM_THREADS', '1',
        rgba, *[2 ** i for i in range(1, maxzoom - minzoom + 1)])
    if os.path.exists(out):
        os.remove(out)
    run('rio', 'pmtiles', rgba, out, '--rgba', '-f', 'WEBP', '--co', 'QUALITY=82', '--tile-size', 256,
        '--zoom-levels', f'{minzoom}..{maxzoom}', '--resampling', 'average', '--name', layer,
        '--attribution', 'USGS 3DEP lidar', '--exclude-empty-tiles', '--silent',
        '-j', min(2, int(os.environ.get('WORKERS', '2'))))
    shutil.rmtree(work)
    print('done', out, os.path.getsize(out), flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:])
