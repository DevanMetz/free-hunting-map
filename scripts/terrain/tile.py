"""Turn derive.py / chm.py Byte rasters into RGBA WebP PMTiles.

  python tile.py <layer> <input-glob-or-tif> <out.pmtiles> <maxzoom> [minzoom]
"""
import glob, math, os, subprocess, sys
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
    res = R_Z0 / 2 ** maxzoom
    byte = f'{work}/merc.tif'
    run('gdalwarp', '-overwrite', '-t_srs', 'EPSG:3857', '-tr', res, res, '-tap', '-r', 'average',
        '-srcnodata', 255, '-dstnodata', 255, '-multi', '-wo', 'NUM_THREADS=ALL_CPUS', '-wm', 2048,
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
            step = 4096
            for r in range(0, s.height, step):
                win = Window(0, r, s.width, min(step, s.height - r))
                rgb = lut[s.read(1, window=win)]
                d.write(np.moveaxis(rgb, 2, 0), window=win)
    os.remove(byte)
    run('gdaladdo', '-r', 'average', '--config', 'COMPRESS_OVERVIEW', 'DEFLATE', '--config', 'GDAL_NUM_THREADS', 'ALL_CPUS',
        rgba, *[2 ** i for i in range(1, maxzoom - minzoom + 1)])
    if os.path.exists(out):
        os.remove(out)
    run('rio', 'pmtiles', rgba, out, '--rgba', '-f', 'WEBP', '--co', 'QUALITY=82', '--tile-size', 256,
        '--zoom-levels', f'{minzoom}..{maxzoom}', '--resampling', 'average', '--name', layer,
        '--attribution', 'USGS 3DEP lidar', '--exclude-empty-tiles', '--silent')
    print('done', out, os.path.getsize(out), flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:])
