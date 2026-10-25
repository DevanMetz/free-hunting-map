"""Publish a terrain PMTiles archive to R2 as immutable parts + manifest.

  python scripts/terrain/upload.py lidar-lrm v1 /path/lidar-lrm.pmtiles

Refuses to write into a prefix that already has a manifest (published prefixes
are immutable: the Worker and the app cache tiles by URL for a year). Uses the
repository's existing Wrangler login; no credential files or tokens.
"""
import datetime as dt, hashlib, json, math, os, re, struct, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PART_SIZE = 256 * 1024 * 1024
NAMES = {'lidar-lrm', 'lidar-openness', 'lidar-hillshade', 'lidar-slope', 'lidar-chm'}
# Vector (MVT) archives; any topo-<era> name is a WebP raster.
VECTOR = {'tiger-trails', 'usfs-closed-roads', 'osm-tracks', 'wi-forest-roads'}


def wrangler(*args, check=True):
    for attempt in range(4):
        result = _wrangler(*args)
        if result.returncode == 0 or any(s in result.stdout.lower() for s in ('does not exist', 'not found', '10007', '404')):
            break
        time.sleep(2 ** attempt)
    if check and result.returncode:
        raise RuntimeError(result.stdout)
    return result


def _wrangler(*args):
    return subprocess.run(['npx', '--no-install', 'wrangler', *map(str, args)], cwd=ROOT, check=False, text=True, timeout=600,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def valid_version(version):
    return bool(re.fullmatch(r'v[1-9]\d{0,3}(?:/b9-(?:\d{1,3})-(?:\d{1,3}))?', version)) and (
        '/' not in version or (version.startswith('v2/') and all(0 <= int(v) < 512 for v in version.split('-')[1:])))


def main(name, version, archive):
    assert (name in NAMES or name in VECTOR or re.fullmatch(r'topo-[a-z0-9]+', name)) and valid_version(version), 'bad name/version'
    archive = Path(archive)
    head = archive.open('rb').read(127)
    assert head[:7] == b'PMTiles' and head[7] == 3 and head[99] == (1 if name in VECTOR else 4), 'expected PMTiles v3 archive of the right tile type'
    bounds = [v / 1e7 for v in struct.unpack_from('<4i', head, 102)]
    if os.environ.get('UPLOAD_BOUNDS') and '/' in version:
        bounds = [float(v) for v in os.environ['UPLOAD_BOUNDS'].split(',')]
        assert len(bounds) == 4 and bounds[0] < bounds[2] and bounds[1] < bounds[3]
    prefix = f'fhm-tiles/{name}/{version}/'
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        existing = wrangler('r2', 'object', 'get', prefix + 'manifest.json', '--file', tmp / 'old.json', '--remote', check=False)
        if existing.returncode == 0 and os.environ.get('UPLOAD_RESUME') == '1' and version.startswith('v2/b9-'):
            old = json.loads((tmp / 'old.json').read_text())
            with archive.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            assert old['sha256'] == digest and old['size'] == archive.stat().st_size, 'published block differs'
            assert old['bounds'] == [round(b, 5) for b in bounds], 'published bounds differ'
            print('verified existing', prefix, flush=True)
            return
        if existing.returncode == 0:
            sys.exit(f'{prefix}manifest.json already exists; publish a new version instead')
        if not any(s in existing.stdout.lower() for s in ['does not exist', 'not found', '10007', '404']):
            sys.exit('Cannot read R2: ' + existing.stdout)
        size = archive.stat().st_size
        sha = hashlib.sha256()
        with archive.open('rb') as f:
            for chunk in iter(lambda: f.read(1 << 24), b''):
                sha.update(chunk)
        manifest = {'size': size, 'partSize': PART_SIZE, 'parts': math.ceil(size / PART_SIZE), 'sha256': sha.hexdigest(),
                    'built': dt.datetime.now(dt.timezone.utc).date().isoformat(), 'bounds': [round(b, 5) for b in bounds]}
        part = tmp / 'part'
        with archive.open('rb') as f:
            for i in range(manifest['parts']):
                part.write_bytes(f.read(PART_SIZE))
                wrangler('r2', 'object', 'put', prefix + f'part-{i:03}', '--file', part, '--remote', '--content-type', 'application/octet-stream')
                print(f'part {i + 1}/{manifest["parts"]}', flush=True)
        (tmp / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
        wrangler('r2', 'object', 'put', prefix + 'manifest.json', '--file', tmp / 'manifest.json', '--remote', '--content-type', 'application/json')
        wrangler('r2', 'object', 'get', prefix + 'manifest.json', '--file', tmp / 'check.json', '--remote')
        assert json.loads((tmp / 'check.json').read_text()) == manifest, 'remote manifest differs'
        print('published', prefix, json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main(*sys.argv[1:4])
