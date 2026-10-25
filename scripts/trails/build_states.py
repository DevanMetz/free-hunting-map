#!/usr/bin/env python3
"""Sequential, checkpointed lower-48 Public trails build (see README.md)."""
from __future__ import annotations

import argparse
import collections
import contextlib
import datetime as dt
import fcntl
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
from types import SimpleNamespace
import zipfile

import build_trails as build

STATES = 'AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split()
CGROUP = Path('/sys/fs/cgroup/fhm')


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.partial')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def tree_bytes(path):
    total = 0
    for p in path.rglob('*'):
        try:
            if p.is_file():
                total += p.stat().st_size
        except FileNotFoundError:
            pass
    return total


class Manifest:
    def __init__(self, path, states, version):
        self.path = path
        self.data = json.loads(path.read_text()) if path.exists() else {
            'schema': 1, 'created': now(), 'version': version, 'selectedStates': states,
            'stages': {}, 'states': {}, 'peakScratchBytes': 0, 'peakBuildRssBytes': 0,
        }
        if self.data['selectedStates'] != states or self.data['version'] != version:
            raise RuntimeError('Manifest state selection/version differs; use a separate --work')
        for stage in ('partition', 'download', 'split', 'join', 'upload', 'cleanup'):
            self.data['stages'].setdefault(stage, {'status': 'pending'})
        for state in states:
            self.data['states'].setdefault(state, {s: {'status': 'pending'} for s in ('normalize', 'tiles', 'cleanup')})
        self.save()

    def entry(self, stage, state=None):
        return self.data['states'][state][stage] if state else self.data['stages'][stage]

    def done(self, stage, state=None):
        return self.entry(stage, state)['status'] == 'done'

    def mark(self, stage, status, state=None, **values):
        entry = self.entry(stage, state)
        entry.update(status=status, updated=now(), **values)
        if status == 'failed':
            entry.setdefault('failures', []).append({'time': now(), 'error': values.get('error')})
        if status == 'pending':
            entry.update(started=now(), error=None, attempts=entry.get('attempts', 0) + 1)
        else:
            entry['finished'] = now()
        self.save()

    def save(self):
        self.data['updated'] = now()
        write_json(self.path, self.data)

    def measure(self, work):
        self.data['peakScratchBytes'] = max(self.data['peakScratchBytes'], tree_bytes(work))
        # Sum this build's process tree only; the training job shares the cgroup.
        processes = {}
        for p in Path('/proc').glob('[0-9]*/stat'):
            try:
                fields = p.read_text().rsplit(')', 1)[1].split()
                processes[int(p.parent.name)] = (int(fields[1]), int(fields[21]) * os.sysconf('SC_PAGE_SIZE'))
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                pass
        owned = {os.getpid()}
        while True:
            children = {pid for pid, (parent, _) in processes.items() if parent in owned}
            if children <= owned:
                break
            owned |= children
        rss = sum(processes.get(pid, (0, 0))[1] for pid in owned)
        self.data['peakBuildRssBytes'] = max(self.data['peakBuildRssBytes'], rss)
        if (CGROUP / 'memory.peak').exists():
            self.data['cgroupPeakBytes'] = int((CGROUP / 'memory.peak').read_text())
        self.save()
        build.disk_guard(work)


def ownership_polygons(states, bounds, buffer=0.05):
    from shapely.geometry import GeometryCollection, box
    covered = GeometryCollection()
    result = {}
    for code in sorted(states):
        expanded = states[code].buffer(buffer).intersection(box(*bounds))
        owned = expanded.difference(covered)
        # Closed polygons share edges. Give even coincident linework to the
        # first state, so a line exactly on a seam is never emitted twice.
        excluded = owned.intersection(covered)
        result[code] = (owned, excluded)
        covered = covered.union(expanded)
    return result


def partition(work):
    from osgeo import ogr
    from shapely.geometry import shape, mapping
    ogr.UseExceptions()
    folder = work / 'lower48'
    output = folder / 'ownership.geojson'
    if output.exists():
        return
    folder.mkdir(parents=True, exist_ok=True)
    last_error = None
    for year in (2024, 2023):
        url = f'https://www2.census.gov/geo/tiger/GENZ{year}/shp/cb_{year}_us_state_500k.zip'
        archive = folder / f'cb_{year}_us_state_500k.zip'
        try:
            if not archive.exists():
                with build.request(url) as response, archive.with_suffix('.partial').open('wb') as f:
                    content_type = response.headers.get('Content-Type', '')
                    if 'zip' not in content_type and 'octet-stream' not in content_type:
                        raise RuntimeError(f'Census returned {content_type}')
                    shutil.copyfileobj(response, f, 1024 * 1024)
                archive.with_suffix('.partial').replace(archive)
            with zipfile.ZipFile(archive) as z:
                shp = next(n for n in z.namelist() if n.endswith('.shp'))
            ds = ogr.Open('/vsizip/' + str(archive) + '/' + shp)
            states = {f.GetField('STUSPS'): shape(json.loads(f.GetGeometryRef().ExportToJson()))
                      for f in ds.GetLayer() if f.GetField('STUSPS') in STATES}
            if set(states) != set(STATES):
                raise RuntimeError('Census must contain exactly 48 contiguous states + DC')
            owners = ownership_polygons(states, build.REGIONS['lower48'])
            write_json(output, {'type': 'FeatureCollection', 'source': url, 'license': 'Public domain',
                'bufferDegrees': 0.05, 'marginDegrees': 0.02,
                'features': [{'type': 'Feature', 'properties': {'state': code, 'excludedBoundary': mapping(excluded)},
                              'geometry': mapping(owned)} for code, (owned, excluded) in owners.items()]})
            build.log(f'Partition: {len(owners)} ownership polygons from {url}')
            return
        except Exception as exc:
            last_error = exc
            build.log(f'Census {year}: {exc}')
    raise RuntimeError('Census boundary acquisition failed') from last_error


def load_owners(work):
    from shapely.geometry import shape
    data = json.loads((work / 'lower48/ownership.geojson').read_text())
    return {f['properties']['state']: (shape(f['geometry']), shape(f['properties']['excludedBoundary'])) for f in data['features']}


def source_paths(raw):
    result = []
    for src, (_, urls) in build.SOURCES.items():
        bulk = raw / (src + '-bulk.jsonl.gz')
        candidates = [bulk] if bulk.with_suffix('.done.json').exists() else [raw / f'{src}-{i}.jsonl.gz' for i in range(len(urls))]
        for path in candidates:
            if not path.exists() or not path.with_suffix('.done.json').exists():
                raise RuntimeError(f'Incomplete national download: {path}')
        result.extend(candidates)
    return result


def split_file(path, destinations, owners, progress=None):
    """One streaming source pass; complete empty files are checkpoints too."""
    from shapely.geometry import shape
    from shapely.strtree import STRtree
    codes = sorted(destinations)
    buffers = [owners[code][0].buffer(0.02) for code in codes]
    tree = STRtree(buffers)
    metadata = json.loads(path.with_suffix('.done.json').read_text())
    counts = collections.Counter()
    outputs = {code: destinations[code] / path.name for code in codes}
    with contextlib.ExitStack() as stack:
        streams = {}
        for code, output in outputs.items():
            output.parent.mkdir(parents=True, exist_ok=True)
            streams[code] = stack.enter_context(gzip.open(output.with_name(output.name + '.partial'), 'wb', compresslevel=3))
        with gzip.open(path, 'rb') as rows:
            for row_number, row in enumerate(rows, 1):
                if progress and row_number % 5000 == 0:
                    progress()
                feature = json.loads(row)
                if not feature.get('geometry'):
                    continue
                geo = shape(feature['geometry'])
                for i in tree.query(geo, predicate='intersects'):
                    code = codes[int(i)]
                    streams[code].write(row)
                    counts[code] += 1
    for code, output in outputs.items():
        output.with_name(output.name + '.partial').replace(output)
        write_json(output.with_suffix('.done.json'), {**metadata, 'features': counts[code], 'nationalFeatures': metadata.get('features'), 'state': code})
    return dict(counts)


def split(work, states, manifest):
    owners = load_owners(work)
    folder = work / 'lower48'
    entries = manifest.data.setdefault('splitSources', {})
    for path in source_paths(folder / 'raw'):
        # Tiled states intentionally no longer have split raw files.
        pending = {code: folder / 'states' / code / 'raw' for code in states
                   if not manifest.done('tiles', code) and not (folder / 'states' / code / 'raw' / path.name).with_suffix('.done.json').exists()}
        if not pending:
            continue
        entries[path.name] = {'status': 'pending', 'started': now()}
        manifest.save()
        build.log(f'Split {path.name} -> {len(pending)} states')
        try:
            counts = split_file(path, pending, owners, lambda: manifest.measure(work))
            entries[path.name].update(status='done', finished=now(), counts=counts, bytes=path.stat().st_size)
            manifest.measure(work)
        except Exception as exc:
            entries[path.name].update(status='failed', error=str(exc), finished=now())
            manifest.save()
            raise


def state_args(work, code):
    return SimpleNamespace(work=work / 'lower48/states', region=code)


def normalize_state(work, code):
    owned, excluded = load_owners(work)[code]
    args = state_args(work, code)
    build.normalize(args, raw_dir=args.work / code / 'raw', ownership=owned, excluded_boundary=excluded)


def tile_state(work, code):
    args = state_args(work, code)
    folder = args.work / code
    stats = json.loads((folder / 'stats.json').read_text())
    if sum(s['features'] for s in stats['sources'].values()):
        build.tile_ranges(args)
    else:
        build.log(f'{code}: empty state (no tile archives required)')


def cleanup_state(work, code):
    folder = work / 'lower48/states' / code
    for name in ('trails.geojsonl', 'trails.partial', 'index.sqlite'):
        (folder / name).unlink(missing_ok=True)
    shutil.rmtree(folder / 'raw', ignore_errors=True)
    shutil.rmtree(folder / 'tile-tmp', ignore_errors=True)


def checked_process(command, work, manifest):
    build.log('+ ' + ' '.join(map(str, command)))
    with subprocess.Popen(list(map(str, command)), start_new_session=True) as process:
        try:
            while process.poll() is None:
                manifest.measure(work)
                time.sleep(2)
            manifest.measure(work)
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, command)
        except BaseException:
            # These children are supervised, not detached builds. Terminate
            # their whole group before retrying so no heavy orphan survives.
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            process.wait()
            raise


def aggregate(work, states):
    stats = {'region': 'lower48', 'bounds': list(build.REGIONS['lower48']), 'sources': {}, 'states': {}, 'excluded': collections.Counter()}
    for code in states:
        state = json.loads((work / 'lower48/states' / code / 'stats.json').read_text())
        stats['states'][code] = {'features': sum(s['features'] for s in state['sources'].values()),
                                 'km': round(sum(s['km'] for s in state['sources'].values()), 2)}
        for src, s in state['sources'].items():
            target = stats['sources'].setdefault(src, {'features': 0, 'km': 0, 'types': collections.Counter()})
            target['features'] += s['features']
            target['km'] += s['km']
            target['types'].update(s['types'])
        stats['excluded'].update(state['excluded'])
    for src in build.SOURCES:
        stats['sources'].setdefault(src, {'features': 0, 'km': 0, 'types': {}})
        stats['sources'][src]['km'] = round(stats['sources'][src]['km'], 2)
    stats['features'] = sum(s['features'] for s in stats['sources'].values())
    stats['km'] = round(sum(s['km'] for s in stats['sources'].values()), 2)
    return stats


def join(work, states, manifest):
    folder = work / 'lower48'
    archives = [folder / 'states' / code / name for code in states for name in ('low.pmtiles', 'high.pmtiles')
                if (folder / 'states' / code / name).exists()]
    if not archives:
        raise RuntimeError('No populated state archives')
    checked_process(['tile-join', '--force', '--no-tile-size-limit', '--no-tile-stats',
                     '--name=Public trails', '--attribution=' + build.ATTRIBUTION,
                     '-o', folder / 'trails.pmtiles', *archives], work, manifest)
    build.check_archive(folder / 'trails.pmtiles')
    stats = aggregate(work, states)
    stats.update(archiveBytes=(folder / 'trails.pmtiles').stat().st_size,
                 sha256=build.file_sha(folder / 'trails.pmtiles'), built=now())
    write_json(folder / 'stats.json', stats)
    build.log('Final stats: ' + build.compact(stats))


def stage(manifest, name, action, state=None):
    if manifest.done(name, state):
        return
    manifest.mark(name, 'pending', state)
    try:
        action()
        artifacts = manifest.path.parent / 'states' / state if state else manifest.path.parent
        manifest.mark(name, 'done', state, bytes=tree_bytes(artifacts))
    except Exception as exc:
        manifest.mark(name, 'failed', state, error=str(exc))
        raise


def wait_download(work, manifest):
    while True:
        result = subprocess.run(['pgrep', '-af', '[p]ython3 .*build_trails.py download'], capture_output=True, text=True)
        running = [line for line in result.stdout.splitlines() if str(work) in line]
        if not running:
            break
        build.log('Waiting for existing national download: ' + running[0])
        manifest.measure(work)
        time.sleep(30)
    try:
        source_paths(work / 'lower48/raw')
        if not (work / 'lower48/sources.json').exists():
            raise RuntimeError('No sources.json')
    except RuntimeError:
        checked_process([sys.executable, Path(build.__file__), 'download', '--region', 'lower48', '--work', work,
                         '--disk-budget-gib', os.environ['TRAILS_DISK_GIB']], work, manifest)
        source_paths(work / 'lower48/raw')


def run(args):
    work = args.work
    folder = work / 'lower48'
    folder.mkdir(parents=True, exist_ok=True)
    # Lock also prevents a pilot/full run from accidentally sharing work files.
    with (folder / 'build.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = Manifest(folder / 'build-manifest.json', args.states, args.version)
        stage(manifest, 'partition', lambda: partition(work))
        stage(manifest, 'download', lambda: wait_download(work, manifest))
        if not manifest.done('join'):
            # Recheck raw checkpoints on resume; done tiled states need no raw.
            if any(not manifest.done('tiles', code) for code in args.states):
                manifest.entry('split')['status'] = 'pending'
                stage(manifest, 'split', lambda: split(work, args.states, manifest))
            failures = []
            for code in args.states:
                for attempt in range(2):
                    try:
                        for name in ('normalize', 'tiles'):
                            if name == 'normalize' and manifest.done('tiles', code):
                                continue
                            stage(manifest, name, lambda n=name: checked_process([
                                sys.executable, Path(__file__).resolve(), n, '--work', work, '--states', code,
                                '--version', args.version], work, manifest), code)
                        stage(manifest, 'cleanup', lambda: cleanup_state(work, code), code)
                        manifest.data['states'][code]['tiles']['bytes'] = sum(p.stat().st_size for p in (folder / 'states' / code).glob('*.pmtiles'))
                        manifest.save()
                        build.log(f'State {code}: done')
                        break
                    except Exception as exc:
                        build.log(f'State {code} attempt {attempt + 1} failed: {exc}')
                        if attempt == 1:
                            failures.append(code)
                manifest.measure(work)
            if failures:
                raise RuntimeError('Refusing join/upload: failed states ' + ', '.join(failures))
            stage(manifest, 'join', lambda: join(work, args.states, manifest))
            manifest.data['stages']['join']['bytes'] = (folder / 'trails.pmtiles').stat().st_size
            manifest.save()
        if not args.no_upload:
            if set(args.states) != set(STATES):
                raise RuntimeError('Only a complete lower-48 build may upload')
            if any(not manifest.done('tiles', code) for code in STATES):
                raise RuntimeError('Refusing upload with incomplete state tiles')
            stage(manifest, 'upload', lambda: checked_process([sys.executable, Path(build.__file__), 'upload',
                '--region', 'lower48', '--work', work, '--version', args.version], work, manifest))
            # Independently recompare persisted manifests before deleting archives.
            if json.loads((folder / 'manifest.json').read_text()) != json.loads((folder / 'verified-manifest.json').read_text()):
                raise RuntimeError('Remote verification missing or differs')
            def cleanup_archives():
                for code in args.states:
                    for path in (folder / 'states' / code).glob('*.pmtiles'):
                        path.unlink()
            stage(manifest, 'cleanup', cleanup_archives)
        manifest.measure(work)
        stats = json.loads((folder / 'stats.json').read_text())
        stats.update({key: manifest.data[key] for key in ('peakScratchBytes', 'peakBuildRssBytes', 'cgroupPeakBytes') if key in manifest.data})
        write_json(folder / 'stats.json', stats)
        build.log('Build complete' + (' (upload disabled)' if args.no_upload else ': R2 manifest verified'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('run', 'partition', 'normalize', 'tiles'))
    parser.add_argument('--work', type=Path, default=Path('/workspace/trails-build/l48'))
    parser.add_argument('--states', nargs='+', choices=STATES, default=sorted(STATES))
    parser.add_argument('--version', default='v2')
    parser.add_argument('--no-upload', action='store_true')
    parser.add_argument('--disk-budget-gib', type=float, default=float(os.environ.get('TRAILS_DISK_GIB', '25')))
    args = parser.parse_args()
    if not re.fullmatch(r'v[2-9][0-9]*|v1[0-9]+', args.version):
        parser.error('Use a NEW v2-or-later prefix; v1 is protected')
    args.work = args.work.resolve()
    args.states = sorted(set(args.states))
    args.work.mkdir(parents=True, exist_ok=True)
    os.environ.update(TRAILS_DISK_GIB=str(args.disk_budget_gib), TIPPECANOE_MAX_THREADS='2', GDAL_CACHEMAX='64', MALLOC_ARENA_MAX='2')
    if args.command == 'run':
        run(args)
    elif args.command == 'partition':
        partition(args.work)
    else:
        if len(args.states) != 1:
            parser.error('Internal state commands require exactly one state')
        (normalize_state if args.command == 'normalize' else tile_state)(args.work, args.states[0])


if __name__ == '__main__':
    main()
