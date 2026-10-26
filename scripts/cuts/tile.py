#!/usr/bin/env python3
"""Bounded, resumable native-year -> WebP PMTiles pipeline (one 2048px block).

python3 scripts/cuts/tile.py /workspace/gee/cuts
"""
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time

os.environ.setdefault('GDAL_CACHEMAX', '256')
os.environ.setdefault('GDAL_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
import mercantile
import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window
from pmtiles.tile import zxy_to_tileid, Compression, TileType
from pmtiles.writer import Writer

BOUNDS = [-124.85, 24.4, -66.85, 49.4]
MINZOOM, MAXZOOM = 5, 13
STOPS = [(1, '#64869b'), (7, '#80b6ac'), (13, '#e8cf78'), (19, '#ed923e'), (25, '#ef4938')]


def palette():
    lut = np.zeros((256, 4), dtype=np.uint8)
    xs = [s[0] for s in STOPS]
    colors = [[int(c[i:i+2], 16) for i in (1, 3, 5)] for _, c in STOPS]
    for channel in range(3):
        lut[1:26, channel] = np.rint(np.interp(np.arange(1,26), xs, [c[channel] for c in colors])).astype('uint8')
    lut[1:26, 3] = 255
    return lut


def encode(image):
    out = io.BytesIO()
    image.save(out, format='WEBP', lossless=True, method=0)
    return out.getvalue()


def guard(work):
    if shutil.disk_usage(work).free < 11 * 1024**3:
        raise RuntimeError('Stopped before reaching the 10 GiB free-space floor')


def log(work, message):
    print(message, flush=True)
    with (work / 'STATUS.md').open('a') as f:
        f.write(f'\n- Tiling {time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())} UTC: {message}\n')


def build(work):
    guard(work)
    files = sorted((work / 'downloads').glob('*.tif'))
    if not files:
        raise RuntimeError('No source GeoTIFFs')
    export = json.loads((work / 'export.json').read_text())
    if export['status']['state'] != 'COMPLETED':
        raise RuntimeError('Wait for completed EE export before tiling')
    manifest = json.loads((work / 'drive-files.json').read_text())
    assert len(files) == len(manifest['files']) and files, 'Missing Drive shards'
    vrt = work / 'lossyear.vrt'
    subprocess.run(['gdalbuildvrt', '-overwrite', '-srcnodata', '0', '-vrtnodata', '0', str(vrt), *map(str, files)], check=True)
    db = sqlite3.connect(work / 'tiles.sqlite')
    db.execute('PRAGMA cache_size=-32768')
    db.execute('CREATE TABLE IF NOT EXISTS tiles (id INTEGER PRIMARY KEY, z INTEGER, x INTEGER, y INTEGER, data BLOB)')
    db.execute('CREATE INDEX IF NOT EXISTS coords ON tiles(z,x,y)')
    db.execute('CREATE TABLE IF NOT EXISTS done (stage TEXT PRIMARY KEY)')
    lut = palette()
    nw = mercantile.tile(BOUNDS[0], BOUNDS[3], MAXZOOM)
    se = mercantile.tile(BOUNDS[2], BOUNDS[1], MAXZOOM)
    x0, y0 = nw.x // 8 * 8, nw.y // 8 * 8
    x1, y1 = (se.x // 8 + 1) * 8, (se.y // 8 + 1) * 8
    origin = mercantile.xy_bounds(x0, y0, MAXZOOM)
    resolution = 2 * math.pi * 6378137 / (256 * 2**MAXZOOM)
    transform = from_origin(origin.left, origin.top, resolution, resolution)
    total = ((x1-x0)//8)*((y1-y0)//8)
    started = time.monotonic()
    with rasterio.Env(GDAL_CACHEMAX=256*1024**2), rasterio.open(vrt) as src, WarpedVRT(
        src, crs='EPSG:3857', transform=transform, width=(x1-x0)*256,
        height=(y1-y0)*256, resampling=rasterio.enums.Resampling.nearest,
        src_nodata=0, nodata=0, warp_mem_limit=128) as warped:
        count = 0
        for y in range(y0,y1,8):
            for x in range(x0,x1,8):
                count += 1
                key = f'block/{x}/{y}'
                if db.execute('SELECT 1 FROM done WHERE stage=?',(key,)).fetchone():
                    continue
                guard(work)
                values = warped.read(1, window=Window((x-x0)*256,(y-y0)*256,2048,2048))
                if values.max() > 25:
                    raise ValueError('Unexpected loss year')
                for dy in range(8):
                    for dx in range(8):
                        tile = values[dy*256:(dy+1)*256, dx*256:(dx+1)*256]
                        if not tile.any():
                            continue
                        payload = encode(Image.fromarray(lut[tile]))
                        db.execute('INSERT OR REPLACE INTO tiles VALUES (?,?,?,?,?)',
                                   (zxy_to_tileid(MAXZOOM,x+dx,y+dy),MAXZOOM,x+dx,y+dy,payload))
                db.execute('INSERT INTO done VALUES (?)',(key,))
                db.commit()
                if count % 100 == 0:
                    log(work, f'z{MAXZOOM} blocks {count}/{total}; elapsed {time.monotonic()-started:.0f}s')
    log(work, f'z{MAXZOOM} complete')
    for z in range(MAXZOOM-1,MINZOOM-1,-1):
        key = f'zoom/{z}'
        if db.execute('SELECT 1 FROM done WHERE stage=?',(key,)).fetchone():
            continue
        parents = db.execute('SELECT DISTINCT x/2,y/2 FROM tiles WHERE z=?',(z+1,)).fetchall()
        for n,(x,y) in enumerate(parents):
            if n % 1000 == 0:
                guard(work)
                db.commit()
            image = Image.new('RGBA',(512,512))
            for dx in range(2):
                for dy in range(2):
                    child = db.execute('SELECT data FROM tiles WHERE z=? AND x=? AND y=?',(z+1,x*2+dx,y*2+dy)).fetchone()
                    if child:
                        with Image.open(io.BytesIO(child[0])) as part:
                            image.paste(part,(dx*256,dy*256))
            # Pillow averages premultiplied alpha: sparse loss stays sparse at low zoom.
            image = image.resize((256,256),Image.Resampling.BOX)
            if image.getbbox():
                db.execute('INSERT OR REPLACE INTO tiles VALUES (?,?,?,?,?)',(zxy_to_tileid(z,x,y),z,x,y,encode(image)))
        db.execute('INSERT INTO done VALUES (?)',(key,))
        db.commit()
        log(work, f'z{z} complete ({len(parents)} parent tiles)')
    output = work / 'cuts.pmtiles'
    tmp = output.with_suffix('.partial')
    # Writer spools payloads to disk; only its compact directory/index stays in RAM.
    os.environ['TMPDIR'] = str(work)
    import tempfile
    tempfile.tempdir = str(work)
    with tmp.open('wb') as f:
        writer = Writer(f)
        for tileid,data in db.execute('SELECT id,data FROM tiles ORDER BY id'):
            writer.write_tile(tileid,data)
        writer.finalize({'tile_type': TileType.WEBP, 'tile_compression': Compression.NONE,
                         'min_zoom':MINZOOM,'max_zoom':MAXZOOM,
                         'min_lon_e7':round(BOUNDS[0]*1e7),'min_lat_e7':round(BOUNDS[1]*1e7),
                         'max_lon_e7':round(BOUNDS[2]*1e7),'max_lat_e7':round(BOUNDS[3]*1e7),
                         'center_zoom':11,'center_lon_e7':-908194100,'center_lat_e7':445197100},
                        {'name':'Logging cuts','format':'webp','description':'Hansen forest loss 2001–2025; treecover2000 >=25%. Forest loss is not proof of logging.',
                         'attribution':'Hansen/UMD/Google/USGS/NASA Global Forest Change, CC BY 4.0'})
    tmp.replace(output)
    stats = {'bytes':output.stat().st_size,'tiles_by_zoom':dict(db.execute('SELECT z,count(*) FROM tiles GROUP BY z').fetchall()),'bounds':BOUNDS,'palette':STOPS}
    (work/'tile-stats.json').write_text(json.dumps(stats,indent=2)+'\n')
    db.close()
    log(work, f'archive complete: {output}, {output.stat().st_size} bytes')


if __name__ == '__main__':
    build(Path(sys.argv[1] if len(sys.argv)>1 else '/workspace/gee/cuts'))
