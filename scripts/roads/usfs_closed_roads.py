#!/usr/bin/env python3
"""Build USFS closed roads and training lines, without uploading.

Run: python3 scripts/roads/usfs_closed_roads.py --work /workspace/roads-build/usfs
Sources: USDA Forest Service EDW RoadCore, MVUM roads/trails and NFS trails;
GTAC NPOReference historical decommissioned roads. Federal public-domain works;
source-specific metadata, license evidence and HTTP checks are saved in work.
Requires GDAL, Shapely, pyproj, pmtiles, tippecanoe and tile-join.
"""
import argparse
from collections import Counter, defaultdict
import datetime as dt
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import urllib.parse
import zipfile

from osgeo import ogr, osr
from pyproj import Geod
from shapely.geometry import shape, mapping, box

ogr.UseExceptions()
BASE = 'https://data.fs.usda.gov/geodata/edw/'
EDW = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/'
DECOM = 'https://apps.fs.usda.gov/fsgisx05/rest/services/wo_nfs_gtac/GTAC_NPOReference/MapServer/20'
BBOX = [-124.85, 24.4, -66.85, 49.4]
SOURCES = {'road': 'Trans_RoadCore_FS', 'mvum_road': 'Trans_MVUM_Road',
           'mvum_trail': 'Trans_MVUM_Trail', 'trail': 'Trans_Trail_NFS_Publish'}
GEOD = Geod(ellps='WGS84')


def compact(x):
    return json.dumps(x, ensure_ascii=False, separators=(',', ':'))


def guard(work, reserve=0):
    used = sum(p.stat().st_size for p in work.rglob('*') if p.is_file())
    if used + reserve > 6_000_000_000 or shutil.disk_usage(work).free - reserve < 25 * 1024**3:
        raise RuntimeError(f'Disk guard: work {used:,} bytes, reserve {reserve:,}')


def fetch(work, url, path, params=None):
    if path.exists() and path.stat().st_size:
        return
    guard(work, 700 * 1024**2 if url.endswith('.zip') else 20 * 1024**2)
    if params:
        url += '?' + urllib.parse.urlencode(params)
    part = Path(str(path) + '.part')
    headers = Path(str(path) + '.headers')
    subprocess.run(['curl', '--http1.1', '-fLsS', '--retry', '4', '--retry-all-errors',
                    '--connect-timeout', '30', '--max-time', '600', '-D', str(headers),
                    '-o', str(part), url], check=True)
    part.replace(path)
    with (work / 'requests.jsonl').open('a') as f:
        f.write(compact({'utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'url': url,
                         'bytes': path.stat().st_size, 'headers': headers.name}) + '\n')


def get_json(work, url, name, **params):
    p = work / name
    fetch(work, url, p, {'f': 'json', **params})
    j = json.loads(p.read_text())
    if 'error' in j:
        (work / name).unlink()
        raise RuntimeError(f'{url}: {j["error"]}')
    return j


def clean(x):
    return ' '.join(str(x or '').split())


def status(p):
    ml = clean(p.get('oper_maint_level')).upper()
    rs = clean(p.get('route_status')).upper()
    if ml.startswith('D') or 'DECOMM' in rs or rs.split(' - ')[0] in {'DE', 'DC', 'D'}:
        return 'decom'
    if 'UNAUTH' in rs or 'UNAUTH' in clean(p.get('system')).upper():
        return 'unauth'
    if ml.startswith('1') or clean(p.get('openforuseto')).upper() in {'ADMIN', 'CLOSED', 'NONE'} or 'CLOSED' in rs:
        return 'closed'
    return 'open'


def rounded_geometry(g):
    def coords(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], 6), round(c[1], 6)]
        return [coords(x) for x in c]
    j = mapping(g)
    return {'type': j['type'], 'coordinates': coords(j['coordinates'])}


def process(work):
    fetch(work, BASE + 'datasets.php', work / 'datasets.html')
    fetch(work, 'https://www.copyright.gov/title17/92chap1.html', work / 'copyright-law.html')
    fetch(work, BASE + 'edw_resources/meta/BdyAdm_LSRS_AdministrativeForest.xml', work / 'forest-metadata.xml')
    get_json(work, EDW.rstrip('/'), 'edw-services.json')
    get_json(work, EDW + 'EDW_ActivityFactsCommonAttributes_01/MapServer/0', 'facts-layer.json')
    get_json(work, DECOM + '/query', 'gtac-unauth-count.json', where="ROUTE_STATUS LIKE '%UNAUTH%' OR SYSTEM LIKE '%UNAUTH%'", returnCountOnly='true')
    names = get_json(work, EDW + 'EDW_ForestSystemBoundaries_01/MapServer/0/query',
                     'forest-names.json', where='1=1', outFields='forestorgcode,forestname', returnGeometry='false')
    forests = {x['attributes']['forestorgcode']: x['attributes']['forestname'] for x in names['features']}
    # Historic forest codes can differ from today's combined administrative units.
    forests.update({'0902': 'Chequamegon-Nicolet National Forest', '0906': 'Chequamegon-Nicolet National Forest'})
    envelope = box(*BBOX)
    stats = {'coverage_bbox': BBOX, 'sources': {}, 'classes': {}, 'forests': {},
             'attribute_values': {}, 'near_medford_park_falls': [], 'skipped': Counter()}
    counts, kms, fc = Counter(), Counter(), Counter()
    nearest = [float('inf'), None]
    db = sqlite3.connect(work / 'current.sqlite')
    db.execute('DROP TABLE IF EXISTS current_routes')
    db.execute('CREATE TABLE current_routes (cn TEXT, bmp REAL, emp REAL)')
    all_path = work / 'usfs-all-roads-trails.geojsonl.gz'
    closed_path = work / 'usfs-closed-roads.geojsonl.gz'
    tile_path = work / 'tile-input.geojsonl'
    with gzip.open(all_path, 'wt', compresslevel=6) as all_out, gzip.open(closed_path, 'wt', compresslevel=6) as closed_out, tile_path.open('w') as tile_out:
        def emit(g, p, src, cls=None):
            if g.is_empty or not g.intersects(envelope):
                stats['skipped']['outside_lower48'] += 1
                return
            if not envelope.covers(g):
                g = g.intersection(envelope)
            if g.geom_type not in {'LineString', 'MultiLineString'} or g.is_empty:
                stats['skipped']['non_line_or_empty'] += 1
                return
            cls = cls or (status(p) if src == 'road' else src)
            org = clean(p.get('admin_org') or p.get('adminorg') or p.get('managing_org') or p.get('unit_id'))
            forest = clean(p.get('forestname') or p.get('forest_name')) or forests.get(org[:4], '')
            props = {'s': cls, 'n': clean(p.get('name') or p.get('name_1') or p.get('trail_name') or p.get('id') or p.get('rte_no') or p.get('trail_no'))[:120],
                     'ml': clean(p.get('oper_maint_level')).split(' - ')[0], 'f': forest}
            # REV_DATE is a geometry revision, never a decommission completion date.
            date = p.get('rev_date') if src == 'gtac_decom' else None
            if date:
                try:
                    props['d'] = dt.datetime.fromtimestamp(date / 1000, dt.timezone.utc).date().isoformat() if isinstance(date, (int, float)) else str(date)[:10]
                except (ValueError, OSError):
                    pass
            props = {k: v for k, v in props.items() if v != ''}
            geometry = rounded_geometry(g)
            train_props = {**props, 'src': src, 'rid': clean(p.get('rte_cn') or p.get('trail_cn') or p.get('id')),
                           'org': org}
            for k in ('id', 'route_status', 'system', 'jurisdiction', 'objective_maint_level', 'openforuseto', 'bmp', 'emp', 'county', 'tcaroadclass'):
                if p.get(k) is not None:
                    train_props[k] = p[k]
            feature = {'type': 'Feature', 'properties': train_props, 'geometry': geometry}
            all_out.write(compact(feature) + '\n')
            km = abs(GEOD.geometry_length(shape(geometry))) / 1000
            counts[src + ':' + cls] += 1
            kms[src + ':' + cls] += km
            if cls in {'closed', 'decom', 'unauth'}:
                closed_out.write(compact(feature) + '\n')
                tile_out.write(compact({'type': 'Feature', 'properties': props, 'geometry': geometry,
                                       'tippecanoe': {'minzoom': 9, 'maxzoom': 14}}) + '\n')
                fc[forest or ('Unknown ' + org[:4])] += 1
                point = g.interpolate(0.5, normalized=True)
                dist = (point.x + 90.5)**2 + (point.y - 45.2)**2
                if forest.startswith('Chequamegon') and dist < nearest[0]:
                    nearest[:] = [dist, {'lon': point.x, 'lat': point.y, 'properties': props}]
            if src == 'road' and -91.2 < g.centroid.x < -89.5 and 45.0 < g.centroid.y < 46.2 and len(stats['near_medford_park_falls']) < 20 and cls == 'closed':
                stats['near_medford_park_falls'].append({k: p.get(k) for k in ['id','name','admin_org','oper_maint_level','objective_maint_level','route_status','system','openforuseto']})
        for src, stem in SOURCES.items():
            print('Processing', src, flush=True)
            meta = work / (stem + '.xml')
            fetch(work, BASE + 'edw_resources/meta/' + stem + '.xml', meta)
            archive = work / (stem + '.gdb.zip')
            extracted = work / ('extract-' + src)
            if not extracted.exists():
                # Accept the already verified download from initial research.
                if src == 'road' and (work / 'road-extracted').exists():
                    (work / 'road-extracted').rename(extracted)
                    (work / 'roads.gdb.zip').unlink(missing_ok=True)
                else:
                    fetch(work, BASE + 'edw_resources/fc/' + stem + '.gdb.zip', archive)
                    guard(work, 1200 * 1024**2)
                    with zipfile.ZipFile(archive) as z:
                        z.extractall(extracted)
                    archive.unlink()
            gdb = next(extracted.rglob('*.gdb'))
            ds = ogr.Open(str(gdb))
            layer = ds.GetLayer(0)
            source_srs = layer.GetSpatialRef()
            target = osr.SpatialReference(); target.ImportFromEPSG(4326)
            source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
            transform = osr.CoordinateTransformation(source_srs, target)
            n = 0
            vals = defaultdict(Counter)
            for feat in layer:
                p = {k.lower(): v for k, v in feat.items().items()}
                if src == 'road':
                    for k in ('oper_maint_level','objective_maint_level','route_status','system','openforuseto'):
                        vals[k][str(p.get(k))] += 1
                    db.execute('INSERT INTO current_routes VALUES (?,?,?)', (clean(p.get('rte_cn')), p.get('bmp'), p.get('emp')))
                geom = feat.GetGeometryRef()
                if geom is None:
                    stats['skipped']['null_geometry'] += 1
                    continue
                geom = geom.GetLinearGeometry(); geom.Transform(transform); geom.FlattenTo2D(); geom.SetMeasured(False)
                if geom.IsEmpty():
                    stats['skipped']['empty_geometry'] += 1
                    continue
                emit(shape(json.loads(geom.ExportToJson())), p, src)
                n += 1
                if n % 20000 == 0:
                    print(src, n, flush=True); guard(work)
            stats['sources'][src] = {'read': n, 'url': BASE + 'edw_resources/fc/' + stem + '.gdb.zip', 'metadata': BASE + 'edw_resources/meta/' + stem + '.xml'}
            if vals:
                stats['attribute_values'] = {k: dict(v) for k, v in vals.items()}
            ds = None
            shutil.rmtree(extracted)
            db.commit()
        db.execute('CREATE INDEX current_cn ON current_routes(cn)'); db.commit()
        # Explicitly filter the class: MapServer renderers do not filter queries.
        get_json(work, DECOM, 'decom-layer.json')
        ids = get_json(work, DECOM + '/query', 'decom-ids.json', where="TCARoadClass = 'Decommissioned'", returnIdsOnly='true')
        object_ids = sorted(ids.get('objectIds') or [])
        stats['gtac_candidate_count'] = len(object_ids)
        stats['gtac_attribute_values'] = defaultdict(Counter)
        for i in range(0, len(object_ids), 250):
            filename = f'decom-page-{i:06}.json'
            page = get_json(work, DECOM + '/query', filename, objectIds=','.join(map(str, object_ids[i:i+250])),
                            outFields='*', outSR=4326, returnGeometry='true')
            if len(page.get('features', [])) != len(object_ids[i:i+250]):
                raise RuntimeError('Incomplete decommissioned query batch')
            for feat in page['features']:
                p = {k.lower(): v for k, v in feat['attributes'].items()}
                for k in ('route_status','oper_maint_level','objective_maint_level','tcaroadclass'):
                    stats['gtac_attribute_values'][k][str(p.get(k))] += 1
                # Do not call an objective-only D record a completed decommission.
                if status(p) != 'decom':
                    stats['skipped']['gtac_objective_only_not_current_decom'] += 1
                    continue
                cn = clean(p.get('rte_cn') or p.get('rte_cn_1'))
                current = db.execute('SELECT bmp,emp FROM current_routes WHERE cn=?', (cn,)).fetchall()
                b, e = p.get('bmp'), p.get('emp')
                if current and (b is None or e is None or any(a is None or z is None or min(e,z) > max(b,a) for a,z in current)):
                    stats['skipped']['gtac_superseded_by_current_route'] += 1
                    continue
                paths = feat.get('geometry', {}).get('paths', [])
                if paths:
                    emit(shape({'type':'MultiLineString','coordinates':paths}), p, 'gtac_decom', 'decom')
            (work / filename).unlink()
            print('GTAC', i + len(page['features']), '/', len(object_ids), flush=True)
    db.close(); (work / 'current.sqlite').unlink()
    if all_path.stat().st_size >= 1_000_000_000:
        raise RuntimeError('Training export exceeds 1 GB')
    stats['classes'] = {k: {'count': v, 'km': round(kms[k], 3)} for k,v in counts.items()}
    stats['forests'] = dict(fc)
    stats['nearby_test'] = nearest[1]
    stats['skipped'] = dict(stats['skipped'])
    stats['gtac_attribute_values'] = {k: dict(v) for k,v in stats['gtac_attribute_values'].items()}
    (work / 'stats.json').write_text(json.dumps(stats, indent=2))


def tiles(work):
    temp = work / 'tile-tmp'; temp.mkdir(exist_ok=True)
    env = {**os.environ, 'TIPPECANOE_MAX_THREADS': '4'}
    common = ['tippecanoe', '--force', '--layer=usfs', '--name=USFS closed roads',
              '--attribution=USDA Forest Service. Public domain.', '--simplification=2', '--buffer=8',
              '--no-progress-indicator', '--temporary-directory=' + str(temp)]
    for low, high, name, opts in [(8,11,'low',['--drop-densest-as-needed']), (12,14,'high',['--no-feature-limit','--no-tile-size-limit','--drop-rate=1'])]:
        guard(work, 1000 * 1024**2)
        with (work / (name + '-tiles.log')).open('w') as log:
            subprocess.run(common + [f'-Z{low}', f'-z{high}', '-o', str(work / (name + '.pmtiles'))] + opts + [str(work / 'tile-input.geojsonl')], check=True, env=env, stdout=log, stderr=log)
    output = work / 'usfs-closed-roads.pmtiles'
    subprocess.run(['tile-join','--force','--no-tile-size-limit','--no-tile-stats','-o',str(output),str(work/'low.pmtiles'),str(work/'high.pmtiles')],check=True, env=env)
    with output.open('r+b') as f:
        assert f.read(8) == b'PMTiles\x03'
        f.seek(100); f.write(bytes([8]))
    for name in ('low.pmtiles','high.pmtiles','tile-input.geojsonl'):
        (work / name).unlink()
    shutil.rmtree(temp)


def report(work):
    """Validate deliverables and produce the reviewable source/coverage report."""
    import xml.etree.ElementTree as ET
    from pmtiles.reader import Reader, MmapSource
    import mapbox_vector_tile
    stats = json.loads((work / 'stats.json').read_text())
    archive = work / 'usfs-closed-roads.pmtiles'
    with archive.open('rb') as f:
        reader = Reader(MmapSource(f))
        header, metadata = reader.header(), reader.metadata()
        assert header['min_zoom'] == 8 and header['max_zoom'] == 14
        assert [x['id'] for x in metadata['vector_layers']] == ['usfs']
        point = stats['nearby_test']
        point['lon'], point['lat'] = round(point['lon'], 6), round(point['lat'], 6)
        def tile_xy(lon, lat, z):
            return int((lon+180)/360*2**z), int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z)
        def decode(z, x, y):
            data = reader.get(z,x,y)
            if data is None:
                return None
            if data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            return mapbox_vector_tile.decode(data)
        checks = {}
        for z in (9, 12, 14):
            x,y = tile_xy(point['lon'], point['lat'], z)
            tile = decode(z,x,y)
            assert tile and tile['usfs']['features']
            for feat in tile['usfs']['features']:
                assert feat['properties']['s'] in {'closed','decom','unauth'}
                assert set(feat['properties']) <= {'s','n','ml','f','d'}
            checks[f'{z}/{x}/{y}'] = len(tile['usfs']['features'])
        x,y = tile_xy(-90.81941,44.51971,14)
        wildcat = decode(14,x,y)
        wildcat_n = len(wildcat['usfs']['features']) if wildcat else 0
        # Per-feature minzoom 9 leaves z8 empty despite the contractual header minzoom 8.
        x8,y8 = tile_xy(point['lon'],point['lat'],8)
        assert reader.get(8,x8,y8) is None
    states, labels, bbox = Counter(), Counter(), [180,90,-180,-90]
    inventory_forests, inventory_classes = Counter(), Counter()
    with gzip.open(work / 'usfs-all-roads-trails.geojsonl.gz', 'rt') as f:
        for line in f:
            p = json.loads(line)['properties']
            inventory_forests[p.get('f') or ('Unknown ' + p.get('org','')[:4])] += 1
            inventory_classes[p['src'] + ':' + p['s']] += 1
    assert dict(inventory_classes) == {k:v['count'] for k,v in stats['classes'].items()}
    examples = []
    with gzip.open(work / 'usfs-closed-roads.geojsonl.gz','rt') as f:
        for line in f:
            feat = json.loads(line); p = feat['properties']; g = shape(feat['geometry'])
            assert g.geom_type in {'LineString','MultiLineString'} and not g.is_empty
            assert p['s'] in {'closed','decom','unauth'}
            if p['src'] == 'road' and p['s'] == 'closed':
                assert p.get('ml') == '1' or p.get('openforuseto', '').upper() in {'ADMIN','CLOSED','NONE'} or 'CLOSED' in p.get('route_status','').upper()
            if p['src'] == 'gtac_decom':
                assert 'DECOMM' in p.get('route_status','').upper() or p.get('ml') == 'D'
            labels[p['s']] += 1
            county = str(p.get('county',''))
            if len(county) > 2:
                states[county[:2]] += 1
            a,b,c,d = g.bounds
            bbox = [min(bbox[0],a),min(bbox[1],b),max(bbox[2],c),max(bbox[3],d)]
            if p['s'] == 'decom' and len(examples)<5:
                examples.append(p)
    expected = sum(v['count'] for k,v in stats['classes'].items() if k.split(':')[1] in {'closed','decom','unauth'})
    assert sum(labels.values()) == expected
    sizes = {p.name:p.stat().st_size for p in [archive, work/'usfs-closed-roads.geojsonl.gz',work/'usfs-all-roads-trails.geojsonl.gz']}
    validation = {'tile_checks':checks,'wildcat_tile':f'14/{x}/{y}', 'wildcat_features':wildcat_n,
                  'header':{k:str(v) for k,v in header.items()}, 'metadata':metadata, 'sizes':sizes,
                  'actual_bbox':bbox, 'states':dict(states),'inventory_forests':dict(inventory_forests),'labels':dict(labels),'decom_examples':examples,
                  'sha256':{p:hashlib.file_digest((work/p).open('rb'),'sha256').hexdigest() for p in sizes}}
    (work/'validation.json').write_text(json.dumps(validation,indent=2))
    lines = ['# USFS closed and decommissioned roads', '',
             'Built '+dt.datetime.now(dt.timezone.utc).isoformat()+' from public USDA Forest Service sources; no upload, deployment, commit or credential access.', '',
             '## Sources and license evidence', '',
             'All included linework is a federal USDA Forest Service work. Public domain under [17 USC 105](https://www.copyright.gov/title17/92chap1.html#105). EDW metadata identifies U.S. Forest Service as originator, lists access constraints as None, and gives the agency geospatial accuracy/use disclaimer rather than a redistribution restriction. Source XML files and HTTP response headers are retained beside this report. The GTAC layer credits USFS INFRA and EDW (March 07, 2019). Forest names come from the EDW administrative-forest attribute table; no boundary geometry is included.', '',
             'Discovery: https://data.fs.usda.gov/geodata/edw/datasets.php (saved as datasets.html). Requests use curl --http1.1 with retries. New bulk URLs were taken from the catalog, not guessed. requests.jsonl and *.headers record actual successful requests; initial research also saved road-download.headers and service/layer JSON responses.', '']
    for src, value in stats['sources'].items():
        lines += [f'- **{src}**: {value["url"]}; metadata/license: {value["metadata"]}.']
        root = ET.parse(work / (SOURCES[src]+'.xml'))
        publication = next((e.text for e in root.iter('pubdate') if e.text and e.text.isdigit()), 'unspecified')
        lines[-1] += f' Metadata publication date: {publication}.'
        evidence = {k:[e.text for e in root.iter(k)] for k in ('origin','pubdate','accconst','useconst')}
        (work / (src+'-license-evidence.json')).write_text(json.dumps(evidence,indent=2))
    lines += [f'- **Historical decom**: {DECOM}; schema, renderer and actual query values verified. Query explicitly filters `TCARoadClass = \'Decommissioned\'`: the renderer alone does not constrain query results.',
              f'- **Forest names**: {EDW}EDW_ForestSystemBoundaries_01/MapServer/0/query; actual nongeometry attribute request saved in forest-names.json. License/origin evidence: https://data.fs.usda.gov/geodata/edw/edw_resources/meta/BdyAdm_LSRS_AdministrativeForest.xml (saved as forest-metadata.xml; USDA Forest Service originator, access constraints None).' , '',
              '## Coverage and quantities', '',
              f'Lower-48 envelope: {BBOX}. This is a bbox clip, not a state mask. Actual selected-line bbox: {bbox}. State codes observed in source COUNTY: '+', '.join(sorted(states))+'.', '',
              '| Source / class | Features | Geodesic km |', '|---|---:|---:|']
    for key,val in stats['classes'].items():
        lines += [f'| {key} | {val["count"]:,} | {val["km"]:,.3f} |']
    lines += ['', 'The training class open means an existing RoadCore road without an explicit closure/decommission classification; it is not a permission assertion. Training totals retain source records, including overlapping representations (RoadCore/MVUM/NFS trail) and repeated historical event records; they are source labels, not unique network mileage. All EPSG:4326 line exports have coordinates rounded to six decimals. Gzipped files contain one GeoJSON feature per line, without a record-separator prefix.', '',
              '| Deliverable | Bytes |', '|---|---:|']
    for name,size in sizes.items():
        lines += [f'| {name} | {size:,} |']
    lines += ['', '## Tiles and schema', '',
              'Single vector source-layer `usfs`; header minzoom 8, maxzoom 14. Every feature minzoom 9, so z8 intentionally has no tiles. Zooms 8–11 use density dropping; zooms 12–14 are built separately with --no-feature-limit --no-tile-size-limit --drop-rate=1, then tile-join --no-tile-size-limit. No feature dropping at z12+. Geometry is simplified for display; exports retain full source geometry (curves linearized by GDAL).', '',
              '`s`: closed / decom / unauth; `n`: road name, fallback route number; `ml`: operational maintenance code; `f`: forest name; `d`: source geometry REV_DATE, when present, never asserted to be decommission completion date. Empty values are omitted. Training exports additionally retain src, rid, org and relevant original status/system/jurisdiction/objective/open-use/measure/county fields.', '',
              '## Classification and exclusions', '',
              'RoadCore closed = operational level 1 or explicit OPENFORUSETO ADMIN/CLOSED/NONE or explicit closed route status. No closure is inferred from absence on MVUM. Future objective D alone is not a completed decommission. Historical decom requires current-status DE/decommissioned or operational D, and is omitted if its same-route measure interval overlaps the current existing RoadCore snapshot. Entire historical segments with overlaps are omitted conservatively. Historical coverage is a 2019 snapshot, not a complete current decommissioning register. Some historical records have unknown or non-Forest-Service jurisdiction; these remain agency-authored decommissioned-road assertions, not access permissions, and their original jurisdiction is retained for training. The inspected GTAC fields include 0 - NOT MAINTAINED, UND - UNDETERMINED and NOT - NOT NEEDED; these are not evidence of unauthorized status. No unauthorized class is inferred from null/zero maintenance level.', '',
              f'Historical candidates: {stats["gtac_candidate_count"]:,}. Exclusions: `{compact(stats["skipped"])}`.', '',
              'The EDW catalog and EDW REST service directory were inspected for decommissioned/unauthorized/non-system roads, Road Decommissioning activities, watershed restoration and Legacy Roads and Trails. No dedicated national decommissioned/unauthorized line service was listed there; GTAC is the verified separate historical line source. A national GTAC explicit unauthorized-status/system query returned zero features (gtac-unauth-count.json). The FACTS decommission-activity text/count query timed out on three HTTP/1.1 attempts; this is not treated as evidence that no activities exist. FACTS Common Attributes is esriGeometryPolygon, so activity polygons are excluded rather than converted to fictitious road centerlines. Watershed Condition Classification represents watershed polygons and restoration plans, not road centerlines. No project proposals or raster-derived guessed lines are included.', '',
              'This archive contains only closed/decommissioned roads. Open roads, MVUM lines and NFS trails are training-only and do not add a duplicate general trails archive. Closed RoadCore lines intentionally overlap the already shipped Public trails inventory, as required for this status-specific overlay.', '',
              '## Local inspection and tile checks', '',
              'Actual RoadCore attribute examples in the Medford/Park Falls area are in stats.json `near_medford_park_falls`; inventory-wide distributions and historical distributions are also retained there.', '',
              f'Wildcat Ln (-90.819410, 44.519710) is outside the national forest. Tile {validation["wildcat_tile"]} contains {wildcat_n} features.', '',
              f'Nearby Chequamegon test coordinate: lon {point["lon"]:.6f}, lat {point["lat"]:.6f}; road `{point["properties"].get("n", "")}`.', '']
    lines += ['Actual Medford/Park Falls RoadCore samples:', '', '| Route | Name | Operational ML | Objective ML | Route status | Public motor-use field |', '|---|---|---|---|---|---|']
    for sample in stats['near_medford_park_falls'][:5]:
        values = [sample.get(k) for k in ('id','name','oper_maint_level','objective_maint_level','route_status','openforuseto')]
        lines += ['| ' + ' | '.join(str(v or '').replace('|','/') for v in values) + ' |']
    lines += ['']
    for tile,n in checks.items():
        lines += [f'- Decoded `{tile}`: {n} features in `usfs`.']
    lines += ['', '## Selected forests', '', '| Forest | Tiled features | All training lines |','|---|---:|---:|']
    for name,n in sorted(inventory_forests.items()):
        lines += [f'| {name} | {stats["forests"].get(name,0):,} | {n:,} |']
    lines += ['', 'Validation checks PMTiles v3 header, exactly one layer, status/property allowlists, populated test tiles at z9/z12/z14, empty z8, selected export line counts and line geometry. Artifact SHA-256 values, header and metadata are saved in validation.json.', '',
              'Rerun: `python3 /workspace/fhm-roads/scripts/roads/usfs_closed_roads.py --work /workspace/roads-build/usfs`. `--step report` revalidates existing deliverables. Raw geodatabases/ZIPs and tile intermediates are deleted after processing. No R2 commands are part of this script.']
    (work/'REPORT.md').write_text('\n'.join(lines)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=Path('/workspace/roads-build/usfs'))
    parser.add_argument('--step', choices=['all','normalize','tiles','report'], default='all')
    args = parser.parse_args(); args.work.mkdir(parents=True, exist_ok=True)
    if args.step in {'all','normalize'}:
        process(args.work)
    if args.step in {'all','tiles'}:
        tiles(args.work)
    if args.step in {'all','tiles','report'}:
        report(args.work)


if __name__ == '__main__':
    main()
