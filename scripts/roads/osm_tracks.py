#!/usr/bin/env python3
"""Build OSM highway=track labels and PMTiles from public Geofabrik extracts.

License: ODbL 1.0 https://opendatacommons.org/licenses/odbl/1-0/
Attribution: © OpenStreetMap contributors https://www.openstreetmap.org/copyright
Run: python3 scripts/roads/osm_tracks.py --region both --work /workspace/roads-build/osm
Requires osmium, tippecanoe/tile-join, Python shapely, pyproj, pmtiles, mapbox-vector-tile.
No upload or credentials. Completed region outputs are reused; remove its stats to rebuild.
"""
from __future__ import annotations
import argparse
import collections
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import time

from pyproj import Geod, Transformer
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import transform
from pmtiles.reader import Reader, MmapSource
import mapbox_vector_tile

BASE = 'https://download.geofabrik.de/north-america/'
STATES = ['wisconsin', 'minnesota', 'michigan', 'iowa', 'illinois']
ATTR = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>'
LICENSE = 'https://opendatacommons.org/licenses/odbl/1-0/'
LIMIT = 18 * 10**9
MIN_FREE = 25 * 10**9
GEOD = Geod(ellps='WGS84')
CONUS = box(-124.85, 24.4, -66.85, 49.4)
LOCAL = Transformer.from_crs('EPSG:4326', '+proj=aeqd +lat_0=44.51971 +lon_0=-90.81941 +datum=WGS84 +units=m', always_xy=True).transform


def compact(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def guard(work, reserve=0):
    used = 0
    for path in work.rglob('*'):
        try:
            if path.is_file():
                used += path.stat().st_size
        except FileNotFoundError:
            # Concurrent scratch cleanup can remove a directory entry.
            continue
    if used + reserve > LIMIT or shutil.disk_usage(work).free - reserve < MIN_FREE:
        raise RuntimeError(f'Disk guard: work={used}, requested reserve={reserve}, free={shutil.disk_usage(work).free}')


def run(cmd, work, **kwargs):
    print(' '.join(map(str, cmd)), flush=True)
    with (work / 'commands.log').open('a') as log:
        log.write(' '.join(map(str, cmd)) + '\n'); log.flush()
        p = subprocess.Popen(list(map(str, cmd)), stderr=log, **kwargs)
        try:
            while p.poll() is None:
                guard(work)
                time.sleep(2)
            if p.returncode:
                raise RuntimeError(f'Command failed ({p.returncode}); see commands.log: {cmd[0]}')
        except BaseException:
            p.terminate(); p.wait(); raise


def range_download(url, dest, size, work):
    """Fetch disjoint ranges directly into one file, validating every HTTP range."""
    chunk = 128 * 1024 * 1024
    fd = os.open(dest, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o644)
    os.ftruncate(fd, size)
    def fetch(start):
        end = min(size, start + chunk) - 1
        header = dest.parent / f'range-{start}.headers'
        for attempt in range(4):
            offset = start
            with (work / 'commands.log').open('a') as log:
                proc = subprocess.Popen(['curl','--http1.1','-fsSL','--connect-timeout','30',
                    '--max-time','240','--range',f'{start}-{end}','-D',str(header),url],
                    stdout=subprocess.PIPE, stderr=log)
                try:
                    while block := proc.stdout.read(1024 * 1024):
                        if offset + len(block) > end + 1:
                            raise RuntimeError('Server ignored requested byte range')
                        view = memoryview(block)
                        while view:
                            written = os.pwrite(fd, view, offset)
                            offset += written
                            view = view[written:]
                    code = proc.wait()
                    response = header.read_text()
                    expected = f'content-range: bytes {start}-{end}/{size}'
                    if code == 0 and offset == end + 1 and expected in response.lower():
                        header.unlink()
                        return {'start':start,'end':end,'content_range':expected,'http_status':206}
                except BaseException:
                    proc.terminate(); proc.wait(); raise
            if attempt == 3:
                raise RuntimeError(f'Failed verified byte range {start}-{end}')
            time.sleep(2 ** attempt)
    checks = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            pending = {pool.submit(fetch, start) for start in range(0, size, chunk)}
            while pending:
                done, pending = concurrent.futures.wait(pending, timeout=2, return_when=concurrent.futures.FIRST_COMPLETED)
                guard(work)
                for future in done:
                    checks.append(future.result())
                if done:
                    print(f'Downloaded {len(checks)}/{math.ceil(size/chunk)} verified ranges', flush=True)
    finally:
        os.close(fd)
    return sorted(checks, key=lambda c:c['start'])


def acquire(url, dest, work):
    headers = subprocess.check_output(['curl', '--http1.1', '-fsSIL', '--retry', '4', url], text=True)
    sizes = [int(l.split(':', 1)[1].strip()) for l in headers.splitlines() if l.lower().startswith('content-length:')]
    if not sizes:
        raise RuntimeError('Missing download size; cannot enforce budget')
    size = sizes[-1]
    dest.unlink(missing_ok=True)
    subprocess.run(['df', '-h', '/'], check=True)
    # Filtered PBF is small; retain 1 GB headroom while the original exists.
    guard(work, size + 10**9)
    checks = []
    if size > 10**9:
        locations = [line.split(':',1)[1].strip() for line in headers.splitlines() if line.lower().startswith('location:')]
        checks = range_download(locations[-1] if locations else url, dest, size, work)
    else:
        run(['curl', '--http1.1', '-fSL', '--retry', '5', '--retry-delay', '3', '-o', dest, url], work)
    if dest.stat().st_size != size:
        raise RuntimeError('Download length differs from verified HTTP header')
    info = json.loads(subprocess.check_output(['osmium', 'fileinfo', '-j', dest]))
    return {'url': url, 'checked_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'headers': headers,
            'range_checks': checks, 'bytes': size, 'pbf_header': info['header'], 'license': LICENSE}


def normalize(region, work, stem):
    scratch = work / ('scratch-' + region); scratch.mkdir(exist_ok=True)
    config = scratch / 'export.json'
    config.write_text(compact({'attributes': {'id': True, 'type': True}, 'linear_tags': True, 'area_tags': False}))
    sources = []
    seen = set()
    stats = {'count': 0, 'km': 0.0, 'grades': collections.Counter(), 'near_5km': collections.Counter(),
             'duplicates': 0, 'outside_bbox': 0, 'bbox': [180., 90., -180., -90.], 'sources': sources}
    urls = [BASE + 'us/' + s + '-latest.osm.pbf' for s in STATES] if region == 'midwest' else [BASE + 'us-latest.osm.pbf']
    export = work / (stem + '.geojsonl.gz')
    tileinput = scratch / 'tiles.geojsonl'
    with gzip.open(export.with_suffix('.gz.part'), 'wt', encoding='utf-8') as out, tileinput.open('w') as tiles:
        for index, url in enumerate(urls):
            raw = scratch / 'raw.osm.pbf'
            evidence = work / (stem + '-sources.json')
            previous = json.loads(evidence.read_text()) if evidence.exists() else []
            cached = next((s for s in previous if s['url'] == url and raw.exists() and raw.stat().st_size == s['bytes']), None)
            if cached:
                source = cached
                print('Reusing completed PBF: '+url, flush=True)
            else:
                source = acquire(url, raw, work)
            sources.append(source)
            (work / (stem + '-sources.json')).write_text(json.dumps(sources, indent=2))
            filtered = scratch / 'tracks.osm.pbf'
            run(['osmium', 'tags-filter', raw, 'w/highway=track', '-o', filtered, '-O'], work)
            raw.unlink()
            with (work / 'commands.log').open('a') as log:
                proc = subprocess.Popen(['osmium', 'export', str(filtered), '-c', str(config), '--geometry-types=linestring', '-f', 'geojsonseq', '-E'], stdout=subprocess.PIPE, stderr=log, text=True)
                try:
                    for line in proc.stdout:
                        f = json.loads(line.lstrip('\x1e'))
                        tags = f['properties']
                        if tags.get('highway') != 'track':
                            continue
                        way = int(tags['@id'])
                        if way in seen:
                            stats['duplicates'] += 1; continue
                        seen.add(way)
                        geom = shape(f['geometry'])
                        if region == 'lower48':
                            geom = geom.intersection(CONUS)
                        parts = [geom] if geom.geom_type == 'LineString' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'LineString']
                        if not parts or geom.is_empty:
                            stats['outside_bbox'] += 1; continue
                        grade = tags.get('tracktype', '')
                        props = {'g': int(grade[-1]) if grade in ['grade1','grade2','grade3','grade4','grade5'] else 0, 'id': way}
                        props.update({short: tags[key] for short, key in [('s','surface'), ('a','access'), ('n','name')] if tags.get(key)})
                        for part in parts:
                            if part.is_empty:
                                continue
                            coords = [[round(x, 6), round(y, 6)] for x,y in part.coords]
                            if len(set(map(tuple, coords))) < 2:
                                continue
                            feature = {'type': 'Feature', 'properties': props, 'geometry': {'type':'LineString','coordinates':coords}}
                            out.write(compact(feature) + '\n')
                            feature['tippecanoe'] = {'minzoom':10, 'maxzoom':14}
                            tiles.write(compact(feature) + '\n')
                            stats['count'] += 1
                            stats['grades'][props['g']] += 1
                            stats['km'] += GEOD.geometry_length(LineString(coords)) / 1000
                            b = part.bounds
                            stats['bbox'] = [min(stats['bbox'][0], b[0]), min(stats['bbox'][1], b[1]), max(stats['bbox'][2], b[2]), max(stats['bbox'][3], b[3])]
                            if b[0] < -90.74 and b[2] > -90.90 and b[1] < 44.58 and b[3] > 44.46:
                                if transform(LOCAL, part).distance(Point(0, 0)) <= 5000:
                                    stats['near_5km'][props['g']] += 1
                            if stats['count'] % 10000 == 0:
                                guard(work)
                    if proc.wait():
                        raise RuntimeError('osmium export failed; see commands.log')
                except BaseException:
                    proc.terminate(); proc.wait(); raise
            filtered.unlink()
            print(f'{region}: {stats["count"]} lines after source {index+1}', flush=True)
    export.with_suffix('.gz.part').replace(export)
    return stats, tileinput


def build_tiles(stem, tileinput, work):
    scratch = tileinput.parent
    env = {**os.environ, 'TIPPECANOE_MAX_THREADS': '4', 'TMPDIR': str(scratch)}
    common = ['tippecanoe', '--force', '--layer=osm', '--name=OSM tracks', '--attribution='+ATTR,
              '--buffer=8', '--attribute-type=n:string', '--attribute-type=s:string', '--attribute-type=a:string', '--no-progress-indicator', '--temporary-directory='+str(scratch)]
    for lo, hi, name, options in [(8,11,'low',['--drop-densest-as-needed']), (12,14,'high',['--no-feature-limit','--no-tile-size-limit'])]:
        run(common + ['-Z'+str(lo), '-z'+str(hi), '-o', scratch/(name+'.pmtiles')] + options + [tileinput], work, env=env)
    dest = work / (stem + '.pmtiles')
    run(['tile-join','--force','--no-tile-size-limit','--no-tile-stats','-o',dest,scratch/'low.pmtiles',scratch/'high.pmtiles'], work, env=env)
    with dest.open('r+b') as f:
        assert f.read(8) == b'PMTiles\x03'
        f.seek(100); f.write(bytes([8]))
    with dest.open('rb') as f:
        reader = Reader(MmapSource(f))
        header, metadata = reader.header(), reader.metadata()
        assert header['min_zoom'] == 8 and header['max_zoom'] == 14
        assert [l['id'] for l in metadata['vector_layers']] == ['osm']
        tiles = []
        for z in range(10,15):
            x = int((-90.81941+180)/360 * 2**z)
            y = int((1-math.asinh(math.tan(math.radians(44.51971)))/math.pi)/2 * 2**z)
            payload = reader.get(z,x,y)
            if payload:
                decoded = mapbox_vector_tile.decode(gzip.decompress(payload))
                assert list(decoded) == ['osm'] and decoded['osm']['features']
                tiles.append({'z':z,'x':x,'y':y,'bytes':len(payload),'features':len(decoded['osm']['features'])})
    result = {'archive_bytes': dest.stat().st_size, 'sha256': hashlib.file_digest(dest.open('rb'),'sha256').hexdigest(),
              'wildcat_tiles': tiles, 'metadata': metadata, 'header': {k: getattr(v, 'value', v) for k, v in header.items()}}
    shutil.rmtree(scratch)
    return result


def verify_outputs(work, stem):
    """Check the full export and decode point tiles independently of tiling."""
    validation = work / 'validation.json'
    results = json.loads(validation.read_text()) if validation.exists() else {}
    stats = json.loads((work / (stem + '-stats.json')).read_text())
    count = 0
    grades = collections.Counter()
    ids = set()
    fields = {'g', 's', 'a', 'n', 'id'}
    with gzip.open(work / (stem + '.geojsonl.gz'), 'rt') as source:
        for line in source:
            feature = json.loads(line)
            props, geom = feature['properties'], feature['geometry']
            assert feature['type'] == 'Feature' and geom['type'] == 'LineString'
            assert {'g', 'id'} <= set(props) <= fields
            assert type(props['g']) is int and props['g'] in range(6)
            assert type(props['id']) is int
            assert all(isinstance(props[k], str) for k in ('s', 'a', 'n') if k in props)
            coords = geom['coordinates']
            assert len(set(map(tuple, coords))) >= 2
            for xy in coords:
                assert len(xy) == 2 and -180 <= xy[0] <= 180 and -90 <= xy[1] <= 90
                assert all(value == round(value, 6) for value in xy)
            count += 1
            grades[str(props['g'])] += 1
            ids.add(props['id'])
    assert count == stats['count'] and dict(grades) == stats['grades']
    archive = work / (stem + '.pmtiles')
    with archive.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    assert archive.stat().st_size == stats['archive_bytes'] and digest == stats['sha256']
    checks = []
    with archive.open('rb') as f:
        reader = Reader(MmapSource(f))
        header, meta = reader.header(), reader.metadata()
        assert (header['min_zoom'], header['max_zoom']) == (8, 14)
        assert [layer['id'] for layer in meta['vector_layers']] == ['osm']
        for z in range(8, 15):
            x = int((-90.81941 + 180) / 360 * 2**z)
            y = int((1 - math.asinh(math.tan(math.radians(44.51971))) / math.pi) / 2 * 2**z)
            data = reader.get(z, x, y)
            if z < 10:
                assert data is None
            if data:
                decoded = mapbox_vector_tile.decode(gzip.decompress(data))
                assert list(decoded) == ['osm']
                features = decoded['osm']['features']
                assert features
                for feature in features:
                    props = feature['properties']
                    assert {'g', 'id'} <= set(props) <= fields
                    assert props['g'] in range(6)
                    assert all(isinstance(props[k], str) for k in ('s', 'a', 'n') if k in props)
                checks.append({'z': z, 'x': x, 'y': y, 'features': len(features), 'bytes': len(data)})
    results[stem] = {'passed': True, 'features': count, 'unique_osm_ways': len(ids),
                     'grades': dict(grades), 'sha256': digest, 'wildcat_decoded_tiles': checks,
                     'schema': meta['vector_layers'][0]}
    validation.write_text(json.dumps(results, indent=2) + '\n')
    print(stem, count, 'features;', len(ids), 'unique ways; verified', flush=True)


def report(work):
    lines = ['# OSM highway=track build', '', 'Attribution: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright).',
             '', 'License: [ODbL 1.0]('+LICENSE+'). The exported filtered, normalized derived databases are distributed under ODbL 1.0; preserve attribution and license notices and comply with its share-alike/source-availability requirements when publicly using or redistributing a derivative database. These OSM labels are not public domain.',
             '', 'License evidence: https://download.geofabrik.de/ explicitly links ODbL 1.0; https://www.openstreetmap.org/copyright identifies ODbL and attribution/share-alike requirements. License pages were verified with real requests on 2026-10-24; acquisition checks are recorded per run.',
             '', 'Acquisition uses HTTP/1.1 with retries. Each source URL, complete successful HEAD response (including redirect, content type, byte length, Last-Modified), download length, verified byte-range responses for the national extract and PBF timestamp are recorded in the corresponding `*-sources.json`. GET downloads were checked by osmium fileinfo and tags-filter.',
             '', 'One vector layer `osm`; header zooms 8–14, feature minimum zoom 10 (z8–9 intentionally empty). z8–11 may drop dense lines; independent z12–14 build uses --no-feature-limit --no-tile-size-limit. Tile-join uses no tile-size limit. Geometry is zoom-simplified by tippecanoe. Source geometries in exports are unsimplified except six-decimal rounding and lower-48 bbox clipping.',
             '', 'Properties: `g` integer tracktype grade 1–5, or 0 for missing/unrecognized; `id` integer OSM way ID; optional `s` surface, `a` access, `n` name strings. Exports are newline-delimited GeoJSON (GeoJSONSeq without RS), gzip-compressed, EPSG:4326, six-decimal coordinates. Tracktype is a physical grade, not access permission. No access filtering is applied.',
             '', 'Midwest coverage: Geofabrik Wisconsin, Minnesota, Michigan, Iowa, Illinois extract footprints, including complete cross-border ways; duplicate way IDs retained once. National coverage: US extract clipped to [-124.85,24.4,-66.85,49.4], the lower-48 envelope (not a land/state mask); Alaska/Hawaii/territories outside it excluded. Counts describe output line segments; the national bbox intersection can node/split self-intersecting ways, so the unique OSM way counts are listed under Validation. Only highway=track ways with LineString geometry are exported; other highway classes, point/area/relation geometries and degenerate rounded lines are excluded. osmium export stops on geometry errors.',
             '', 'Lengths: WGS84 ellipsoidal line lengths. Wildcat Ln: (-90.81941,44.51971); counts within 5 km use distance to each line in a local azimuthal equidistant projection; grade 0 includes missing/unrecognized tracktype.', '']
    for path in sorted(work.glob('osm-tracks*-stats.json')):
        s = json.loads(path.read_text()); stem = path.name.removesuffix('-stats.json')
        lines += [f'## {stem}', '', f'Features: {s["count"]:,}; length: {s["km"]:,.3f} km; bbox: {s["bbox"]}.',
                  f'PMTiles: {s["archive_bytes"]:,} bytes; export: {(work/(stem+".geojsonl.gz")).stat().st_size:,} bytes; SHA256: `{s["sha256"]}`.',
                  'Grade distribution: '+', '.join(f'{g}={s["grades"].get(str(g), 0):,}' for g in range(6))+'.', f'Within 5 km of Wildcat Ln: {sum(s["near_5km"].values())} tracks; grade distribution: {s["near_5km"]}.',
                  f'Cross-extract duplicates are removed by OSM way ID; ways outside lower-48 bbox: {s["outside_bbox"]}.',
                  'Wildcat point tiles containing data (actual PMTiles lookup): ' + (', '.join(f'{t["z"]}/{t["x"]}/{t["y"]} ({t["bytes"]} compressed bytes)' for t in s['wildcat_tiles']) or 'none: no track intersects the point tiles at z10–14.'), '', 'OSM data timestamps: '+', '.join(sorted({source['pbf_header'].get('option', {}).get('timestamp', 'not provided') for source in s['sources']}))+'.', '', 'OSM source headers/timestamps:', '']
        for source in s['sources']:
            lines += [f'- {source["url"]}: `{compact(source["pbf_header"])}`']
        lines += ['']
    validation = work / 'validation.json'
    if validation.exists():
        lines += ['## Validation', '', 'Full export schema, geometry, coordinate precision, grade counts and archive SHA256 checks; PMTiles header/layer checks and decoded Wildcat tiles are recorded in `validation.json`.', '']
        for name, result in json.loads(validation.read_text()).items():
            lines += [f'- {name}: passed; {result["features"]:,} line features, {result["unique_osm_ways"]:,} unique OSM ways.']
        lines += ['', 'Decoded feature counts are in `validation.json`. A missing exact-point z14 tile means nearby tracks fall outside that small tile. Archive vector metadata can infer `n` as Mixed for numeric-looking source names; explicit attribute typing keeps tile values as strings.', '']
    (work/'REPORT.md').write_text('\n'.join(lines)+'\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--region', choices=['midwest','lower48','both'], default='both')
    p.add_argument('--work', type=Path, default=Path('/workspace/roads-build/osm'))
    args = p.parse_args(); args.work.mkdir(parents=True, exist_ok=True)
    for region in (['midwest','lower48'] if args.region == 'both' else [args.region]):
        stem = 'osm-tracks-midwest' if region == 'midwest' else 'osm-tracks'
        statfile = args.work / (stem+'-stats.json')
        outputs = [statfile, args.work / (stem+'.pmtiles'), args.work / (stem+'.geojsonl.gz')]
        if not all(path.exists() for path in outputs):
            guard(args.work)
            checkpoint = args.work / (stem+'-normalized.json')
            tileinput = args.work / ('scratch-'+region) / 'tiles.geojsonl'
            if checkpoint.exists() and tileinput.exists():
                stats = json.loads(checkpoint.read_text())
            else:
                checkpoint.unlink(missing_ok=True)
                stats, tileinput = normalize(region, args.work, stem)
                checkpoint.write_text(json.dumps(stats, indent=2))
            stats.update(build_tiles(stem, tileinput, args.work))
            statfile.write_text(json.dumps(stats, indent=2))
        verify_outputs(args.work, stem)
        report(args.work)
    print('Complete: '+str(args.work/'REPORT.md'), flush=True)


if __name__ == '__main__':
    main()
