#!/usr/bin/env python3
"""Build licensed Wisconsin county forest lines; never upload or deploy.

Sources: Bayfield County's GIS Data Access/Access Management publications.
License: county 2025–2027 Land Records Modernization Plan, p31, explicitly
permits unrestricted distribution/sharing (URL in POLICY below). Other county
and DNR candidates are audited, never admitted merely because publicly visible.
Run: python3 scripts/roads/wi_forest_roads.py --work /workspace/roads-build/county
Requires curl, pdftotext, tippecanoe/tile-join, pyproj, pmtiles,
mapbox-vector-tile; --research refreshes county/DNR catalog discovery too.
"""
import argparse
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
import urllib.parse

POLICY = 'https://www.bayfieldcounty.wi.gov/DocumentCenter/View/18968/Land-Records-Modernization-Plan-2025-2027'
PUBLICATION = 'https://www.bayfieldcounty.wi.gov/892/GIS-Data-Access'
ACCESS = 'https://www.bayfieldcounty.wi.gov/236/Access-Management'
ARCGIS = 'https://www.arcgis.com/sharing/rest/'
COUNTIES = 'Clark Bayfield Douglas Sawyer Price Oneida Vilas Forest Florence Marinette Oconto Langlade Lincoln Taylor Jackson Wood Juneau Washburn Burnett Polk Rusk Iron Ashland'.split()
SOURCES = [
    dict(src='bfroad', title='Bayfield County forest road centerlines',
         url='https://maps.bayfieldcounty.wi.gov/arcgis/rest/services/BFLRMapRoads/MapServer/2',
         where="St_Jdx = 'BCF'", fields='OBJECTID,ROAD_NAME,ROAD_TYPE,FR,St_Jdx', oid='OBJECTID'),
    dict(src='bfaccess', title='Bayfield County Forest Access Management',
         item='2b76dc18466d420f94358293b2a8bf11',
         url='https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/BCF_AccessMgmt_WMP_20141124/FeatureServer/0',
         where='1=1', fields='FID,SNOWMOBILE,ATV_TRAIL,ATV_NAME,SNOW_NUM_1,Snow_Name,ATV_NUM,Trl_Dsgntn,Trail_Use', oid='FID'),
]


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def guard(work):
    used = sum(p.stat().st_size for p in work.rglob('*') if p.is_file())
    if used >= 3_000_000_000 or shutil.disk_usage(work).free < 25_000_000_000:
        raise RuntimeError('Disk guard: 3 GB work budget or 25 GB free-space reserve')


def fetch(work, url, params=None):
    guard(work)
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    p = subprocess.run(['curl', '--http1.1', '-L', '--retry', '3', '--retry-delay', '1',
                        '--max-time', '90', '--max-filesize', '50000000', '-sS',
                        '-w', '\n%{http_code}\n%{content_type}', url], capture_output=True)
    body, status, content_type = p.stdout.rsplit(b'\n', 2)
    record = dict(url=url, http=status.decode(), content_type=content_type.decode(),
                  bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
    # One append per request; this function is also used in parallel discovery.
    with (work / 'requests.jsonl').open('a') as f:
        f.write(compact(record) + '\n')
    if p.returncode or status != b'200':
        raise RuntimeError(f'HTTP {status!r}: {url}: {p.stderr.decode()[:200]}')
    return body


def get(work, url, **params):
    value = json.loads(fetch(work, url, params or None))
    if 'error' in value:
        raise RuntimeError(f'ArcGIS error {url}: {value["error"]}')
    return value


def save(work, name, value):
    (work / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def research(work):
    queries = [f'"{c}" (Wisconsin OR WI) (forest OR trails OR roads)' for c in COUNTIES]
    queries += ['owner:Wi_DNR_Data (road OR trail OR forest OR "Managed Forest Law")',
                'owner:Wi_DNR (road OR trail)', 'WISLR owner:WisDOTAdmin',
                '(owner:Wi_DNR OR owner:Wi_DNR_Data) ("Northern Highland" OR "Flambeau" OR "Brule" OR "Black River" OR "Peshtigo" OR "Governor Knowles" OR "Kettle Moraine" OR "Point Beach" OR "Coulee")']
    def search(q):
        pages = []
        start = 1
        while start != -1 and start <= 1000:
            j = get(work, ARCGIS + 'search', f='json', q=q, num=100, start=start)
            pages.extend(j.get('results', []))
            start = j.get('nextStart', -1)
        return dict(query=q, results=pages)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(search, queries))
    save(work, 'research-refresh.json', results)


def check_license(work):
    pdf = work / 'policy.pdf'
    pdf.write_bytes(fetch(work, POLICY))
    try:
        text = subprocess.check_output(['pdftotext', str(pdf), '-'], text=True)
    finally:
        pdf.unlink(missing_ok=True)
    (work / 'bayfield-policy.txt').write_text(text)
    required = 'Bayfield County has no restriction on data distribution/sharing.'
    if required not in ' '.join(text.split()):
        raise RuntimeError('Bayfield permissive policy changed; review before building')
    # Verify these remain official county publications with the expected links.
    page = fetch(work, ACCESS).decode()
    if '0bc7c61de3af4c97b1ba528837579442' not in page:
        raise RuntimeError('Official Access Management webmap changed; review source')
    fetch(work, PUBLICATION)
    webmap = get(work, ARCGIS + 'content/items/0bc7c61de3af4c97b1ba528837579442/data', f='json')
    if SOURCES[1]['url'] not in [x.get('url') for x in webmap['operationalLayers']]:
        raise RuntimeError('Forest access layer no longer published in county map')
    save(work, 'accepted-sources.json', dict(policy=POLICY, evidence=required,
         publications=[PUBLICATION, ACCESS], sources=SOURCES))


def clean(value):
    s = str(value).strip() if value is not None else ''
    return '' if s in ('0', '<Null>', 'None') else s


def normalize(source, feature):
    p = feature['properties']
    if source['src'] == 'bfroad':
        if p.get('St_Jdx') != 'BCF':
            raise RuntimeError('Server did not honor county forest jurisdiction filter')
        props = dict(src='bfroad', n=clean(p.get('ROAD_NAME')) or clean(p.get('FR')),
                     t='forest road', o='Bayfield County',
                     id='bfroad:' + str(p['OBJECTID']), route=clean(p.get('FR')),
                     cls=clean(p.get('ROAD_TYPE')), jur=clean(p.get('St_Jdx')))
    else:
        designation = clean(p.get('Trl_Dsgntn'))
        types = {'HV_&_OHV': 'forest road', 'OHV_Only': 'ATV/UTV trail',
                 'Non-motorized': 'non-motorized trail'}
        if designation not in types:
            raise RuntimeError(f'Unreviewed forest access designation: {designation!r}')
        props = dict(src='bfaccess', n=clean(p.get('ATV_NAME')) or clean(p.get('Snow_Name')),
                     t=types[designation], o='Bayfield County',
                     id='bfaccess:' + str(p['FID']), cls=designation,
                     use=clean(p.get('Trail_Use')), snow=clean(p.get('SNOWMOBILE')),
                     atv=clean(p.get('ATV_TRAIL')), route=clean(p.get('ATV_NUM')) or clean(p.get('SNOW_NUM_1')))
    geom = feature.get('geometry')
    if not geom or geom['type'] not in ('LineString', 'MultiLineString'):
        raise RuntimeError(f'Unexpected source geometry {props["id"]}')
    def line(coords):
        result = []
        for coord in coords:
            xy = [round(float(coord[0]), 6), round(float(coord[1]), 6)]
            if not (-93 < xy[0] < -86 and 42 < xy[1] < 48):
                raise RuntimeError(f'Coordinates outside Wisconsin region: {xy}')
            if not result or xy != result[-1]:
                result.append(xy)
        if len(result) < 2:
            raise RuntimeError('Degenerate line after coordinate rounding')
        return result
    coords = line(geom['coordinates']) if geom['type'] == 'LineString' else [line(c) for c in geom['coordinates']]
    return dict(type='Feature', geometry=dict(type=geom['type'], coordinates=coords),
                properties={k: v for k, v in props.items() if v != ''})


def acquire(work):
    from pyproj import Geod
    geod = Geod(ellps='WGS84')
    stats = dict(sources={}, types={}, features=0, km=0, bbox=[180, 90, -180, -90])
    plain = work / 'wi-forest-roads.geojsonl'
    ids = set()
    with plain.open('w') as out:
        for source in SOURCES:
            meta = get(work, source['url'], f='json')
            save(work, source['src'] + '-layer.json', meta)
            if meta['geometryType'] != 'esriGeometryPolyline':
                raise RuntimeError('Expected line layer')
            # ID paging avoids offset pagination omissions and transfer limits.
            query = source['url'] + '/query'
            count = get(work, query, f='json', where=source['where'], returnCountOnly='true')['count']
            object_ids = sorted(get(work, query, f='json', where=source['where'], returnIdsOnly='true')['objectIds'])
            if len(set(object_ids)) != count:
                raise RuntimeError('Count/ID mismatch; source may have changed during acquisition')
            summary = dict(features=0, km=0, source_count=count)
            for start in range(0, count, 200):
                batch = object_ids[start:start + 200]
                data = get(work, query, f='geojson', objectIds=','.join(map(str, batch)),
                           where=source['where'], outFields=source['fields'], outSR=4326,
                           returnGeometry='true', geometryPrecision=6)
                if data.get('exceededTransferLimit'):
                    raise RuntimeError('Unexpected transfer limit')
                if sorted(f['properties'][source['oid']] for f in data['features']) != batch:
                    raise RuntimeError('Missing/duplicated source IDs')
                for feature in sorted(data['features'], key=lambda f: f['properties'][source['oid']]):
                    f = normalize(source, feature)
                    props, geom = f['properties'], f['geometry']
                    if props['id'] in ids:
                        raise RuntimeError('Duplicate source ID')
                    ids.add(props['id'])
                    lines = [geom['coordinates']] if geom['type'] == 'LineString' else geom['coordinates']
                    km = 0
                    for coords in lines:
                        km += geod.line_length(*zip(*coords)) / 1000
                        for lon, lat in coords:
                            b = stats['bbox']
                            b[:] = [min(b[0], lon), min(b[1], lat), max(b[2], lon), max(b[3], lat)]
                    summary['features'] += 1
                    summary['km'] += km
                    stats['types'][props['t']] = stats['types'].get(props['t'], 0) + 1
                    out.write(compact(f) + '\n')
                # Raw response exists only in memory and is discarded each page.
                guard(work)
            summary['km'] = round(summary['km'], 3)
            stats['sources'][source['src']] = summary
            stats['features'] += summary['features']
            stats['km'] += summary['km']
    if not stats['features']:
        plain.unlink()
        raise RuntimeError('No qualifying features; no archive built')
    with plain.open('rb') as src, (work / 'wi-forest-roads.geojsonl.gz').open('wb') as dst:
        with gzip.GzipFile(fileobj=dst, mode='wb', filename='', mtime=0) as gz:
            shutil.copyfileobj(src, gz)
    save(work, 'stats.json', stats)
    return stats, ids


def run(work, command):
    print('+', ' '.join(map(str, command)), flush=True)
    with subprocess.Popen(list(map(str, command)), env={**os.environ, 'TIPPECANOE_MAX_THREADS': '4'}) as p:
        try:
            while p.poll() is None:
                guard(work)
                time.sleep(0.5)
            if p.returncode:
                raise subprocess.CalledProcessError(p.returncode, command)
        except BaseException:
            p.terminate()
            p.wait()
            raise


def tiles(work, ids):
    from pmtiles.reader import Reader, MmapSource, all_tiles
    import mapbox_vector_tile
    tmp = work / 'tile-tmp'
    tmp.mkdir(exist_ok=True)
    archive = work / 'wi-forest-roads.pmtiles'
    common = ['tippecanoe', '--force', '--layer=wiforest', '--name=Wisconsin county forest roads',
              '--attribution=Bayfield County; county unrestricted GIS sharing policy (2025–2027)',
              '--buffer=8', '--no-progress-indicator', '--temporary-directory=' + str(tmp)]
    for key in ['src', 'n', 't', 'o', 'id']:
        common += ['-y', key]
    try:
        for lo, hi, name, flags in [(8, 11, 'low', ['--drop-densest-as-needed']),
                                   (12, 14, 'high', ['--no-feature-limit', '--no-tile-size-limit',
                                    '--no-line-simplification', '--full-detail=18',
                                    '--low-detail=18', '--minimum-detail=18'])]:
            run(work, common + ['-Z' + str(lo), '-z' + str(hi), '-o', work / (name + '.pmtiles')]
                + flags + [work / 'wi-forest-roads.geojsonl'])
        run(work, ['tile-join', '--force', '--no-tile-size-limit', '--no-tile-stats', '-o', archive,
                   work / 'low.pmtiles', work / 'high.pmtiles'])
        with archive.open('r+b') as f:
            if f.read(8) != b'PMTiles\x03':
                raise RuntimeError('Expected PMTiles v3')
            f.seek(100)
            f.write(bytes([8]))
        with archive.open('rb') as f:
            source = MmapSource(f)
            reader = Reader(source)
            header, metadata = reader.header(), reader.metadata()
            if header['min_zoom'] != 8 or header['max_zoom'] != 14:
                raise RuntimeError('Incorrect archive zoom range')
            if [v['id'] for v in metadata['vector_layers']] != ['wiforest']:
                raise RuntimeError('Incorrect vector layers')
            seen = {z: set() for z in [12, 13, 14]}
            populated = {}
            for (z, x, y), payload in all_tiles(source):
                populated[z] = populated.get(z, 0) + 1
                if z not in seen:
                    continue
                # tippecanoe PMTiles vector tile payloads use gzip.
                if payload[:2] == b'\x1f\x8b':
                    payload = gzip.decompress(payload)
                decoded = mapbox_vector_tile.decode(payload)
                if set(decoded) != {'wiforest'}:
                    raise RuntimeError('Unexpected decoded layer')
                seen[z].update(feature['properties']['id'] for feature in decoded['wiforest']['features'])
            for z, found in seen.items():
                if found != ids:
                    raise RuntimeError(f'z{z} missing {len(ids - found)} source features')
            wildcat = []
            for z in range(8, 15):
                lon, lat = -90.81941, 44.51971
                x = int((lon + 180) / 360 * 2**z)
                y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**z)
                payload = reader.get(z, x, y)
                wildcat.append(dict(z=z, x=x, y=y, present=payload is not None))
        return dict(archive_bytes=archive.stat().st_size,
                    export_bytes=(work / 'wi-forest-roads.geojsonl.gz').stat().st_size,
                    sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                    populated_tiles=populated, high_zoom_verified={z: len(v) for z, v in seen.items()},
                    wildcat=wildcat, metadata=metadata)
    finally:
        for name in ['low.pmtiles', 'high.pmtiles']:
            (work / name).unlink(missing_ok=True)
        shutil.rmtree(tmp, ignore_errors=True)


def report(work, stats, validation):
    rows = '\n'.join(f'| {key} | {s["features"]:,} | {s["km"]:,.3f} |'
                     for key, s in stats['sources'].items())
    checks = '\n'.join(f'- `{t["z"]}/{t["x"]}/{t["y"]}`: ' + ('present' if t['present'] else 'absent')
                       for t in validation['wildcat'])
    text = f'''# Wisconsin county forest roads

Built {dt.datetime.now(dt.timezone.utc).isoformat()}. Coverage: Bayfield County, Wisconsin only.
Not a statewide forest-road inventory. Clark County and WI DNR roads were excluded for unclear redistribution terms.

## Accepted sources and license evidence

Both sources are official Bayfield County GIS publications, governed by the county's
[2025–2027 Land Records Modernization Plan]({POLICY}), printed page 31:
“Bayfield County has no restriction on data distribution/sharing.”
The [GIS Data Access publication]({PUBLICATION}) expressly publishes REST access;
the [Forest Access Management page]({ACCESS}) embeds the verified forest access webmap.
This is the task's official-data-publication/permissive-statement route, not a claim of CC licensing or public domain.
A fresh policy check is mandatory on every run. Full policy text: `bayfield-policy.txt`.

| Source | Output features | Geodesic km |
|---|---:|---:|
{rows}

'''
    for s in SOURCES:
        text += f'- `{s["src"]}`: [{s["title"]}]({s["url"]}); filter `{s["where"]}`.\n'
    text += f'''
The road filter positively identifies Bayfield County Forest jurisdiction (`St_Jdx=BCF`).
It excludes USFS, town, private, state highway and other roads, even where `ROAD_TYPE=CFR`.
The access dataset is the forest-specific 2014 inventory still linked by the county's current page;
its age is a material limitation. Ground signage controls current access. Highway/OHV designations
remain distinct from non-motorized trails. Snowmobile/ATV source flags are preserved in the export.
No seasonal or gated permission is inferred.

## Deliverables and schema

- `wi-forest-roads.pmtiles`: {validation['archive_bytes']:,} bytes; SHA-256 `{validation['sha256']}`.
- `wi-forest-roads.geojsonl.gz`: {validation['export_bytes']:,} bytes, {stats['features']:,} features,
  {stats['km']:,.3f} km (sum of source line lengths, not a dissolved unique network).
- EPSG:4326 bbox: `{compact(stats['bbox'])}`; state: WI.
- Single vector layer `wiforest`, header zooms **8–14**.
- Tile properties: `src` source key, optional `n` name, `t` class, `o` owner/agency,
  `id` stable source key plus source object ID; all strings.
- Export adds optional `route` route number, `cls` original class/designation,
  `jur` original jurisdiction, `use` original permitted-use text, `snow`/`atv` original flags.
  All coordinates rounded to six decimals; line/multiline geometries retained.
- Low zooms 8–11 use density dropping. Zooms 12–14 built separately with
  `--no-feature-limit --no-tile-size-limit`, then joined without a tile-size limit.
  High zooms use 18-bit tile extent and no line simplification so short lines survive quantization.
  Decoded every populated z12, z13 and z14 tile: **every source feature ID is present at each zoom**.
  Verified counts: `{compact(validation['high_zoom_verified'])}`.
- Distinct source inventories can overlap. No fuzzy overlap subtraction or merging was done;
  IDs and labels preserve their different assertions. Do not treat summed km as unique road length.

## Wildcat Ln

Test point `[-90.81941,44.51971]` is in Clark County, outside accepted Bayfield coverage.
No containing tile has data at any requested zoom:

{checks}

## Reproduce and storage

`python3 /workspace/fhm-roads/scripts/roads/wi_forest_roads.py --work {work}`

Add `--research` to refresh county and DNR catalog discovery. Every source request uses
HTTP/1.1 with retries and is recorded with HTTP status, content type and SHA-256 in `requests.jsonl`.
Source metadata are retained; raw geometry pages exist only in memory. Plain line export,
intermediate tile archives and tile scratch are deleted on success. Disk guard: 3 GB work budget,
25 GB minimum free. No credentials, tokens, commits, pushes, R2/wrangler or deployment operations.

## Research and skips

See `RESEARCH.md` for the candidate-by-candidate decision ledger and county coverage audit.
Machine-readable initial discovery and item terms are retained in `*-search.json`,
`*-items.json`, `item-details.json`, and `official-county-audit.json`.
Public accessibility and a public-record label were never treated as a redistribution license.
'''
    (work / 'REPORT.md').write_text(text)


RESEARCH_LEDGER = r"""# Research ledger — 2026-10-24

Research used real HTTP/1.1 requests with retries, ArcGIS item metadata and REST service metadata;
initial discovery snapshots and full item terms are retained alongside this ledger. Web searches were
used to discover official URLs, never to infer a nonexistent REST endpoint. HTTP 000 indicates a
transport/TLS failure, 403 an access barrier, and 301 an unresolved redirect after the request limit;
these are not findings that the underlying data are dead. No login, token, contact message or paid data request was made.

## Decisions

- **ACCEPT Bayfield forest-specific roads and access lines.** Official GIS Data Access publication:
  https://www.bayfieldcounty.wi.gov/892/GIS-Data-Access and forestry publication:
  https://www.bayfieldcounty.wi.gov/236/Access-Management . The current 2025–2027 county policy,
  https://www.bayfieldcounty.wi.gov/DocumentCenter/View/18968/Land-Records-Modernization-Plan-2025-2027 ,
  printed p31, explicitly permits unrestricted distribution/sharing. This is a permissive official
  GIS data-publication policy, not a standardized CC license. County forest jurisdiction `BCF` is
  distinguished from `USFS`, even when ROAD_TYPE is `CFR`. The forest access webmap
  https://www.arcgis.com/sharing/rest/content/items/0bc7c61de3af4c97b1ba528837579442/data?f=json
  links the exact accepted forest-specific line layer. Metadata and real GeoJSON queries validated
  the source fields, classes, counts, geometry and WGS84 output. See `requests.jsonl` for every build request.
- **SKIP other Bayfield candidates:** general silent-sports inventory includes non-county-forest trails;
  state-funded ATV/snowmobile layers overlap the accepted forest inventory; route/closure/survey layers
  are not a separate forest-road inventory. Old `maps.bayfieldcounty.org` TouristFeatures URL has a
  TLS certificate mismatch; the current `.wi.gov` REST root was verified separately.
- **SKIP Clark County forestry maps, trail maps and road archive:** official Forestry & Parks
  https://www.clarkcountywi.gov/forestry-parks , documents
  https://www.clarkcountywi.gov/for-documents and ATV page
  https://www.clarkcountywi.gov/for-trails-atv publish maps, but no clear open redistribution grant was found.
  The mobility-device map distinguishes named forest roads, woods trails, gated trails and ATV/snowmobile
  routes; a cartographic map does not establish a reusable licensed line inventory. Land Information
  https://www.clarkcountywi.gov/pz-land-information offers county GIS data for a fee, without an open license.
  Archived Roads Clark County WI 2023:
  https://geo.btaa.org/catalog/F5C2125F-4AC5-484F-8891-BC8E8FBCAD82 is marked Public, not openly licensed.
  It contains primary forest roads; its description explicitly says additional forest roads are held
  separately by Forestry. Beacon is behind a 403 browser challenge. No Clark geometry was ingested or traced.
  Search hits for Clark County NV/WA were rejected as wrong jurisdictions.
- **SKIP DNR Motorized Access Roads:**
  https://www.arcgis.com/sharing/rest/content/items/852bf68e547c4e91ae473e87af808eb6?f=json and
  https://dnrmaps.wi.gov/arcgis/rest/services/DW_Map_Dynamic/EN_DNR_Motorized_Access_Roads_Ext/MapServer .
  Verified JSON service with layers 1–4: street-legal, ATV/UTV/snowmobile, ATV, and snowmobile road views.
  This is the strongest state-road candidate and represents DNR owned/managed roads, originally
  collected 2016–2017. Item terms warn against navigation and disclaim liability/accuracy; they do not
  provide an explicit open license or redistribution permission. DNR legal notices
  https://dnr.wisconsin.gov/legal also provide disclaimers, not an affirmative redistribution license.
  The official portal https://data-wi-dnr.opendata.arcgis.com advertises free discovery/download,
  which alone does not meet the requested permissive-license threshold.
- **SKIP NHAL state forest ATV/UTV variance layers:** official webmap
  https://www.arcgis.com/sharing/rest/content/items/ba4fe7fe990944fc8ae7e3ad20c0f42e/data?f=json
  supplies https://dnrmaps.wi.gov/arcgis2/rest/services/LF_Master_Planning/LF_NHAL_ATV_UTV_WTM_Ext/MapServer .
  Verified the service and layer references: existing open roads (0), existing local routes (1),
  proposed DNR routes (2), non-DNR trails (4), potential non-DNR trails (5), planned DNR routes (7).
  No explicit reusable line-data license found; proposed/planned layers would also require separation
  from existing physical routes. They were not silently treated as present roads.
- **SKIP other named state forests:** owner-scoped catalog search included Northern Highland-American
  Legion, Flambeau River, Brule River, Black River, Peshtigo, Governor Knowles, Kettle Moraine,
  Point Beach and Coulee. `state-forest-search.json` records the actual search and 12 results.
  It found the NHAL variance and master-planning/story-map material, not a separately licensed
  current road inventory. The statewide DNR motorized-road service above is the common candidate.
  This is a discovery limitation, not a claim these forests have no roads.
- **SKIP Managed Forest Law / Forest Crop Law data:** tax-law points and private forest land polygons
  are ownership/enrollment/access records, not road centerlines. DNR item terms supply disclaimers,
  not an explicit open line-data license. No road lines were inferred from property boundaries.
- **SKIP DNR County and Local Roads basemap:** item
  https://www.arcgis.com/sharing/rest/content/items/23bd11b53f7a4a86b65ec69a0c7a9ebd?f=json
  explicitly identifies OpenStreetMap-derived geometry under ODbL 1.0. It is openly licensed,
  but is a general local-road basemap rather than a county-forest/DNR road inventory, and DNR
  specifically hides nonpublic roads within managed lands. It was not included as forest-road labels.
- **SKIP DNR recreation/state trail network:** verified LF_DNR_REC_OPPS and PR_STATE_TRAILS_NETWORK_PLAN
  services, including state, Ice Age and North Country trails plus planning corridors. Terms are
  general disclaimers or partner attribution, with no explicit open redistribution grant found.
  Planned corridors are also not physical existing roads. `dnr-folder-*.json` and `service-details.json`
  record checked REST folders/services.
- **SKIP Wood County layers despite clear CC BY 3.0 licensing:** Roads and Snowmobile Trails items
  identify https://creativecommons.org/licenses/by/3.0/ . These are general county roads and
  seasonal snowmobile routes, not a positively identified county-forest inventory. The newer
  Street Centerlines/Recreation Features/RecreationDataCompile items have blank licenseInfo.
  No transfer of the older layers' license to newer services was assumed.
- **SKIP Vilas:** official recreation routes/road centerlines have detailed as-is/distribution disclaimers,
  but no explicit open reuse/redistribution grant was found.
- **SKIP Polk:** item terms call data a public record and disclaim liability. Public-record status alone
  does not meet this task's open-license rule. Closed snowmobile routes also cannot be labeled as roads.
- **SKIP Jackson Recreational Trails:** terms allow viewing, downloading and use with county acknowledgment,
  but do not expressly grant redistribution/derivative publication; under the strict requested policy,
  treat this as unclear rather than extending that permission. Older recreational view terms are blank.
- **SKIP other counties' candidates listed below:** missing or unclear licenseInfo, non-forest general
  roads, applications without a downloadable licensed source, or inaccessible catalog/map pages.
  Every requested county was searched in ArcGIS and its linked public GIS application was requested.
  These checks do not establish exhaustive absence of additional licensed data.
- **SKIP Wisconsin County Forests Association:** https://wisconsincountyforests.com/about/ provides
  member forestry links and a county directory. Grouse-habitat material and printed maps do not
  supply a clearly licensed statewide forest-road line inventory. No reuse grant found for those maps.
- **SKIP WISLR:** official Maps and GIS page https://wisconsindot.gov/pages/doing-bus/mapsgis.aspx
  directs WISLR data requests to staff; the interactive system uses authorized access. It does store
  surface type; official ARIP guidance at
  https://wisconsindot.gov/Documents/doing-bus/local-gov/astnce-pgms/highway/arip-guidelines.pdf
  distinguishes 25 unimproved, 30 graded/drained earth and 35 gravel. No public, clearly licensed
  complete forest-road extract with these attributes was established. Official terms
  https://wisconsindot.gov/Documents/doing-bus/gis/WisDOT-GIS-Data-Legal-062021.pdf are warranty,
  liability, endorsement and choice-of-law notices, without a redistribution grant. Terms text saved
  as `wisdot-terms.txt`. Official open-data portal was requested; WISLR/WisDOTAdmin catalog searches
  mainly returned cached basemaps and labels, not a reusable physical-inventory extract.

## County public GIS application checks

The [UW Wisconsin county map directory](https://maps.aqua.wisc.edu/wisconsin-ims.htm)
provided these links; all were actually requested with HTTP/1.1 and retries.
No license was inferred from software licenses such as Geocortex/Esri branding.

| County | Verified application request | HTTP | Result |
|---|---|---:|---|
| Ashland | [GIS application](https://co.ashland.wi.us/interactive_web_maps) | 000 | Transport/TLS failure; license not established |
| Bayfield | [GIS application](https://www.bayfieldcounty.wi.gov/713/Interactive-Web-Maps) | 200 | Public page; source-specific licensing reviewed separately |
| Burnett | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=BurnettCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Clark | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=ClarkCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Douglas | [GIS application](https://beacon.schneidercorp.com/Application.aspx?AppID=1201&LayerID=36183&PageTypeID=1&PageID=13715) | 403 | Browser/access challenge; license not established |
| Florence | [GIS application](https://gis.florencewisconsin.com/integrator/Web/Default.aspx?server=mapguide&SiteId=0083b543-027c-48fc-87d5-413c267b332d) | 000 | Transport/TLS failure; license not established |
| Forest | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=ForestCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Iron | [GIS application](https://maps.ags.ruekert-mielke.com/Html5Viewer/index.html?viewer=ironcounty) | 200 | Public page; source-specific licensing reviewed separately |
| Jackson | [GIS application](https://beacon.schneidercorp.com/Application.aspx?AppID=1194) | 403 | Browser/access challenge; license not established |
| Juneau | [GIS application](https://juneaucounty.maps.arcgis.com/) | 200 | Public page; source-specific licensing reviewed separately |
| Langlade | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=LangladeCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Lincoln | [GIS application](https://maps.co.lincoln.wi.us/webapps/gisportal/) | 200 | Public page; source-specific licensing reviewed separately |
| Marinette | [GIS application](https://mcgis.marinettecounty.com/) | 200 | Public page; source-specific licensing reviewed separately |
| Oconto | [GIS application](https://www.co.oconto.wi.us/338/Interactive-Maps) | 301 | Redirect unresolved; license not established |
| Oneida | [GIS application](https://gis.co.oneida.wi.us/gismapping/) | 000 | Transport/TLS failure; license not established |
| Polk | [GIS application](https://www.polkcountywi.gov/government/divisions_and_departments/environmental_services_division/division_of_gis/index.php) | 200 | Public page; source-specific licensing reviewed separately |
| Price | [GIS application](https://beacon.schneidercorp.com/Application.aspx?AppID=1196&LayerID=36061&PageTypeID=1&PageID=13665) | 403 | Browser/access challenge; license not established |
| Rusk | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=RuskCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Sawyer | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=SawyerCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Taylor | [GIS application](https://beacon.schneidercorp.com/Application.aspx?AppID=1190&LayerID=35900&PageTypeID=1&PageID=13609) | 403 | Browser/access challenge; license not established |
| Vilas | [GIS application](https://geo.vilascountywi.gov/) | 200 | Public page; source-specific licensing reviewed separately |
| Washburn | [GIS application](https://beacon.schneidercorp.com/Application.aspx?App=WashburnCountyWI&PageType=Map) | 403 | Browser/access challenge; license not established |
| Wood | [GIS application](https://gis.woodcountywi.gov/Land-Records-Viewer/index.html) | 200 | Public page; source-specific licensing reviewed separately |

## Candidate service and license checks

Full item terms and JSON responses are retained in `candidate-endpoint-audit.json`.
Item IDs link to the exact license evidence; REST links were actually requested.
“Blank” means no licenseInfo statement in the ArcGIS item. A disclaimer is not an open license.

| Candidate / item terms | REST verification | Decision |
|---|---|---|
| [TouristFeatures - Trails Silent Sports](https://www.arcgis.com/sharing/rest/content/items/f234db70013d4a1d99a08dcae5381052?f=json): Blank | [Request error; see JSON evidence](https://maps.bayfieldcounty.org/arcgis/rest/services/TouristFeatures/MapServer/2?f=json) | County policy permits reuse; only selected forest inventories built |
| [bayfield_gis_SDE_LOAD_TrailSilentSports](https://www.arcgis.com/sharing/rest/content/items/21071e93e7e8434e881d60a8089fb535?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/bayfield_gis_SDE_LOAD_TrailSilentSports/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [Bayfield County, WI - Road Name Application_form](https://www.arcgis.com/sharing/rest/content/items/a3773ce92b344322bde3fc250878f2c0?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/survey123_5daa87b1ea124e7bb8d212f2301bc342_form/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [Wisconsin County Forests](https://www.arcgis.com/sharing/rest/content/items/97dc739df881468aad60b5f67a60caf5?f=json): Neither the Department of Natural Resources nor any of its employees shall be held liable for any improper or incorrect use of the information described and/or … | [JSON metadata verified](https://services5.arcgis.com/Ul9AyFFeFTjf08DW/arcgis/rest/services/County_Forests/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreation Routes and Trails](https://www.arcgis.com/sharing/rest/content/items/86718c2572ca487b9b35369974c1a779?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/RecreationTrails/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreation Routes and Trails](https://www.arcgis.com/sharing/rest/content/items/371ecdc5199f4fa89fab79c3a4a7c5f6?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/RecreationTrails/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [County Forest](https://www.arcgis.com/sharing/rest/content/items/b2bf38dbff0f4645b455ca17ffc23135?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/CountyForest/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Road Centerlines](https://www.arcgis.com/sharing/rest/content/items/96bb3bc24697477db6ea4336101c04fa?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/RoadCenterlines/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreation Sites](https://www.arcgis.com/sharing/rest/content/items/33cd07382da1491e82745d8b93a45d02?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/Recreation_Sites/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [County Forest](https://www.arcgis.com/sharing/rest/content/items/77359094c2a9441595f6d7093177b983?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/CountyForest/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Road Centerlines](https://www.arcgis.com/sharing/rest/content/items/5c7a956c2586420b8621e01597ab2ac2?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/RoadCenterlines/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreation Sites](https://www.arcgis.com/sharing/rest/content/items/79a550fe9c204634817fe57178f90bd0?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/Recreation_Sites/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Forest Parcels](https://www.arcgis.com/sharing/rest/content/items/9ec88a16555e41c088607b651ec724c4?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [Request error; see JSON evidence](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/ForestTaxParcels/FeatureServer
?f=json) | Skipped: no explicit open redistribution grant established |
| [Roads (Basic)](https://www.arcgis.com/sharing/rest/content/items/beb9de4607444b9895d6961a971c4368?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/RoadCenterlines/MapServer/0?f=json) | Skipped: no explicit open redistribution grant established |
| [Transportation Dynamic](https://www.arcgis.com/sharing/rest/content/items/bbd7dbcf67fb4713bf02ec97e2b41f0a?f=json): Blank | [Request error; see JSON evidence](https://maps.vilascountywi.gov/vilasgis/rest/services/DynamicMaps/TransportationDynamic/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreation Bridges](https://www.arcgis.com/sharing/rest/content/items/b0a6ac28199e4098ad9597ad5c383497?f=json): Blank | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/FR/Recreation_Bridge/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Forest Parcels](https://www.arcgis.com/sharing/rest/content/items/aa7105ceabdc4474b22a3c45b3189f7b?f=json): Vilas County’s downloadable digital data, including but not limited to geographic data, tabular data, analytical data, electronic data structures or files, are … | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/ForestTaxParcels/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [County Forest Boundary](https://www.arcgis.com/sharing/rest/content/items/4208b9d9f15244f393db2ed9575ddc9c?f=json): Blank | [JSON metadata verified](https://maps.vilascountywi.gov/vilasgis/rest/services/V4/CountyForest/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [USFS National Forest - Dissolved](https://www.arcgis.com/sharing/rest/content/items/00b10a8b117f442b8b5865cd421f33d0?f=json): This data is for informational purposes only and may not have been prepared for or be suitable for legal, engineering or surveying purposes. The user is solely … | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/DW_Map_Dynamic/EN_Detailed_Basemap_WTM_Ext_Dynamic_L16/MapServer/26?f=json) | Skipped: no explicit open redistribution grant established |
| [Wisconsin IRA Urban Forestry Grants Priority Areas](https://www.arcgis.com/sharing/rest/content/items/279de9c81092466e94e267f668ce147f?f=json): The information shown on these maps have been obtained from various sources, and are of varying age, reliability and resolution. These maps are not intended to … | [JSON metadata verified](https://services5.arcgis.com/Ul9AyFFeFTjf08DW/arcgis/rest/services/Wisconsin_IRA_Urban_Forestry_Grants_Disadvantaged_Communities/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [WI Urban Forestry IRA Grants - Cities, Towns and Villages with Eligible Areas](https://www.arcgis.com/sharing/rest/content/items/41cd9683123d4114b521364cd9296621?f=json): The information shown on these maps have been obtained from various sources, and are of varying age, reliability and resolution. These maps are not intended to … | [JSON metadata verified](https://services5.arcgis.com/Ul9AyFFeFTjf08DW/arcgis/rest/services/Public_WI_IRA_CTV_w_DACs/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [WI Urban Forestry IRA Grants - CEJST Priority Areas](https://www.arcgis.com/sharing/rest/content/items/0a82e4c57c434ee892829201850465c3?f=json): The information shown on these maps have been obtained from various sources, and are of varying age, reliability and resolution. These maps are not intended to … | [JSON metadata verified](https://services5.arcgis.com/Ul9AyFFeFTjf08DW/arcgis/rest/services/Public_WI_IRA_CJEST_DACs/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [WI Urban Forestry IRA Grants - EJScreen Priority Areas](https://www.arcgis.com/sharing/rest/content/items/d7d0734765f546c4aefd60fe934a0fc2?f=json): The information shown on these maps have been obtained from various sources, and are of varying age, reliability and resolution. These maps are not intended to … | [JSON metadata verified](https://services5.arcgis.com/Ul9AyFFeFTjf08DW/arcgis/rest/services/Public_WI_IRA_EJSCREEN_DACs/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [MarinetteRoads](https://www.arcgis.com/sharing/rest/content/items/72bfcc490ab746cc915899b761eed2fb?f=json): Blank | [JSON metadata verified](https://services.arcgis.com/KGqoLspjDtQs0VXD/arcgis/rest/services/MarinetteRoads/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Snowmobile Trails](https://www.arcgis.com/sharing/rest/content/items/b784275730c049d3992d557ccd03d90b?f=json): Creative Commons Attribution 3.0 Unported License | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/Snowmobile_Trails/FeatureServer?f=json) | Openly licensed; no forest identification |
| [Roads](https://www.arcgis.com/sharing/rest/content/items/bbe536fa0a0442549975c5d04005ef2d?f=json): Creative Commons Attribution 3.0 Unported License | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/Roads/FeatureServer?f=json) | Openly licensed; no forest identification |
| [Trails Snowmobile Route](https://www.arcgis.com/sharing/rest/content/items/dfe48950a3284b1fac1b0eca5a7a1517?f=json): Polk County, WI provides access to Geographic Information or GIS DATA that is currently maintained by Polk County, WI. The DATA are for illustration purposes an… | [JSON metadata verified](https://services8.arcgis.com/2RIFco0Rk0YlWKga/arcgis/rest/services/Trails_Snowmobile_Route/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [WI Rustic Road](https://www.arcgis.com/sharing/rest/content/items/653542760a1c449ead1a3be45fff70d3?f=json): Although the data presented has been produced and processed from sources believed to be reliable, no warranty, expressed or implied, is made regarding accuracy,… | [JSON metadata verified](https://services8.arcgis.com/2RIFco0Rk0YlWKga/arcgis/rest/services/WI_Rustic_Road/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [TrailsSnowmobileCLOSED](https://www.arcgis.com/sharing/rest/content/items/fcb74934d4364bcaa2d5d1126b890770?f=json): Polk County, WI provides access to Geographic Information or GIS DATA that is currently maintained by Polk County, WI. The DATA are for illustration purposes an… | [JSON metadata verified](https://services8.arcgis.com/2RIFco0Rk0YlWKga/arcgis/rest/services/TrailsSnowmobileCLOSED/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Trail](https://www.arcgis.com/sharing/rest/content/items/023745174bfd44be9746877895d64c84?f=json): Polk County, WI provides access to Geographic Information or GIS DATA that is currently maintained by Polk County, WI. The DATA are for illustration purposes an… | [JSON metadata verified](https://services8.arcgis.com/2RIFco0Rk0YlWKga/arcgis/rest/services/Trail/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [TrailsSnowmobile](https://www.arcgis.com/sharing/rest/content/items/7fe63c0145524616a47ffb88b390f064?f=json): Polk County, WI provides access to Geographic Information or GIS DATA that is currently maintained by Polk County, WI. The DATA are for illustration purposes an… | [JSON metadata verified](https://services8.arcgis.com/2RIFco0Rk0YlWKga/arcgis/rest/services/TrailsSnowmobile/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [TrailWaypointsSnowmobile](https://www.arcgis.com/sharing/rest/content/items/4564890de64840858d6ee2ae7c8a4ede?f=json): Polk County, WI provides access to Geographic Information or GIS DATA that is currently maintained by Polk County, WI. The DATA are for illustration purposes an… | [JSON metadata verified](https://services8.arcgis.com/2RIFco0Rk0YlWKga/arcgis/rest/services/TrailWaypointsSnowmobile/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Trails](https://www.arcgis.com/sharing/rest/content/items/29934cf44b62421a80ee30da37ecd3fd?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/XNW34unDaz7i1bfP/arcgis/rest/services/Trails/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreational Trails view layer](https://www.arcgis.com/sharing/rest/content/items/89830e6fae7b42a89fb71c90315e6096?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/XNW34unDaz7i1bfP/arcgis/rest/services/Recreational_Trails_view_layer/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Ice Age Trail](https://www.arcgis.com/sharing/rest/content/items/83e6a7ed3913412da8249e3382ec682a?f=json): This layer is hosted by Wisconsin DNR, and reflects Ice Age Trail updates received from the IATA. This layer is updated approximately every two months and is pr… | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/LF_DML/LF_DNR_REC_OPPS_WTM_Ext/MapServer/2?f=json) | Skipped: no explicit open redistribution grant established |
| [State Trail Segments](https://www.arcgis.com/sharing/rest/content/items/e45d0ec12b6348a68f28c52c0459a523?f=json): The Wisconsin Department of Natural Resources seeks to provide access to the best statewide map information available to the DNR for use in public services. Thi… | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/PR_TRAILS/PR_STATE_TRAILS_NETWORK_PLAN_WTM_Ext/MapServer/0?f=json) | Skipped: no explicit open redistribution grant established |
| [Trails Network Plan Corridors](https://www.arcgis.com/sharing/rest/content/items/3667609f60b14ed4ada2588b72e3071f?f=json): This data is for informational purposes only and may not have been prepared for or be suitable for legal, engineering or surveying purposes. The user is solely … | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/PR_TRAILS/PR_STATE_TRAILS_NETWORK_PLAN_WTM_Ext/MapServer/2?f=json) | Skipped: no explicit open redistribution grant established |
| [North Country Scenic Trail in Wisconsin](https://www.arcgis.com/sharing/rest/content/items/d869dae6c30c45dc9268c24d16c9b1b9?f=json): For more information on using Wisconsin DNR data and services, visit https://dnr.wisconsin.gov/legal | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/LF_DML/LF_DNR_REC_OPPS_WTM_Ext/MapServer/3?f=json) | Skipped: no explicit open redistribution grant established |
| [Bayfield County Road Closures](https://www.arcgis.com/sharing/rest/content/items/5dc1e16fbd1a45b19b4cbc6f26ca88fa?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/Bayfield_County_Road_Closures/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [Bayfield_County_Road_Closures_view](https://www.arcgis.com/sharing/rest/content/items/5526e3d6ea6346119175760ef5c0a912?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/Bayfield_County_Road_Closures_view/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [BCF_ATV_Trails_WMP_20141124](https://www.arcgis.com/sharing/rest/content/items/918cd909091d43dd8b2d71610b9c53ed?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/BCF_ATV_Trails_WMP_20141124/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [2018 Flood Road Closures](https://www.arcgis.com/sharing/rest/content/items/bfa11e7850a9452187b85ba98a13e8c6?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/2018_Flood_Road_Closures/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [Flood_road_closures](https://www.arcgis.com/sharing/rest/content/items/e45b586169a3484fb00b823538a0884b?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/Flood_road_closures/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [BayfieldCoBaseMap - All Roads](https://www.arcgis.com/sharing/rest/content/items/139c3d7892d5460fa3634bc577326666?f=json): Blank | [JSON metadata verified](https://maps.bayfieldcounty.wi.gov/arcgis/rest/services/BayfieldCoBaseMap/MapServer/9?f=json) | County policy permits reuse; only selected forest inventories built |
| [Bayfield Co Forest General Survey](https://www.arcgis.com/sharing/rest/content/items/6598967536db4442b2540c3a006829e2?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/service_d90fe18cd4694766b44e332173837297/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [Vilas County Recreation](https://www.arcgis.com/sharing/rest/content/items/04beeb650ffc466c8da350cd4cec16cd?f=json): Blank | [Request error; see JSON evidence](https://maps.vilascountywi.gov/vilasgis/rest/services/DynamicMaps/Recreation/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Vilas County Road Name Request Form_fieldworker](https://www.arcgis.com/sharing/rest/content/items/1b901c17d8a14e488cf4404c9b69702e?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/EpBsZtekrgiFz19U/arcgis/rest/services/survey123_24af89301f554c169afc4c9f8c08c04b_fieldworker/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Public Roads Large Scale Network](https://www.arcgis.com/sharing/rest/content/items/1541dca0a5564e02b840025ff4e9c621?f=json): Blank | [JSON metadata verified](https://services5.arcgis.com/laGV5w41QC6BjSsH/arcgis/rest/services/Public_Roads_LG_Scale/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [WebMerc_BroadBand](https://www.arcgis.com/sharing/rest/content/items/d567716c13c749c893c24a92ae1802df?f=json): Blank | [JSON metadata verified](https://maps.co.lincoln.wi.us/arcgis/rest/services/WebMerc_BroadBand/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Jackson County Recreational Trails](https://www.arcgis.com/sharing/rest/content/items/4184d82f01844375a8ac5ff3071ae289?f=json): This data is provided by Jackson County, Wisconsin for general informational and mapping purposes. While efforts are made to maintain accurate and current infor… | [JSON metadata verified](https://services9.arcgis.com/G9tkBzRKbAqaotWr/arcgis/rest/services/Jackson_County_Recreational_Trails/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Dexter Park Roads](https://www.arcgis.com/sharing/rest/content/items/e4b23aa690e94cb989be8bd94d972dc7?f=json): Blank | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/Dexter_Park_Roads/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [South Park Campground Roads](https://www.arcgis.com/sharing/rest/content/items/4b040f6872264a08b0c554e01ed246b1?f=json): Blank | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/South_Park_Campground_Roads/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [North Park Roads](https://www.arcgis.com/sharing/rest/content/items/21fc2a85484845d1afd3636b14876c8e?f=json): Blank | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/North_Park_Roads/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Juneau Co Road Closure](https://www.arcgis.com/sharing/rest/content/items/e26c0626746b4a2da48f76b326ada17a?f=json): Blank | [Request error; see JSON evidence](https://gismap.co.juneau.wi.us/server/rest/services/JuneauCo_RoadClosure/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Juneau Co Road Closure Viewer](https://www.arcgis.com/sharing/rest/content/items/3bb60e5083d64e778ea92322deb519c0?f=json): Blank | [JSON metadata verified](https://gismap.co.juneau.wi.us/server/rest/services/JuneauCo_RoadClosure_Viewer/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Juneau Co Road Closure](https://www.arcgis.com/sharing/rest/content/items/ed5e6d4dd0d94d9fb7624864adaa0316?f=json): Blank | [Request error; see JSON evidence](https://gismap.co.juneau.wi.us/server/rest/services/JuneauCo_RoadClosure/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Snowmobile Trails](https://www.arcgis.com/sharing/rest/content/items/49c528703b8240518024871437969c06?f=json): Blank | [Request error; see JSON evidence](https://gismap.co.juneau.wi.us/arcgis/rest/services/JuneauCo_PublicGIS/MapServer/48?f=json) | Skipped: no explicit open redistribution grant established |
| [Juneau Co Road Closure Viewer](https://www.arcgis.com/sharing/rest/content/items/ddc0c44087cc4e6a82ecd30d8fc68e48?f=json): Blank | [JSON metadata verified](https://gismap.co.juneau.wi.us/server/rest/services/JuneauCo_RoadClosure_Viewer/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [ATV Trails](https://www.arcgis.com/sharing/rest/content/items/a916d9db7a7f4108943fa95e533f00d3?f=json): Blank | [Request error; see JSON evidence](https://gismap.co.juneau.wi.us/arcgis/rest/services/JuneauCo_PublicGIS/MapServer/44?f=json) | Skipped: no explicit open redistribution grant established |
| [Roads](https://www.arcgis.com/sharing/rest/content/items/3ac239b3cff046f2af7311cfa46cfc3b?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/XNW34unDaz7i1bfP/arcgis/rest/services/Roads/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [AC Snowmobile Trails](https://www.arcgis.com/sharing/rest/content/items/555ef5d8a9b5471988af590d448dffcd?f=json): Ashland County makes no representation or warranties, express or implied, with respect to the use or reuse of the data provided herewith, regardless of its form… | [JSON metadata verified](https://services8.arcgis.com/QlEvoqmtm2DnG9gw/arcgis/rest/services/AshlandCounty_SnowmobileTrails/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Ashland Trails](https://www.arcgis.com/sharing/rest/content/items/ceee820e76be4f979f0909304dbc91fa?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/oUtk5OTcoTEIN17d/arcgis/rest/services/Ashland_Trails/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [AshlandCo_Roads](https://www.arcgis.com/sharing/rest/content/items/0cb4b1f53e6945fa9c89a8df8b89e74e?f=json): Blank | [JSON metadata verified](https://gis.ashlandcountywi.gov/arcgis/rest/services/AshlandCo_Roads/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [AshlandCo_Roads](https://www.arcgis.com/sharing/rest/content/items/10c922bd41064457ad95a60add1180dd?f=json): Blank | [JSON metadata verified](https://gis.ashlandcountywi.gov/arcgis/rest/services/AshlandCo_Roads/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [WI DNR Motorized Access Roads map service](https://www.arcgis.com/sharing/rest/content/items/852bf68e547c4e91ae473e87af808eb6?f=json): This data is not intended for navigation. In the event of any conflicts between this map service and signage on the ground at the property, signage on the groun… | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/DW_Map_Dynamic/EN_DNR_Motorized_Access_Roads_Ext/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [County and Local Roads](https://www.arcgis.com/sharing/rest/content/items/23bd11b53f7a4a86b65ec69a0c7a9ebd?f=json): This data was derived from data downloaded from OpenStreetMap, but contains changes made by Wisconsin DNR. All OpenStreetMap derived data on the download server… | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis/rest/services/DW_Map_Dynamic/EN_Basic_Basemap_WTM_Ext_Dynamic_L16/MapServer/2?f=json) | Skipped: no explicit open redistribution grant established |
| [BCF_AccessMgmt_WMP_20141124](https://www.arcgis.com/sharing/rest/content/items/2b76dc18466d420f94358293b2a8bf11?f=json): Blank | [JSON metadata verified](https://services1.arcgis.com/v89oO2oQLZxxJSry/arcgis/rest/services/BCF_AccessMgmt_WMP_20141124/FeatureServer?f=json) | County policy permits reuse; only selected forest inventories built |
| [RecreationDataCompile](https://www.arcgis.com/sharing/rest/content/items/64dcde9f05094485aa467a07f474ed8e?f=json): Blank | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/RecreationDataCompile/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Recreation Features](https://www.arcgis.com/sharing/rest/content/items/efcf266d4fea439792605f94231f7071?f=json): Blank | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/Recreation_Features/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [Street Centerlines](https://www.arcgis.com/sharing/rest/content/items/386deb2c131944c78b9ba6d7ac89cb34?f=json): Blank | [JSON metadata verified](https://services2.arcgis.com/kTzzDJBaecBOZCjk/arcgis/rest/services/StreetCenterlines/FeatureServer?f=json) | Skipped: no explicit open redistribution grant established |
| [LF_NHAL_ATV_UTV_WTM_Ext](https://dnrmaps.wi.gov/arcgis2/rest/services/LF_Master_Planning/LF_NHAL_ATV_UTV_WTM_Ext/MapServer?f=json): Blank | [JSON metadata verified](https://dnrmaps.wi.gov/arcgis2/rest/services/LF_Master_Planning/LF_NHAL_ATV_UTV_WTM_Ext/MapServer?f=json) | Skipped: no explicit open redistribution grant established |
| [MapServer](https://dotmaps.wi.gov/arcgis/rest/services/agohub/MICHIGAN_BORDER_TIMBER_ROUTES/MapServer/38?f=json): Blank | [JSON metadata verified](https://dotmaps.wi.gov/arcgis/rest/services/agohub/MICHIGAN_BORDER_TIMBER_ROUTES/MapServer/38?f=json) | Skipped: no explicit open redistribution grant established |
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=Path('/workspace/roads-build/county'))
    parser.add_argument('--research', action='store_true')
    args = parser.parse_args()
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    guard(work)
    if args.research:
        research(work)
    check_license(work)
    stats, ids = acquire(work)
    validation = tiles(work, ids)
    save(work, 'validation.json', validation)
    (work / "RESEARCH.md").write_text(RESEARCH_LEDGER)
    report(work, stats, validation)
    (work / 'wi-forest-roads.geojsonl').unlink()
    print(compact(dict(stats=stats, validation={k: v for k, v in validation.items() if k != 'metadata'})))


if __name__ == '__main__':
    main()
