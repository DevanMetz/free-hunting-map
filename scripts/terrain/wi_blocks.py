#!/usr/bin/env python3
"""Resumable, serial Wisconsin z9 terrain builds. See README.md for resource limits."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path(__file__).resolve().parent
BASE = Path('/workspace/terrain-build/wi-v2')
STAGES = ('dem', 'derive', 'chm', 'tile', 'upload', 'archive', 'cleanup')
LAYERS = ('lrm', 'openness', 'hillshade', 'slope', 'chm')
R = 6378137
WORLD = math.pi * R
TNM = 'https://tnmaccess.nationalmap.gov/api/v1/products'
EPT_INDEX = 'https://raw.githubusercontent.com/hobu/usgs-lidar/master/boundaries/resources.geojson'
BLOCK_ZOOM = 9
CLARK_BOUNDS = [-90.93, 44.42, -90.31, 45.04]
MAX_SCRATCH = 20_000_000_000
MIN_FREE = 10 * 1024**3
STAGE_HEADROOM = 4 * 1024**3
DISK_RESERVE = 1024**3  # Stop writers before they reach the hard free-space floor.
RETRY_SECONDS = 600
CG = Path('/sys/fs/cgroup/fhm')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def log(message):
    print(f'{now()} {message}', flush=True)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    with tmp.open('w') as f:
        json.dump(value, f, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def tile_xy(lon, lat, z=BLOCK_ZOOM):
    n = 2**z
    lat = max(-85.0511287798066, min(85.0511287798066, lat))
    return (max(0, min(n-1, math.floor((lon+180)/360*n))),
            max(0, min(n-1, math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n))))


def tile_bounds(x, y, z=BLOCK_ZOOM):
    n = 2**z
    lat = lambda j: math.degrees(math.atan(math.sinh(math.pi*(1-2*j/n))))
    return [x/n*360-180, lat(y+1), (x+1)/n*360-180, lat(y)]


def merc_bounds(x, y, z=BLOCK_ZOOM):
    width = 2*WORLD/2**z
    return [-WORLD+x*width, WORLD-(y+1)*width, -WORLD+(x+1)*width, WORLD-y*width]


def block_version(block_id):
    match = re.fullmatch(rf'b{BLOCK_ZOOM}-(\d{{1,3}})-(\d{{1,3}})', block_id)
    if not match or any(int(v) >= 2**BLOCK_ZOOM for v in match.groups()):
        raise ValueError(f'Invalid z{BLOCK_ZOOM} block')
    return 'v2/' + block_id


def next_stage(block):
    for stage in STAGES:
        if block.get('stages', {}).get(stage, {}).get('status') not in ('done', 'skipped'):
            return stage
    return None


def state_polygon(base=BASE):
    import fiona
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform
    archive = base / 'cb_2024_us_state_500k.zip'
    with fiona.open('zip://' + str(archive)) as src:
        feature = next(f for f in src if f['properties']['STATEFP'] == '55')
        native = shape(feature['geometry'])
        to_area = Transformer.from_crs(src.crs, 5070, always_xy=True).transform
        area = transform(to_area, native)
    to_geo = Transformer.from_crs(5070, 4326, always_xy=True).transform
    return transform(to_geo, area), transform(to_geo, area.buffer(500))


def make_blocks(state, buffered):
    from pyproj import Transformer
    from shapely.geometry import box, mapping
    from shapely.ops import transform
    project = Transformer.from_crs(4326, 5070, always_xy=True).transform
    west, south, east, north = buffered.bounds
    left, top = tile_xy(west, north)
    right, bottom = tile_xy(east, south)
    blocks = []
    for y in range(top, bottom+1):
        for x in range(left, right+1):
            extent = box(*tile_bounds(x, y))
            clip = buffered.intersection(extent)
            if clip.is_empty or clip.area == 0:
                continue
            blocks.append(dict(id=f'b{BLOCK_ZOOM}-{x}-{y}', x=x, y=y, bounds=list(clip.bounds),
                               geometry=mapping(clip), km2=transform(project, state.intersection(extent)).area/1e6,
                               clark_km2=transform(project, clip.intersection(box(*CLARK_BOUNDS))).area/1e6,
                               status='pending', attempts=0, stages={}))
    return sorted(blocks, key=lambda b: (-b['clark_km2'], -b['km2'], b['id']))


@contextlib.contextmanager
def lock(base):
    base.mkdir(parents=True, exist_ok=True)
    with (base/'run.lock').open('a+') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another plan/run holds run.lock') from None
        f.seek(0)
        f.truncate()
        f.write(str(os.getpid()))
        f.flush()
        yield


def plan(base):
    path = base/'manifest.json'
    if path.exists():
        manifest = json.loads(path.read_text())
        if manifest['block_zoom'] != BLOCK_ZOOM:
            raise ValueError('Archive the old manifest and replan before running this grid')
        return manifest
    state, buffered = state_polygon(base)
    manifest = dict(schema=1, created=now(), source=str(base/'cb_2024_us_state_500k.zip'),
                    buffer_m=500, block_zoom=BLOCK_ZOOM, blocks=make_blocks(state, buffered))
    atomic_json(path, manifest)
    return manifest


def get_json(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(60, 2**attempt))


def download(url, path, expected=None, progress=None, reserve=None):
    """Resume contiguous HTTP bytes; TNM size is advisory, HTTP size is persisted."""
    path = Path(path)
    part = path.with_suffix(path.suffix + '.partial')
    metadata = path.with_suffix(path.suffix + '.http.json')
    recorded = json.loads(metadata.read_text()) if metadata.exists() else {}
    if path.exists():
        if recorded.get('url') == url and recorded.get('complete') and path.stat().st_size == recorded['total']:
            return 0
        # Legacy/unverified files must be fetched again, never accepted by TNM size.
        path.unlink()
    if (part.exists() and recorded.get('url') == url and recorded.get('complete')
            and part.stat().st_size == recorded['total']):
        os.replace(part, path)
        return 0
    transferred = 0
    for attempt in range(5):
        offset = part.stat().st_size if part.exists() else 0
        if recorded and not recorded.get('complete') and offset >= recorded['total']:
            # All bytes arrived but validation/checkpoint did not finish. Re-fetch;
            # neither TNM nor an unvalidated full partial proves completion.
            part.unlink(missing_ok=True)
            offset = 0
        try:
            req = urllib.request.Request(url, headers={'Range': f'bytes={offset}-'} if offset else {})
            with urllib.request.urlopen(req, timeout=120) as response:
                if response.status not in (200, 206):
                    raise IOError(f'Unexpected HTTP status {response.status}')
                if response.status == 200:
                    offset = 0
                length = response.headers.get('Content-Length')
                if response.status == 206:
                    cr = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
                    if not cr or int(cr[1]) != offset or not offset <= int(cr[2]) < int(cr[3]):
                        raise IOError('Unexpected Content-Range')
                    total, end = int(cr[3]), int(cr[2])+1
                    if length is not None and int(length) != end-offset:
                        raise IOError('Content-Length disagrees with Content-Range')
                    if recorded and (recorded.get('url') != url or recorded['total'] != total):
                        part.unlink(missing_ok=True)
                        metadata.unlink(missing_ok=True)
                        recorded = {}
                        raise IOError('HTTP source changed during range resume; restarting')
                else:
                    if length is None:
                        raise IOError('Missing authoritative HTTP size')
                    total = end = int(length)
                if total <= 0:
                    raise IOError('Empty HTTP source')
                if expected and total != expected:
                    log(f'WARNING source size differs: TNM={expected}, HTTP={total}; using HTTP')
                if reserve:
                    reserve(total)
                recorded = dict(url=url, total=total, complete=False)
                atomic_json(metadata, recorded)
                received = 0
                with part.open('ab' if offset else 'wb') as f:
                    while chunk := response.read(1 << 20):
                        if received+len(chunk) > end-offset:
                            raise IOError('HTTP body exceeds declared range')
                        f.write(chunk)
                        received += len(chunk)
                        transferred += len(chunk)
                        if progress:
                            progress(len(chunk))
                    f.flush()
                    os.fsync(f.fileno())
                if received != end-offset or part.stat().st_size != total:
                    raise IOError('Truncated download')
            recorded['complete'] = True
            atomic_json(metadata, recorded)
            os.replace(part, path)
            return transferred
        except Exception:
            if attempt == 4:
                raise
            time.sleep(min(60, 2**attempt))


def project_year(name):
    # LAS suffixes describe packaging, not acquisition. Undated statewide
    # composites are last-resort gap fills; their unknown dates stay explicit.
    name = name.split('_LAS_')[0]
    years = [int(y) for y in re.findall(r'(?:19|20)\d{2}', name)]
    years += [2000+int(y) for y in re.findall(r'_[A-Z](\d{2})(?:_|$)', name)]
    return max(years, default=0)


def disk_bytes(path):
    total = 0
    for p in path.rglob('*'):
        try:
            if p.is_file():
                total += p.stat().st_blocks*512
        except FileNotFoundError:
            pass  # A running stage can retire a consumed input during the scan.
    return total


class Runner:
    def __init__(self, base, manifest):
        self.base, self.manifest = base, manifest
        self.work = base/'work'
        self.work.mkdir(exist_ok=True)
        temporary = self.work/'tmp'
        temporary.mkdir(exist_ok=True)
        self.env = {**os.environ, 'TMPDIR': str(temporary)}
        self.env.update(GDAL_CACHEMAX='64', GDAL_NUM_THREADS='1', NUMBA_NUM_THREADS='1',
                        OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', MKL_NUM_THREADS='1',
                        BLOCK=os.environ.get('BLOCK', '2500'), WORKERS=str(min(3, int(os.environ.get('WORKERS', '2')))),
                        RGBA_STEP='256', PYTHONUNBUFFERED='1')
        self.block = None
        self.stage = None
        self.last_disk = 0
        self.peak = 0

    def save(self):
        self.manifest['updated'] = now()
        atomic_json(self.base/'manifest.json', self.manifest)

    def wait_disk(self, extra=DISK_RESERVE, process=None, reason='scratch guard'):
        stopped = False
        try:
            while True:
                used = disk_bytes(self.work)
                free = shutil.disk_usage(self.work).free
                if free >= MIN_FREE+extra and used < MAX_SCRATCH:
                    break
                if process is not None and not stopped and process.poll() is None:
                    os.killpg(process.pid, signal.SIGSTOP)
                    stopped = True
                log(f'waiting for disk: {reason}; free={free/1024**3:.2f} GiB, '
                    f'required={(MIN_FREE+extra)/1024**3:.2f} GiB, scratch={used/1024**3:.2f} GiB')
                if self.stage is not None:
                    self.stage['waiting'] = f'disk: {reason}'
                    self.save()
                time.sleep(RETRY_SECONDS)
        finally:
            if stopped and process.poll() is None:
                os.killpg(process.pid, signal.SIGCONT)
        if self.stage is not None:
            self.stage.pop('waiting', None)

    def guard(self, force=False, process=None):
        if CG.exists():
            memory = int((CG/'memory.current').read_text())
            self.peak = max(self.peak, memory)
            if memory > 1600*1024**2:
                self.release_cache()
        if force or time.monotonic()-self.last_disk > 5:
            self.last_disk = time.monotonic()
            used = disk_bytes(self.work)
            self.wait_disk(process=process)
            if self.stage is not None:
                self.stage['scratch_peak_bytes'] = max(self.stage.get('scratch_peak_bytes', 0), used)
                self.stage['cgroup_peak_observed_bytes'] = self.peak
                self.save()

    def release_cache(self):
        # fsync makes DONTNEED effective for dirty output pages too. No global drop_caches.
        for path in self.work.rglob('*'):
            try:
                if path.is_file() and path.stat().st_size > 1024**2:
                    with path.open('rb') as f:
                        os.fsync(f.fileno())
                        os.posix_fadvise(f.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)
            except FileNotFoundError:
                pass

    def command(self, *args, env=None, timeout=None):
        log('+ ' + ' '.join(map(str, args)))
        self.wait_disk(STAGE_HEADROOM, reason='command headroom')
        self.guard(True)
        started = time.monotonic()
        with subprocess.Popen(['nice', '-n', '10', *map(str, args)], cwd=ROOT, env={**self.env, **(env or {})}, start_new_session=True) as p:
            try:
                while p.poll() is None:
                    self.guard(process=p)
                    if timeout and time.monotonic()-started > timeout:
                        raise TimeoutError(f'Command exceeded {timeout}s')
                    time.sleep(2)
                if p.returncode:
                    raise subprocess.CalledProcessError(p.returncode, args)
            except BaseException:
                if p.poll() is None:
                    os.killpg(p.pid, signal.SIGTERM)
                    try:
                        p.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(p.pid, signal.SIGKILL)
                        p.wait()
                raise
        self.guard(True)

    def script(self, name, *args, **kwargs):
        self.command(sys.executable, SCRIPTS/name, *args, **kwargs)

    def paths(self):
        work = self.work/self.block['id']
        work.mkdir(exist_ok=True)
        return work

    def cutline(self):
        path = self.paths()/'clip.geojson'
        if not path.exists():
            atomic_json(path, dict(type='FeatureCollection', features=[dict(type='Feature', properties={}, geometry=self.block['geometry'])]))
        return path

    def dem(self):
        from shapely.geometry import shape, box
        import rasterio
        from rasterio.warp import transform_bounds
        from mosaic import merge_tiles
        work = self.paths()
        dem = work/'dem'
        dem.mkdir(exist_ok=True)
        catalog = dem/'catalog.json'
        clip = shape(self.block['geometry'])
        if not catalog.exists():
            items, offset = {}, 0
            while True:
                params = dict(datasets='Digital Elevation Model (DEM) 1 meter', bbox=','.join(map(str, clip.bounds)), max=100, offset=offset)
                data = get_json(TNM+'?'+urllib.parse.urlencode(params))
                if data.get('errors'):
                    raise RuntimeError(data['errors'])
                page = data.get('items', [])
                for item in page:
                    b = item['boundingBox']
                    if clip.intersects(box(b['minX'], b['minY'], b['maxX'], b['maxY'])):
                        if not item['downloadURL'].lower().endswith('.tif'):
                            raise ValueError('Expected GeoTIFF DEM')
                        items[item['downloadURL']] = item
                offset += len(page)
                if offset >= data['total']:
                    break
                if not page:
                    raise RuntimeError('TNM pagination ended before total')
            if not items:
                raise ValueError('No 1 m DEM available for this WI block')
            atomic_json(catalog, sorted(items.values(), key=lambda i: (i['publicationDate'], i['downloadURL']), reverse=True))
        items = json.loads(catalog.read_text())
        self.stage['tiles_total'] = len(items)
        estimate = int(0.55 * sum(int(i.get('sizeInBytes') or 0) for i in items))
        self.stage['estimated_dem_bytes'] = estimate
        # Already merged chunks occupy space counted by disk_usage; reserve only growth.
        self.wait_disk(max(0, estimate-disk_bytes(dem))+STAGE_HEADROOM, reason='DEM preflight')
        completed = self.stage.setdefault('sources', {})
        groups = self.stage.setdefault('groups', {})
        for index, item in enumerate(items):
            url = item['downloadURL']
            key = hashlib.sha256(url.encode()).hexdigest()[:16]
            raw = dem/(key+'.tif')
            if key in completed:
                for suffix in ('.tif', '.tif.partial', '.tif.http.json'):
                    raw.with_suffix(suffix).unlink(missing_ok=True)
                continue
            self.guard(True)
            log(f'{self.block["id"]} dem {index+1}/{len(items)} {Path(url).name}')
            size = int(item.get('sizeInBytes') or 0)
            self.wait_disk(max(DISK_RESERVE, 2*size), reason='DEM source')
            def progress(n):
                self.stage['bytes_downloaded'] = self.stage.get('bytes_downloaded', 0)+n
                self.guard()
            download(url, raw, size or None, progress,
                     reserve=lambda total: self.wait_disk(max(DISK_RESERVE, 2*total), reason='HTTP source'))
            with rasterio.open(raw) as src:
                epsg = src.crs.to_epsg()
                if not epsg:
                    raise ValueError('DEM CRS has no EPSG code')
                bounds = transform_bounds('EPSG:4326', src.crs, *clip.bounds, densify_pts=21)
            group = dem/str(epsg)
            group.mkdir(exist_ok=True)
            # First source wins because the catalog is newest first. No resampling.
            with rasterio.Env(GDAL_CACHEMAX=64*1024**2):
                changed = merge_tiles(raw, group, bounds, block=int(self.env['BLOCK']), progress=self.guard)
            # Ensure raster data is on disk before committing the checkpoint.
            for target in changed:
                with target.open('rb') as f:
                    os.fsync(f.fileno())
            groups[str(epsg)] = str(group)
            completed[key] = dict(url=url, bytes=raw.stat().st_size, epsg=epsg, publication=item['publicationDate'])
            self.stage['tiles_done'] = len(completed)
            self.save()
            raw.unlink()
            raw.with_suffix('.tif.http.json').unlink(missing_ok=True)
            self.release_cache()
        for group in groups.values():
            atomic_json(Path(group)/'items.json', [dict(downloadURL=p.name, publicationDate='2000-01-01')
                                                  for p in sorted(Path(group).glob('dem_*.tif'))])
            self.script('mosaic.py', group)
        # Save the small 4 m ground grid before native DEMs are released in derive.
        # Warp each CRS separately, then combine in publication order.
        ground = work/'ground.tif'
        bounds = merc_bounds(self.block['x'], self.block['y'])
        snapped = [math.floor(bounds[0]/4)*4, math.floor(bounds[1]/4)*4, math.ceil(bounds[2]/4)*4, math.ceil(bounds[3]/4)*4]
        ordered = sorted(groups, key=lambda epsg: max(i['publication'] for i in completed.values() if str(i['epsg']) == epsg))
        self.block['crs_order'] = ordered
        self.command('gdalwarp', '-overwrite', '-t_srs', 'EPSG:3857', '-te', *snapped, '-tr', 4, 4, '-r', 'average',
                     '-wm', 128, '-wo', 'NUM_THREADS=1', '-dstnodata', -9999, '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
                     '-co', 'BIGTIFF=YES', *[Path(groups[e])/'mosaic.vrt' for e in ordered], ground)
        self.stage['retained_bytes'] = disk_bytes(dem)

    def derive(self):
        work = self.paths()
        completed = self.stage.setdefault('groups_done', [])
        groups = self.block['stages']['dem']['groups']
        for epsg in self.block['crs_order']:
            if epsg in completed:
                shutil.rmtree(groups[epsg], ignore_errors=True)
                continue
            self.stage['current'] = epsg
            self.script('derive.py', Path(groups[epsg])/'mosaic.vrt', work/'derived'/epsg,
                        env={'DEM_CONSUME': str(groups[epsg])})
            completed.append(epsg)
            self.save()
            # Ground is already persisted at the CHM grid resolution.
            shutil.rmtree(groups[epsg])
        self.stage['output_bytes'] = disk_bytes(work/'derived')

    def chm(self):
        from shapely.geometry import shape
        work = self.paths()
        index = self.base/'ept-resources.geojson'
        if not index.exists():
            atomic_json(index, get_json(EPT_INDEX))
        clip = shape(self.block['geometry'])
        projects = [f for f in json.loads(index.read_text())['features'] if shape(f['geometry']).intersects(clip)]
        def year(f):
            return project_year(f['properties']['name']), f['properties']['name']
        projects.sort(key=year, reverse=True)
        if not projects:
            raise ValueError('No EPT coverage for block')
        self.stage['projects'] = [f['properties']['name'] for f in projects]
        self.stage['acquisition_years'] = {f['properties']['name']: project_year(f['properties']['name']) or None for f in projects}
        completed = self.stage.setdefault('projects_done', [])
        chm = work/'chm'
        chm.mkdir(exist_ok=True)
        main = chm/'chm.tif'
        if not main.exists():
            import rasterio
            with rasterio.open(work/'ground.tif') as ground:
                profile = ground.profile.copy()
            profile.update(dtype='float32', nodata=float('nan'), compress='deflate', predictor=3, SPARSE_OK='YES', BIGTIFF='YES')
            with rasterio.open(main, 'w', **profile):
                pass
        env = dict(BBOX=','.join(map(str, merc_bounds(self.block['x'], self.block['y']))), CUTLINE=str(self.cutline()))
        for feature in projects:
            name = feature['properties']['name']
            if name in completed:
                continue
            self.stage['current'] = name
            url = feature['properties']['url'].removesuffix('/ept.json')
            output = chm/'fill.tif'
            self.script('chm.py', url, work/'ground.tif', output, env=env)
            if main.exists():
                self.script('chm_fill.py', main, output)
            else:
                os.replace(output, main)
            stats = json.loads(Path(str(output)+'.stats.json').read_text())
            self.stage['bytes_downloaded'] = self.stage.get('bytes_downloaded', 0)+stats['bytes_downloaded']
            completed.append(name)
            self.save()
            output.unlink(missing_ok=True)
        self.script('chm_byte.py', main, chm/'chm_byte.tif')
        # Keep float CHM/ground until the stage checkpoint is committed.

    def tile(self):
        work = self.paths()
        (work/'chm'/'chm.tif').unlink(missing_ok=True)
        (work/'ground.tif').unlink(missing_ok=True)
        pm = work/'pm'
        pm.mkdir(exist_ok=True)
        completed = self.stage.setdefault('layers', {})
        env = dict(TILE_BOUNDS=','.join(map(str, merc_bounds(self.block['x'], self.block['y']))), CUTLINE=str(self.cutline()))
        def consume(layer):
            shutil.rmtree(work/('warp-'+layer), ignore_errors=True)
            if layer == 'chm':
                (work/'chm'/'chm_byte.tif').unlink(missing_ok=True)
            else:
                for epsg in self.block['crs_order']:
                    shutil.rmtree(work/'derived'/epsg/layer, ignore_errors=True)
        for layer in LAYERS:
            if layer in completed:
                consume(layer)
                continue
            self.stage['current'] = layer
            sources = []
            merged = work/('warp-'+layer)
            merged.mkdir(exist_ok=True)
            if layer == 'chm':
                source = str(work/'chm'/'chm_byte.tif')
            else:
                # gdalbuildvrt cannot combine CRS groups; warp each to the same z16 grid.
                for epsg in self.block['crs_order']:
                    vrt = merged/(epsg+'.vrt')
                    sources_in = sorted((work/'derived'/epsg/layer).glob('*.tif'))
                    if not sources_in:
                        raise ValueError(f'Missing derivative inputs: {epsg}/{layer}')
                    listing = merged/(epsg+'.txt')
                    listing.write_text('\n'.join(map(str, sources_in))+'\n')
                    self.command('gdalbuildvrt', '-overwrite', '-input_file_list', listing, vrt)
                    dest = merged/(epsg+'.tif')
                    self.command('gdalwarp', '-overwrite', '-t_srs', 'EPSG:3857', '-te', *merc_bounds(self.block['x'], self.block['y']),
                                 '-tr', 2*WORLD/(256*2**16), 2*WORLD/(256*2**16), '-tap', '-r', 'average',
                                 '-srcnodata', 255, '-dstnodata', 255, '-wm', 128, '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
                                 '-co', 'BIGTIFF=YES', vrt, dest)
                    sources.append(dest)
                combined = merged/'combined.vrt'
                self.command('gdalbuildvrt', '-overwrite', combined, *sources)
                source = str(combined)
            archive = pm/f'lidar-{layer}.pmtiles'
            self.script('tile.py', layer, source, archive, 15 if layer == 'chm' else 16, BLOCK_ZOOM, env=env)
            # Find an actual nonempty z14 tile for public verification, even on coastal slivers.
            from pmtiles.reader import Reader, MmapSource
            with archive.open('rb') as f:
                import mmap
                with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                    reader = Reader(lambda offset, length: mm[offset:offset+length])
                    bounds = self.block['bounds']
                    x0, y0 = tile_xy(bounds[0], bounds[3], 14)
                    x1, y1 = tile_xy(bounds[2], bounds[1], 14)
                    tile = next(([14, x, y] for y in range(y0, y1+1) for x in range(x0, x1+1) if reader.get(14, x, y)), None)
                    if tile is None:
                        raise ValueError(f'Empty archive for {layer}')
            with archive.open('rb') as f:
                digest = hashlib.file_digest(f, 'sha256').hexdigest()
            completed[layer] = dict(bytes=archive.stat().st_size, sha256=digest, check_tile=tile,
                                    bounds=json.loads(Path(str(archive)+'.bounds.json').read_text()))
            self.save()
            consume(layer)

    def upload(self):
        work = self.paths()
        completed = self.stage.setdefault('layers', {})
        for layer in LAYERS:
            if layer in completed:
                continue
            env = dict(UPLOAD_RESUME='1', UPLOAD_BOUNDS=','.join(map(str, self.block['stages']['tile']['layers'][layer]['bounds'])))
            self.script('upload.py', 'lidar-'+layer, block_version(self.block['id']), work/'pm'/f'lidar-{layer}.pmtiles', env=env)
            tile = self.block['stages']['tile']['layers'][layer]['check_tile']
            url = 'https://freehuntingmap.com/tiles/lidar-'+layer+'/v2/'+'/'.join(map(str, tile))+'.webp'
            response = work/f'{layer}-check.webp'
            self.command('curl', '--http1.1', '-fSL', '--retry', 5, '--retry-all-errors', '--max-time', 120,
                         '-D', work/f'{layer}-headers.txt', '-o', response, url)
            headers = (work/f'{layer}-headers.txt').read_text().lower()
            if 'content-type: image/webp' not in headers or response.read_bytes()[:4] != b'RIFF':
                raise RuntimeError(f'Not a WebP response: {url}')
            from pmtiles.reader import Reader, MmapSource
            with (work/'pm'/f'lidar-{layer}.pmtiles').open('rb') as archive:
                expected = Reader(MmapSource(archive)).get(*tile)
            if response.read_bytes() != expected:
                raise RuntimeError(f'Public tile differs from archive (possible v1 fallback): {url}')
            completed[layer] = dict(verified=now(), url=url)
            self.save()
        # Save a small Clark comparison for review once the first block reaches publication.
        if self.block.get('clark_km2', 0) > 0:
            self.compare_clark()

    def compare_clark(self):
        from PIL import Image, ImageDraw
        from shapely.geometry import shape, box
        point = shape(self.block['geometry']).intersection(box(*CLARK_BOUNDS)).representative_point()
        x, y = tile_xy(point.x, point.y, 14)
        folder = self.base/'clark-comparison'/self.block['id']
        folder.mkdir(parents=True, exist_ok=True)
        results = {}
        for layer in LAYERS:
            images = []
            for version in ('v1', 'v2'):
                path = folder/f'{layer}-{version}.webp'
                self.command('curl', '--http1.1', '-fsSL', '--retry', 5, '--retry-all-errors', '--max-time', 120,
                             '-o', path, f'https://freehuntingmap.com/tiles/lidar-{layer}/{version}/14/{x}/{y}.webp')
                images.append(Image.open(path).convert('RGBA'))
            canvas = Image.new('RGB', (512, 280), 'white')
            for i, im in enumerate(images):
                canvas.paste(im, (256*i, 24), im)
            ImageDraw.Draw(canvas).text((8, 4), f'{layer}: v1 (left) / v2 (right)', fill='black')
            canvas.save(folder/f'{layer}.png')
            results[layer] = dict(tile=[14, x, y], preview=str(folder/f'{layer}.png'))
        self.stage['clark_comparison'] = results
        self.stage['visual_review'] = 'pending: compare source revisions as well as rendering'
        self.save()

    def archive(self):
        remote = 'content/drive/MyDrive/FreeHuntingMap-lidar'
        deadline = time.monotonic()+3600
        try:
            self.command('colab', 'ls', '-s', 'v5gpu', remote, timeout=60)
            for layer in LAYERS:
                remaining = deadline-time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('Archive exceeded 20 minutes')
                # Colab's contents API cannot create folders and rejects large bodies, so
                # archive flat in layers/ as 64 MiB parts (cat parts in order to restore).
                src = self.paths()/'pm'/f'lidar-{layer}.pmtiles'
                name = f'v2-{self.block["id"]}-lidar-{layer}.pmtiles'
                with src.open('rb') as f:
                    for n, chunk in enumerate(iter(lambda: f.read(64 << 20), b'')):
                        part = self.paths()/'pm'/'drive-part'
                        part.write_bytes(chunk)
                        remaining = deadline-time.monotonic()
                        if remaining <= 0:
                            raise TimeoutError('Archive exceeded time limit')
                        self.command('colab', 'upload', '-s', 'v5gpu', part,
                                     f'{remote}/layers/{name}.part-{n:03d}', timeout=remaining)
                        part.unlink()
        except Exception as e:
            self.stage.update(status='skipped', reason=str(e))
            log(f'Archive skipped: {e}')

    def cleanup(self):
        shutil.rmtree(self.paths())

    def run(self, selected=None):
        for block in self.manifest['blocks']:
            if selected and block['id'] not in selected:
                continue
            if block.get('status') in ('done', 'failed'):
                continue
            self.block = block
            interrupted = next_stage(block)
            if interrupted and block['stages'].get(interrupted, {}).get('status') == 'running':
                record = block['stages'][interrupted]
                record['status'] = 'pending'
                record.setdefault('errors', []).append(dict(at=now(), error='Previous run interrupted'))
                self.save()
            while next_stage(block) is not None and block.get('attempts', 0) < 3:
                name = next_stage(block)
                self.stage = block['stages'].setdefault(name, {})
                self.stage.pop('waiting', None)
                self.stage.update(status='running', started=now(), attempts=self.stage.get('attempts', 0)+1)
                block['status'] = 'running'
                started = time.monotonic()
                self.save()
                log(f'{block["id"]} stage {name} started')
                try:
                    getattr(self, name)()
                    if self.stage['status'] != 'skipped':
                        self.stage['status'] = 'done'
                    self.stage['finished'] = now()
                    log(f'{block["id"]} stage {name} done')
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    # Unknown subprocess/network/OS errors are retryable. Only explicit
                    # input/invariant errors spend the deterministic failure budget.
                    deterministic = isinstance(e, (ValueError, AssertionError)) and not isinstance(e, json.JSONDecodeError)
                    if deterministic:
                        block['attempts'] = block.get('attempts', 0)+1
                    self.stage.update(status='pending', error=str(e))
                    self.stage.setdefault('errors', []).append(dict(at=now(), error=str(e)))
                    self.stage['waiting'] = 'retry' if deterministic else 'transient error; checkpoint retained'
                    log(f'{block["id"]} {"failure " + str(block["attempts"]) + "/3" if deterministic else "pause-and-retry"}: {e}')
                finally:
                    self.stage['seconds'] = self.stage.get('seconds', 0)+time.monotonic()-started
                    self.stage['cgroup_peak_observed_bytes'] = self.peak
                    self.save()
                if self.stage['status'] == 'pending':
                    time.sleep(RETRY_SECONDS)
            if next_stage(block) is None:
                block['status'] = 'done'
                block['finished'] = now()
            else:
                block['status'] = 'failed'
                # Keep merged DEMs and resumable derivatives unless reclaiming space is essential.
                failed = self.base/'failed'/block['id']
                failed.mkdir(parents=True, exist_ok=True)
                atomic_json(failed/'block.json', block)
                if shutil.disk_usage(self.work).free < MIN_FREE:
                    shutil.rmtree(self.paths())
                    block['scratch_removed'] = True
                else:
                    block['scratch_removed'] = False
            shutil.rmtree(self.work/'tmp')
            (self.work/'tmp').mkdir()
            self.save()
            status(self.manifest, self.base)
        self.stage = None


def status(manifest, base=BASE):
    blocks = manifest['blocks']
    done = [b for b in blocks if b['status'] == 'done']
    failed = [b for b in blocks if b['status'] == 'failed']
    remaining = [b for b in blocks if b['status'] != 'done']
    area = sum(b['km2'] for b in done)
    seconds = sum(sum(s.get('seconds', 0) for s in b['stages'].values()) for b in done)
    eta = seconds/area*sum(b['km2'] for b in remaining)/3600 if area else None
    print(f'Blocks: {len(done)}/{len(blocks)} done, {len(failed)} failed; '
          f'WI {area:,.1f}/{sum(b["km2"] for b in blocks):,.1f} km²', flush=True)
    print(f'Disk: {shutil.disk_usage(base).free/1024**3:.2f} GiB free; '
          f'{disk_bytes(base/"work")/1024**3:.2f} GiB scratch', flush=True)
    print(f'ETA: {eta:.1f} h ({seconds/area:.2f} s/km² × remaining WI area)' if area else
          'ETA: pending first completed block', flush=True)
    active = next((b for b in remaining if b['status'] == 'running'), None)
    if active:
        stage = next_stage(active)
        record = active['stages'].get(stage, {})
        if stage == 'dem':
            progress = f'{record.get("tiles_done", 0)}/{record.get("tiles_total", "?")} sources'
        elif stage == 'derive':
            chunks = len(list((base/'work'/active['id']/'derived').glob('*/done/b_*')))
            progress = f'{len(record.get("groups_done", []))}/{len(active.get("crs_order", []))} CRS groups; {chunks} chunks'
        elif stage == 'chm':
            progress = f'{len(record.get("projects_done", []))}/{len(record.get("projects", []))} projects'
        elif stage in ('tile', 'upload'):
            progress = f'{len(record.get("layers", {}))}/{len(LAYERS)} layers'
        else:
            progress = record.get('status', 'pending')
        print(f'Current: {active["id"]} {stage}: {progress}; {record.get("current", "")}; '
              f'{record.get("bytes_downloaded", 0)/1e9:.2f} GB downloaded'
              + (f'; waiting: {record["waiting"]}' if record.get('waiting') else ''), flush=True)
    else:
        print('Current: idle', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=BASE)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('plan')
    run = commands.add_parser('run')
    run.add_argument('--blocks', nargs='+', help='Block IDs, separated by spaces or commas')
    commands.add_parser('status')
    args = parser.parse_args()
    if args.command == 'status':
        status(json.loads((args.base/'manifest.json').read_text()), args.base)
        return
    with lock(args.base):
        manifest = plan(args.base)
        if args.command == 'plan':
            status(manifest, args.base)
            for block in manifest['blocks']:
                print(f'{block["id"]} {block["km2"]:.1f} km² {block["bounds"]}')
            return
        if '0::/fhm' not in Path('/proc/self/cgroup').read_text():
            raise RuntimeError('Run through /workspace/fhm-cg.sh; refusing work outside fhm cgroup')
        os.nice(max(0, 10-os.getpriority(os.PRIO_PROCESS, 0)))
        def terminate(signum, frame):
            raise SystemExit(f'Received signal {signum}; checkpoint retained')
        signal.signal(signal.SIGTERM, terminate)
        selected = {v for value in args.blocks or [] for v in value.split(',')}
        unknown = selected-{b['id'] for b in manifest['blocks']}
        if unknown:
            parser.error(f'Unknown blocks: {sorted(unknown)}')
        for key in ('GDAL_CACHEMAX', 'GDAL_NUM_THREADS', 'OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'NUMBA_NUM_THREADS'):
            os.environ[key] = '64' if key == 'GDAL_CACHEMAX' else '1'
        Runner(args.base, manifest).run(selected)


if __name__ == '__main__':
    main()
