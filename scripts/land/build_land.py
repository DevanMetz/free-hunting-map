"""Build state-land.pmtiles from USGS PAD-US 4.1 and Hawaii TMK parcels.

Public land is non-private PAD-US fee polygons for the 50 states and DC, read
from the public-domain national geodatabase. Parcels are the Hawaii Statewide
GIS statewide TMK layer (public domain). Other statewide parcel services are
not copied: see src/map/stateLandCatalog.ts.

  python3 scripts/land/build_land.py --work /tmp/state-land

Requires curl, GDAL, tippecanoe and tile-join. Checkpoints are reused.
"""
import argparse, gzip, json, math, os, subprocess, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

GDB_URL = 'https://www.sciencebase.gov/catalog/file/get/652d4fc5d34e44db0e2ee45e?name=PADUS4_1Geodatabase.zip'
HAWAII = 'https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25/query'
UA = 'free-hunting-map'
STATES = [
    ('AL', 'Alabama'), ('AK', 'Alaska'), ('AZ', 'Arizona'), ('AR', 'Arkansas'), ('CA', 'California'),
    ('CO', 'Colorado'), ('CT', 'Connecticut'), ('DE', 'Delaware'), ('DC', 'District of Columbia'),
    ('FL', 'Florida'), ('GA', 'Georgia'), ('HI', 'Hawaii'), ('ID', 'Idaho'), ('IL', 'Illinois'),
    ('IN', 'Indiana'), ('IA', 'Iowa'), ('KS', 'Kansas'), ('KY', 'Kentucky'), ('LA', 'Louisiana'),
    ('ME', 'Maine'), ('MD', 'Maryland'), ('MA', 'Massachusetts'), ('MI', 'Michigan'), ('MN', 'Minnesota'),
    ('MS', 'Mississippi'), ('MO', 'Missouri'), ('MT', 'Montana'), ('NE', 'Nebraska'), ('NV', 'Nevada'),
    ('NH', 'New Hampshire'), ('NJ', 'New Jersey'), ('NM', 'New Mexico'), ('NY', 'New York'),
    ('NC', 'North Carolina'), ('ND', 'North Dakota'), ('OH', 'Ohio'), ('OK', 'Oklahoma'), ('OR', 'Oregon'),
    ('PA', 'Pennsylvania'), ('RI', 'Rhode Island'), ('SC', 'South Carolina'), ('SD', 'South Dakota'),
    ('TN', 'Tennessee'), ('TX', 'Texas'), ('UT', 'Utah'), ('VT', 'Vermont'), ('VA', 'Virginia'),
    ('WA', 'Washington'), ('WV', 'West Virginia'), ('WI', 'Wisconsin'), ('WY', 'Wyoming'),
]
# Parcel coverage encoded on every feature for that state. hosted = this archive.
# live/partial = an existing map layer, not copied here. no = public land only.
PARCELS = {
    'AR': 'yes', 'CO': 'yes', 'CT': 'yes', 'DE': 'yes', 'FL': 'yes', 'HI': 'yes', 'IN': 'yes',
    'MD': 'yes', 'MA': 'yes', 'MT': 'yes', 'NE': 'yes', 'NJ': 'yes', 'NY': 'yes', 'NC': 'yes',
    'ND': 'yes', 'OH': 'yes', 'TN': 'yes', 'UT': 'yes', 'VT': 'yes', 'WA': 'yes', 'WV': 'yes', 'WI': 'yes',
    'ID': 'partial', 'ME': 'partial', 'MN': 'partial', 'OR': 'partial',
}
REQUIRED = {'NE', 'MN', 'IA', 'MI', 'IL', 'SD', 'HI'}


def fetch(url, timeout=180):
    request = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
                ctype = response.headers.get('content-type', '')
            if 'json' not in ctype and not body.startswith(b'{'):
                raise RuntimeError(f'unexpected content type {ctype}')
            data = json.loads(body)
            if isinstance(data, dict) and data.get('error'):
                raise RuntimeError(json.dumps(data['error'])[:300])
            return data
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError) as error:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)
            print(f'retry {attempt + 1} {error}', flush=True)
    raise RuntimeError('unreachable')


def pages(endpoint, where, fields, order, page_size, out):
    out.mkdir(parents=True, exist_ok=True)
    marker = out / 'done'
    if marker.exists():
        return json.loads(marker.read_text())
    offset, total, nbytes = 0, 0, 0
    while True:
        path = out / f'{offset:07}.json.gz'
        exceeded = False
        if path.exists() and path.stat().st_size > 20:
            try:
                with gzip.open(path, 'rt') as handle:
                    saved = json.load(handle)
                count = len(saved.get('features') or [])
                exceeded = bool((saved.get('properties') or {}).get('exceededTransferLimit'))
            except (OSError, json.JSONDecodeError, EOFError):
                path.unlink(missing_ok=True)
                count = -1
        else:
            count = -1
        if count < 0:
            params = {
                'f': 'geojson', 'where': where, 'outFields': fields, 'returnGeometry': 'true',
                'outSR': '4326', 'orderByFields': order, 'resultOffset': str(offset),
                'resultRecordCount': str(page_size), 'geometryPrecision': '5',
            }
            data = fetch(endpoint + '?' + urllib.parse.urlencode(params))
            features = data.get('features') or []
            count = len(features)
            exceeded = bool((data.get('properties') or {}).get('exceededTransferLimit'))
            raw = json.dumps(data, separators=(',', ':')).encode()
            with gzip.open(path, 'wb') as handle:
                handle.write(raw)
            nbytes += len(raw)
            print(f'  {out.name} offset {offset} features {count} bytes {len(raw)} exceeded {exceeded}', flush=True)
        total += count
        if count == 0 or (count < page_size and not exceeded):
            break
        offset += count
    stats = {'features': total, 'bytes': nbytes}
    marker.write_text(json.dumps(stats))
    return stats


def classify(props):
    name, kind, des = props.get('Mang_Name') or '', props.get('Mang_Type') or '', props.get('Des_Tp') or ''
    if name == 'USFS':
        return 'usfs'
    if name == 'BLM':
        return 'blm'
    if name == 'NPS':
        return 'nps'
    if name == 'FWS':
        return 'fws'
    if name == 'DOD':
        return 'dod'
    if name == 'SLB':
        return 'trust'
    if kind == 'STAT' and (des == 'SP' or name == 'SPR'):
        return 'park'
    if kind == 'STAT' and (name in {'SFW', 'SDNR'} and des != 'SP'):
        return 'wildlife'
    return 'other'


def coords(value):
    if isinstance(value, list):
        if len(value) >= 2 and isinstance(value[0], (int, float)) and not isinstance(value[0], bool):
            return [round(float(value[0]), 6), round(float(value[1]), 6)]
        return [coords(item) for item in value]
    return value


def clip(value, limit):
    text = '' if value is None else str(value).strip()
    return text[:limit]


def acres(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0 or number > 1e8:
        return None
    return round(number, 1)


def emit_hawaii(collection, handle):
    count = 0
    for feature in collection.get('features') or []:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') not in {'Polygon', 'MultiPolygon'} or not geometry.get('coordinates'):
            continue
        props = feature.get('properties') or {}
        row = {
            'k': 'parcel', 'st': 'HI', 'pc': 'yes', 'c': 'parcel', 'src': 'hi-tmk',
            'n': clip(props.get('tmk_txt') or props.get('tmk') or 'Parcel', 40),
        }
        county = clip(props.get('county'), 40)
        if county:
            row['m'] = county
        area = acres(props.get('gisacres'))
        if area is not None:
            row['ac'] = area
        feature = {'type': 'Feature', 'tippecanoe': {'minzoom': 13, 'maxzoom': 15}, 'properties': row, 'geometry': {'type': geometry['type'], 'coordinates': coords(geometry['coordinates'])}}
        handle.write(json.dumps(feature, separators=(',', ':')) + '\n')
        count += 1
    return count


def load_pages(directory, emit, handle):
    total = 0
    for path in sorted(directory.glob('*.json.gz')):
        with gzip.open(path, 'rt') as raw:
            total += emit(json.load(raw), handle)
    return total


def gdb_layer(archive: Path) -> str:
    text = subprocess.check_output(['ogrinfo', '-so', '-q', f'/vsizip/{archive}/PADUS4_1Geodatabase.gdb'], text=True)
    names = [line.split(':', 1)[1].split('(', 1)[0].strip() for line in text.splitlines() if ':' in line and '(' in line]
    fee = [name for name in names if name.lower().endswith('fee')]
    if not fee:
        raise SystemExit(f'No fee layer in {archive}: {names}')
    return fee[0]


def export_padus(work: Path) -> None:
    archive = work / 'PADUS4_1Geodatabase.zip'
    if not archive.exists() or archive.stat().st_size < 1_000_000_000 or archive.open('rb').read(2) != b'PK':
        subprocess.run(['curl', '-L', '--fail', '--retry', '4', '--retry-delay', '5', '-A', UA, '-o', str(archive), GDB_URL], check=True)
    if (work / 'padus.done').exists():
        return
    layer = gdb_layer(archive)
    states = ','.join(f"'{abbr}'" for abbr, _name in STATES)
    seq = work / 'padus.jsonl'
    sql = f'SELECT * FROM "{layer}" WHERE Own_Type <> \'PVT\' AND State_Nm IN ({states})'
    print(f'export {layer}', flush=True)
    env = {**os.environ, 'OGR_ORGANIZE_POLYGONS': 'SKIP'}
    subprocess.run([
        'ogr2ogr', '-f', 'GeoJSONSeq', str(seq), f'/vsizip/{archive}/PADUS4_1Geodatabase.gdb', '-t_srs', 'EPSG:4326',
        '-dialect', 'SQLITE', '-sql', sql, '-simplify', '20', '-lco', 'COORDINATE_PRECISION=5', '-skipfailures',
    ], check=True, env=env)
    (work / 'padus.done').write_text(layer + '\n')


def emit_padus_feature(feature, handle) -> str | None:
    geometry = feature.get('geometry') or {}
    if geometry.get('type') not in {'Polygon', 'MultiPolygon'} or not geometry.get('coordinates'):
        return None
    props = feature.get('properties') or {}
    state = clip(props.get('State_Nm'), 2)
    if state not in {abbr for abbr, _name in STATES} or props.get('Own_Type') == 'PVT':
        return None
    row = {
        'k': 'public', 'st': state, 'pc': PARCELS.get(state, 'no'), 'c': classify(props),
        'n': clip(props.get('Unit_Nm') or 'Public land', 80), 'src': 'padus',
    }
    manager = clip(props.get('Loc_Mang') or props.get('Mang_Name'), 80)
    if manager:
        row['m'] = manager
    access = clip(props.get('Pub_Access'), 2)
    if access:
        row['a'] = access
    area = acres(props.get('GIS_Acres'))
    if area is not None:
        row['ac'] = area
    handle.write(json.dumps({
        'type': 'Feature', 'tippecanoe': {'minzoom': 5, 'maxzoom': 12}, 'properties': row,
        'geometry': {'type': geometry['type'], 'coordinates': coords(geometry['coordinates'])},
    }, separators=(',', ':')) + '\n')
    return state


def run(work: Path):
    export_padus(work)
    hawaii = pages(HAWAII, '1=1', 'tmk_txt,tmk,county,gisacres', 'objectid', 1000, work / 'raw' / 'hawaii')
    if hawaii['features'] < 100000:
        raise SystemExit(f'Hawaii parcel download looks short: {hawaii}')
    norm = work / 'land.jsonl'
    if not (work / 'norm.done').exists():
        written = {}
        with norm.open('w') as handle:
            with (work / 'padus.jsonl').open() as raw:
                for line in raw:
                    if not line.strip():
                        continue
                    state = emit_padus_feature(json.loads(line), handle)
                    if state:
                        written[state] = written.get(state, 0) + 1
            for abbr in REQUIRED:
                if written.get(abbr, 0) <= 0:
                    raise SystemExit(f'{abbr} has no public land after normalization')
            written['HI-parcels'] = load_pages(work / 'raw' / 'hawaii', lambda collection, stream: emit_hawaii(collection, stream), handle)
            print(f"normalized {written}", flush=True)
        (work / 'norm-counts.json').write_text(json.dumps(written))
        (work / 'norm.done').write_text('ok')
    else:
        written = json.loads((work / 'norm-counts.json').read_text())
    low, high, archive = work / 'low.pmtiles', work / 'high.pmtiles', work / 'state-land.pmtiles'
    env = {**os.environ, 'TIPPECANOE_MAX_THREADS': '2'}
    attribution = 'USGS PAD-US 4.1 (public domain); Hawaii Statewide GIS Program TMK parcels (public domain)'
    if not low.exists():
        tile(env, ['-Z5', '-z11', '--drop-densest-as-needed', '--extend-zooms-if-still-dropping', '-o', str(low)], norm, attribution)
    if not high.exists():
        tile(env, ['-Z12', '-z15', '--maximum-tile-bytes=750000', '--drop-densest-as-needed', '--extend-zooms-if-still-dropping', '-o', str(high)], norm, attribution)
    if not archive.exists():
        import subprocess
        subprocess.run(['tile-join', '--no-tile-size-limit', '--force', '--no-tile-stats', '-o', str(archive), str(low), str(high)], check=True)
    (work / 'stats.json').write_text(json.dumps({'hawaii': hawaii, 'written': written, 'archive': archive.stat().st_size}, indent=2))
    print('archive', archive, archive.stat().st_size, flush=True)


def tile(env, args, source, attribution):
    command = ['tippecanoe', '-l', 'land', '--force', '--read-parallel', '--no-tile-stats',
               '--name=State land', f'--attribution={attribution}', *args, str(source)]
    subprocess.run(command, check=True, env=env)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, default=Path('/tmp/state-land'))
    run(parser.parse_args().work)
