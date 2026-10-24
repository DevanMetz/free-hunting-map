#!/usr/bin/env python3
"""Build the federal public trails layer. See README.md and the shared contract."""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import datetime as dt
import email.utils
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

# Geometry dependencies are loaded lazily: normalization unit tests use stdlib only.
ROOT = Path(__file__).resolve().parents[2]
FS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW'
ZIP_BASE = 'https://data.fs.usda.gov/geodata/edw/edw_resources/shp/'
BLM = 'https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer'
NPS = 'https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/MapServer/0'
NDT = 'https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37'
BLM_ITEM = 'https://www.arcgis.com/sharing/rest/content/items/f94999eb674d4085be0c86729fe4a151'
BLM_BULK = 'https://gis.blm.gov/EGISDownload/LayerPackages/BLM_National_GTLF_Public_Display.zip'
REGIONS = {'wi': (-97.25, 36.95, -82.1, 49.4), 'lower48': (-124.85, 24.4, -66.85, 49.4)}
SOURCES = {
    'usfs_trails': ('S_USA.TrailNFS_Publish.zip', [FS + '/EDW_TrailNFSPublish_01/MapServer/0']),
    'usfs_mvum_trails': ('S_USA.Trail_MVUM.zip', [FS + '/EDW_MVUM_01/MapServer/2']),
    'usfs_mvum_roads': ('S_USA.Road_MVUM.zip', [FS + '/EDW_MVUM_01/MapServer/1']),
    'usfs_roads': ('S_USA.RoadCore_FS.zip', [FS + '/EDW_RoadBasic_01/MapServer/0', FS + '/EDW_RoadBasic_01/MapServer/1']),
    # 7 contains ALL designated trails (including the unassessed view 6).
    'blm_gtlf': (None, [BLM + '/' + str(n) for n in (0, 1, 7)]),
    'nps_trails': (None, [NPS]), 'usgs_ndt': (None, [NDT]),
}
PART_SIZE = 256 * 1024 * 1024
PREFIX = 'fhm-tiles/trails/v1/'
ATTRIBUTION = 'USDA Forest Service; Bureau of Land Management; National Park Service; U.S. Geological Survey. Public domain. Geometry clipped, normalized and deduplicated by Free Hunting Map.'
USE_ORDER = ['Hike', 'Horse', 'Bike', 'ATV', 'Motorcycle', 'OHV', 'Highway vehicles', 'High-clearance vehicles', 'Snowmobile', 'Ski', 'Snowshoe']
MOTOR = {'ATV', 'Motorcycle', 'OHV', 'Highway vehicles', 'High-clearance vehicles'}
SNOW = {'Snowmobile', 'Ski', 'Snowshoe'}
MVUM_FIELDS = {
    'passengervehicle': 'Highway vehicles', 'highclearancevehicle': 'High-clearance vehicles',
    'truck': 'Highway vehicles', 'bus': 'Highway vehicles', 'motorhome': 'Highway vehicles',
    'fourwd_gt50inches': 'OHV', 'twowd_gt50inches': 'OHV',
    'tracked_ohv_gt50inches': 'OHV', 'other_ohv_gt50inches': 'OHV',
    'atv': 'ATV', 'motorcycle': 'Motorcycle', 'otherwheeled_ohv': 'OHV',
    'tracked_ohv_lt50inches': 'OHV', 'other_ohv_lt50inches': 'OHV',
}


def log(message):
    print(message, flush=True)


def compact(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)


def request(url, params=None, method='GET'):
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, method=method, headers={'User-Agent': 'FreeHuntingMap-trails/1.0'}), timeout=60)
            return r
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 429:
                raise
            if attempt == 4:
                raise
            time.sleep(min(2 ** attempt, 15))


def get_json(url, **params):
    with request(url, {'f': 'json', **params}) as r:
        j = json.load(r)
    if 'error' in j:
        raise RuntimeError(f'{url}: {j["error"]}')
    return j


def iso_date(value):
    if not value:
        return ''
    try:
        if isinstance(value, (int, float)):
            return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).date().isoformat()
        return dt.date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError, OverflowError, OSError):
        try:
            return email.utils.parsedate_to_datetime(str(value)).date().isoformat()
        except (ValueError, TypeError):
            return ''


def clean(value, limit=100):
    text = re.sub(r'\s+', ' ', str(value or '')).strip()
    return '' if text.lower() in {'null', 'none', 'unknown', 'unk', '<null>', 'n/a'} else text[:limit]


def props_lower(properties):
    return {k.lower(): v for k, v in properties.items()}


def first(p, *keys):
    return next((clean(p.get(k), 240) for k in keys if clean(p.get(k), 240)), '')


def allowed(value):
    text = clean(value, 240).lower()
    return bool(text) and text not in {'n', 'no', 'false', '0', 'closed', 'prohibited', 'not allowed', 'not managed'}


def use_list(uses):
    return ', '.join(u for u in USE_ORDER if u in uses)


def trail_type(uses, snow=False, road=False):
    if road:
        return 'road'
    if (uses and uses <= SNOW) or (snow and not (uses - SNOW)):
        return 'snow'
    if uses & MOTOR:
        return 'ohv'
    if 'Hike' in uses:
        return 'foot'
    if 'Bike' in uses:
        return 'bike'
    if 'Horse' in uses:
        return 'horse'
    return 'snow' if snow else 'foot'


def federal_agency(text):
    """Positive federal origin allowlist; a federal maintainer alone is insufficient."""
    t = clean(text, 300).lower().replace('&', 'and')
    groups = {
        'USFS': ('forest service', 'usfs', 'u.s.f.s.'),
        'NPS': ('national park service', 'nps'),
        'BLM': ('bureau of land management', 'blm'),
        'FWS': ('fish and wildlife service', 'usfws', 'fws'),
        'USACE': ('army corps of engineers', 'usace'),
        'BOR': ('bureau of reclamation', 'usbr', 'bor'),
        'DOD': ('department of defense', 'dod'),
        'DOE': ('department of energy', 'doe'),
        'USGS': ('geological survey', 'usgs'),
        'TVA': ('tennessee valley authority', 'tenneessee valley authority', 'tva'),
    }
    for agency, tokens in groups.items():
        if any(t == token or (len(token) > 4 and token in t) for token in tokens):
            return agency
    return 'USFS' if t == 'fs' else ''


def normalize_properties(src, properties, date=''):
    p = props_lower(properties)
    status = first(p, 'route_status', 'routestatus', 'trailstatus', 'trlstatus').lower()
    if 'decomm' in status or re.match(r'^(d|dc)\s*-', status) or status in {'planned', 'proposed', 'removed', 'abandoned'}:
        return None
    if src == 'usfs_roads' and ('decomm' in first(p, 'oper_maint_level').lower() or first(p, 'oper_maint_level').upper() == 'D'):
        return None
    if 'water' in first(p, 'trail_type', 'trailtype', 'trltype').lower():
        return None
    agency = 'USFS' if src.startswith('usfs') else {'blm_gtlf': 'BLM', 'nps_trails': 'NPS'}.get(src, '')
    if src == 'usgs_ndt':
        origin = first(p, 'sourceoriginator')
        agency = federal_agency(origin)
        provenance = ' '.join(first(p, key) for key in ['sourceoriginator', 'primarytrailmaintainer', 'sourcedatadecscription'])
        if not agency or agency in {'USFS', 'NPS', 'BLM'} or any(federal_agency(p.get(k, '')) in {'USFS', 'NPS', 'BLM'} for k in ['primarytrailmaintainer', 'sourceoriginator']):
            return None
        if re.search(r'\b(usfs|nps|blm|forest service|national park service|bureau of land management)\b', provenance, re.I):
            return None
    if src == 'nps_trails':
        if any(first(p, k).lower() in {'no', 'n', 'false', '0', 'closed', 'restricted', 'not open to public', 'no public access'} for k in ['isextant', 'opentopublic']):
            return None
        if any('sidewalk' in first(p, key).lower() or 'ferry' in first(p, key).lower() for key in ['trlfeattype', 'trltype']):
            return None
        if first(p, 'dataaccess').lower() in {'restricted', 'internal', 'sensitive'} or re.search(r'\b(no|not|internal)\b', first(p, 'publicdisplay').lower()):
            return None
        if 'non-nps' in first(p, 'trlfeattype').lower():
            return None
        origin = first(p, 'originator')
        if origin and not federal_agency(origin):
            return None
    if src == 'blm_gtlf' and first(p, 'plan_access_rstrct').lower() in {'admin only', 'authorized/permitted user only', 'all'}:
        return None
    uses, seasons = set(), []
    if src.startswith('usfs_mvum'):
        for field, label in MVUM_FIELDS.items():
            # *_DATESOPEN fields omit "inches" in several MVUM names.
            dk = field.replace('inches', '') + '_datesopen'
            dates = first(p, field + '_datesopen', dk)
            if allowed(p.get(field)) or (dates and not clean(p.get(field))):
                uses.add(label)
                if dates:
                    dates = 'all year' if dates in {'01/01-12/31', '01/01 - 12/31'} else dates.replace(' - ', '–')
                    seasons.append(label + ' ' + dates)
        if not seasons and first(p, 'seasonal').lower() == 'seasonal':
            seasons.append('Seasonal')
    elif src == 'usfs_trails':
        # USFS metadata defines these concatenated codes as legally allowed
        # uses; the code order is not a priority ranking.
        snow_trail = first(p, 'trail_type').upper() == 'SNOW'
        code_field = 'allowed_snow_use' if snow_trail else 'allowed_terra_use'
        code_map = {'1':'Snowshoe', '2':'Ski', '3':'Snowmobile'} if snow_trail else {'1':'Hike', '2':'Horse', '3':'Bike', '4':'Motorcycle', '5':'ATV', '6':'OHV'}
        codes = first(p, code_field)
        if codes.isdigit():
            uses |= {label for digit,label in code_map.items() if digit in codes}
        for prefix, label in [('hiker_pedestrian', 'Hike'), ('pack_saddle', 'Horse'), ('bicycle', 'Bike'), ('motorcycle', 'Motorcycle'), ('atv', 'ATV'), ('fourwd', 'OHV'), ('snowmobile', 'Snowmobile'), ('snowshoe', 'Snowshoe'), ('xcountry_ski', 'Ski')]:
            if snow_trail and label not in SNOW:
                continue
            if any(allowed(p.get(prefix + suffix)) for suffix in ['_managed', '_accpt']):
                uses.add(label)
        if not uses and first(p, 'terra_motorized').upper() == 'Y':
            uses.add('OHV')
    elif src == 'usgs_ndt':
        for field, label in [('hikerpedestrian', 'Hike'), ('bicycle', 'Bike'), ('packsaddle', 'Horse'), ('motorcycle', 'Motorcycle'), ('ohvover50inches', 'OHV'), ('ohvisorunder50inches', 'ATV'), ('osvm', 'Snowmobile'), ('crosscountryski', 'Ski'), ('snowshoe', 'Snowshoe')]:
            if allowed(p.get(field)):
                uses.add(label)
        if first(p, 'seasonopen'):
            seasons.append(first(p, 'seasonopen'))
    elif src == 'nps_trails':
        t = first(p, 'trluse').lower()
        for words, label in [(('hike', 'pedestrian', 'hiking'), 'Hike'), (('bicycle', 'bike'), 'Bike'), (('horse', 'equestrian', 'saddle'), 'Horse'), (('motorcycle',), 'Motorcycle'), (('atv', 'all terrain'), 'ATV'), (('ohv', 'utv', 'off-highway', '4wd'), 'OHV'), (('snowmobile',), 'Snowmobile'), (('ski',), 'Ski'), (('snowshoe',), 'Snowshoe')]:
            if any(w in t for w in words):
                uses.add(label)
        if t == 'motorized':
            uses.add('OHV')
        if first(p, 'seasdesc'):
            seasons.append(first(p, 'seasdesc'))
    elif src == 'blm_gtlf':
        t = first(p, 'plan_allow_mode_trnsprt').upper()
        snow = t.startswith('SNOW_')
        if snow:
            uses |= {'Ski', 'Snowshoe'} if 'SHARED' in t else set()
            if 'MOTO' in t and 'NON_MOTO' not in t:
                uses.add('Snowmobile')
        else:
            for token, label in [('HIK', 'Hike'), ('EQU', 'Horse'), ('BIKE', 'Bike'), ('MTC', 'Motorcycle'), ('ATV', 'ATV'), ('UTV', 'OHV')]:
                if token in t:
                    uses.add(label)
            if 'SHARED' in t:
                uses |= {'Hike', 'Horse', 'Bike'}
            if t in {'ALL_MOTO_VEH', 'TECH_VEH_SHARED'}:
                uses |= {'Hike', 'Horse', 'Bike', 'ATV', 'Motorcycle', 'OHV'}
            elif t == 'STRT_LGL_VEH':
                uses.add('Highway vehicles')
            elif t == 'TECH_HI_CLEAR_VEH_ONLY':
                uses.add('High-clearance vehicles')
            elif not t and first(p, 'plan_mode_trnsprt').upper() == 'MOTORIZED':
                uses.add('OHV')
        if first(p, 'plan_season_rstrct_code').upper() == 'YES':
            seasons.append(first(p, 'ohv_dsgntn_lim_explain') or 'Seasonal')
    road = src in {'usfs_roads', 'usfs_mvum_roads'} or (src == 'blm_gtlf' and 'ROAD' in first(p, 'plan_asset_class').upper()) or (src == 'usgs_ndt' and first(p, 'routetype') == 'Road')
    name = first(p, 'trail_name', 'trlname', 'route_prmry_nm', 'name', 'maplabel', 'trlaltname')
    number = first(p, 'trail_no', 'trailnumber', 'id', 'route_plan_id')
    if number and number.lower() not in name.lower():
        name = f'{name} ({number})' if name else ('FR ' if road and agency == 'USFS' else '') + number
    surface = first(p, 'trail_surface', 'trlsurface', 'surface_type', 'surfacetype', 'trailsurface', 'obsrve_srfce_type')
    if 'NAT' in surface.upper() or surface.lower() in {'unpaved native', 'natural'}:
        surface = 'Native'
    elif any(s in surface.lower() for s in ['gravel', 'aggregate', 'agg -']):
        surface = 'Gravel'
    elif any(s in surface.lower() for s in ['paved', 'asphalt', 'concrete', 'ac -', 'pcc -']):
        surface = 'Unpaved' if 'unpaved' in surface.lower() else 'Paved'
    unit = first(p, 'forestname', 'unitname', 'districtname', 'tma_id', 'admin_org', 'adminorg')
    kind = trail_type(uses, 'snow' in first(p, 'trail_type', 'trailtype', 'trltype').lower(), road)
    if src == 'usfs_mvum_trails' and not uses:
        kind = 'ohv'  # MVUM itself designates motor use, even if class fields are blank
    result = {'type': kind, 'src': src, 'agency': agency}
    result.update({k: v for k, v in {'name': clean(name, 100), 'mvum': int(src.startswith('usfs_mvum')), 'uses': use_list(uses), 'seasons': '; '.join(dict.fromkeys(seasons))[:600], 'surface': clean(surface, 40), 'unit': clean(unit, 80), 'date': iso_date(p.get('editdate') or p.get('sourceeditdate') or p.get('sourcedate') or p.get('loaddate')) or date}.items() if v != ''})
    return result


def disk_guard(work):
    size = sum(p.stat().st_size for p in work.rglob('*') if p.is_file())
    if size >= 7.5 * 1024 ** 3 or shutil.disk_usage(work).free < 1024 ** 3:
        raise RuntimeError(f'Disk budget reached ({size / 1024**3:.2f} GiB work); regional upload remains available')


def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def source_date(src, metadata, headers=None):
    edit = (metadata.get('editingInfo') or {}).get('lastEditDate')
    if edit:
        return iso_date(edit)
    if headers and headers.get('Last-Modified'):
        return iso_date(headers['Last-Modified'])
    if src.startswith('usfs'):
        with request(ZIP_BASE + SOURCES[src][0], method='HEAD') as r:
            return iso_date(r.headers.get('Last-Modified'))
    if src == 'blm_gtlf':
        # The public MapServer omits editingInfo; the official equivalent
        # public-road hosted view exposes its edit time (same GTLF publication).
        item = get_json(BLM_ITEM)
        service = get_json(item['url'])
        layer_id = service['layers'][0]['id']
        hosted = get_json(item['url'] + '/' + str(layer_id))
        return iso_date((hosted.get('editingInfo') or {}).get('lastEditDate') or item.get('modified'))
    return ''  # per-feature source/edit dates are used instead of download time


def download_rest(src, url, output, region):
    metadata = get_json(url)
    bounds = REGIONS[region]
    params = {'where': '1=1', 'geometry': ','.join(map(str, bounds)), 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects'}
    if src == 'usgs_ndt':
        # Conservative server prefilter; normalization enforces federal origins.
        params['where'] = "(primarytrailmaintainer IN ('FWS','USACE','BOR','DOD','DOE','FAA','Other Federal') OR UPPER(sourceoriginator) LIKE '%FISH AND WILDLIFE%' OR UPPER(sourceoriginator) LIKE '%CORPS OF ENGINEERS%' OR UPPER(sourceoriginator) LIKE '%RECLAMATION%' OR UPPER(sourceoriginator) LIKE '%GEOLOGICAL SURVEY%') AND trailtype <> 'Water Trail'"
    ids = sorted(get_json(url + '/query', **params, returnIdsOnly='true').get('objectIds') or [])
    date = source_date(src, metadata)
    log(f'{src} {url.rsplit("/", 1)[-1]}: {len(ids):,} features; date={date or "per feature"}')
    # IDs avoid changing offset pagination and are not subject to transfer caps.
    oid = next(f['name'] for f in metadata['fields'] if f['type'] == 'esriFieldTypeOID')
    count = 0
    def page(batch):
        j = get_json(url + '/query', f='geojson', objectIds=','.join(map(str, batch)), outFields='*', outSR=4326, returnGeometry='true')
        features = j.get('features', [])
        got = {int(x['properties'].get(oid, x.get('id', -1))) for x in features}
        if j.get('exceededTransferLimit') or got != set(batch):
            if len(batch) == 1:
                raise RuntimeError(f'Incomplete feature query at {url}: {batch}, got {got}')
            mid = len(batch) // 2
            return page(batch[:mid]) + page(batch[mid:])
        return features
    batches = [ids[start:start + 300] for start in range(0, len(ids), 300)]
    with gzip.open(output, 'wt', encoding='utf-8', compresslevel=3) as f, concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for batch_number, features in enumerate(pool.map(page, batches)):
            for feature in features:
                feature['properties'] = {k: v for k, v in feature['properties'].items() if v is not None}
                feature['_date'] = date
                feature['_view'] = url.rsplit('/', 1)[-1]
                f.write(compact(feature) + '\n')
            count += len(features)
            if batch_number % 10 == 0:
                log(f'  {src}: {count:,}/{len(ids):,}')
                disk_guard(output.parents[2])
    return {'url': url, 'date': date, 'features': count, 'oid': oid}


def canonical_dbf_fields(fields, metadata_fields):
    """Restore DBF names only when official ordinal schema and prefixes agree."""
    canonical = [f for f in metadata_fields if f and f.upper() not in {'OBJECTID','FID','SHAPE'}]
    if len(canonical) != len(fields):
        raise RuntimeError(f'DBF/schema field count mismatch: {len(fields)} != {len(canonical)}')
    aliases = {}
    for short, full in zip(fields, canonical):
        normalized = re.sub(r'[^a-z0-9_]', '_', full.lower())
        stem = re.sub(r'_?\d+$', '', short.lower()).rstrip('_')
        if short.lower() != normalized and (len(stem) < 4 or not normalized.startswith(stem)):
            raise RuntimeError(f'DBF/schema field order mismatch: {short} != {full}')
        aliases[short.lower()] = normalized
    return aliases


def download_zip(src, work, output, region):
    """Read compressed shapefiles via GDAL /vsizip, never expand national DBFs."""
    from osgeo import ogr, osr
    filename = SOURCES[src][0]
    target = work / 'downloads' / filename
    target.parent.mkdir(exist_ok=True)
    url = ZIP_BASE + filename
    with request(url, method='HEAD') as r:
        expected, date = int(r.headers['Content-Length']), iso_date(r.headers.get('Last-Modified'))
    if not target.exists() or target.stat().st_size != expected:
        log(f'Downloading {filename}: {expected / 1024**2:.1f} MiB')
        tmp = target.with_suffix('.partial')
        with request(url) as r, tmp.open('wb') as f:
            shutil.copyfileobj(r, f, 1024 * 1024)
        if tmp.stat().st_size != expected:
            raise RuntimeError(f'Incomplete ZIP: {filename}')
        tmp.replace(target)
    with zipfile.ZipFile(target) as z:
        shp = next(n for n in z.namelist() if n.lower().endswith('.shp'))
        # ESRI shapefile metadata records the long field names in attralias.
        import xml.etree.ElementTree as ET
        aliases = {}
        for n in z.namelist():
            if n.lower().endswith('.xml'):
                try:
                    xml = ET.fromstring(z.read(n))
                    for attr in xml.findall('.//attr'):
                        label, alias = attr.findtext('attrlabl'), attr.findtext('attalias') or attr.findtext('attralias')
                        if label and alias:
                            aliases[label.lower()] = alias.lower()
                except ET.ParseError:
                    pass
    ds = ogr.Open('/vsizip/' + str(target) + '/' + shp)
    if ds is None:
        raise RuntimeError(f'GDAL could not open {target}')
    layer = ds.GetLayer(0)
    wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    srs = layer.GetSpatialRef(); srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_wgs = osr.CoordinateTransformation(srs, wgs)
    to_src = osr.CoordinateTransformation(wgs, srs)
    w, s, e, n = REGIONS[region]
    corners = to_src.TransformPoints([(w,s),(e,s),(w,n),(e,n)])
    layer.SetSpatialFilterRect(min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners), max(p[1] for p in corners))
    count = 0
    # Preserve the known long schema by using XML aliases; fail loudly if the
    # DBF cannot represent the required MVUM fields (REST fallback in download).
    fields = [layer.GetLayerDefn().GetFieldDefn(i).GetName() for i in range(layer.GetLayerDefn().GetFieldCount())]
    # The national ZIP XML also truncates many aliases. The separately
    # published authoritative schema retains their original order and names.
    metadata_url = ZIP_BASE.replace('/shp/', '/meta/') + filename.replace('.zip','.xml')
    with request(metadata_url) as response:
        schema = ET.fromstring(response.read())
    metadata_fields = [a.findtext('attrlabl') for a in schema.findall('.//attr')]
    aliases = canonical_dbf_fields(fields, metadata_fields)
    log(f'{src}: validated {len(fields)} DBF fields against published XML schema')
    canonical = {aliases.get(k.lower(), k.lower()) for k in fields}
    required = {'usfs_trails': {'trail_cn','trail_no','trail_type','allowed_terra_use','allowed_snow_use'},
                'usfs_mvum_trails': {'rte_cn','id','atv_datesopen','motorcycle_datesopen'},
                'usfs_mvum_roads': {'rte_cn','id','passengervehicle_datesopen','highclearancevehicle_datesopen'},
                'usfs_roads': {'rte_cn','id','route_status','oper_maint_level'}}[src]
    if not required <= canonical:
        raise RuntimeError('DBF lacks long aliases for ' + ', '.join(sorted(required-canonical)))
    # C++ GDAL streams geometry and SQL aliases directly into gzip; Python
    # per-field access to large compressed DBFs is prohibitively expensive.
    sql = 'SELECT ' + ','.join('"' + k + '" AS "' + aliases[k.lower()] + '"' for k in fields) + ' FROM "' + layer.GetName() + '"'
    source = '/vsizip/' + str(target) + '/' + shp
    command = ['ogr2ogr','-f','GeoJSONSeq','/vsistdout/',source,
               '-sql',sql,'-spat',str(min(p[0] for p in corners)),str(min(p[1] for p in corners)),str(max(p[0] for p in corners)),str(max(p[1] for p in corners)),
               '-t_srs','EPSG:4326','-dim','XY','-lco','RS=NO','-lco','COORDINATE_PRECISION=7']
    ds = None
    with subprocess.Popen(command, stdout=subprocess.PIPE) as process, gzip.open(output,'wb',compresslevel=3) as f:
        try:
            blocks = 0
            while block := process.stdout.read(1024 * 1024):
                f.write(block)
                count += block.count(b'\n')
                blocks += 1
                if blocks % 32 == 0:
                    disk_guard(work)
                    log(f'  {src}: {count:,}')
            if process.wait():
                raise RuntimeError(f'GDAL extraction failed for {filename}')
        except BaseException:
            process.terminate(); process.wait()
            raise
    log(f'  {src}: {count:,} complete')
    return {'url':url, 'date':date, 'features':count, 'fieldAliases':aliases}


def download(args):
    work = args.work
    raw = work / args.region / 'raw'; raw.mkdir(parents=True, exist_ok=True)
    metadata = {}
    # Check documented bulk links before falling back to public BLM queries.
    for url in [BLM_BULK, 'https://gbp-blm-egis.hub.arcgis.com/api/download/v1/items/f94999eb674d4085be0c86729fe4a151/shapefile?layers=3']:
        try:
            with request(url, method='HEAD') as r:
                log(f'BLM bulk check: {r.status}, {r.headers.get("Content-Type")} {url}')
                if 'hub.arcgis.com' in url:
                    log('BLM hosted export covers one road view; use MapServer 0/1/7 for a consistent complete public inventory')
        except urllib.error.HTTPError as e:
            log(f'BLM bulk check: HTTP {e.code} {url}')
    for src, (zipname, urls) in SOURCES.items():
        paths = []
        if zipname and args.region == 'lower48':
            output = raw / (src + '-bulk.jsonl.gz')
            marker = output.with_suffix('.done.json')
            if not marker.exists():
                try:
                    details = download_zip(src, work, output, args.region)
                    marker.write_text(compact(details))
                except RuntimeError as e:
                    log(f'{src}: {e}; using lossless REST fields instead')
                    output.unlink(missing_ok=True)
            if marker.exists():
                paths.append(marker)
        if not paths:
            for i, url in enumerate(urls):
                output = raw / f'{src}-{i}.jsonl.gz'
                marker = output.with_suffix('.done.json')
                if not marker.exists():
                    temp = output.with_name(output.name + '.partial')
                    details = download_rest(src, url, temp, args.region)
                    temp.replace(output)
                    marker.write_text(compact(details))
                paths.append(marker)
        metadata[src] = [json.loads(p.read_text()) for p in paths]
        disk_guard(work)
    (work / args.region / 'sources.json').write_text(json.dumps(metadata, indent=2) + '\n')


def init_geometry():
    global shape, mapping, transform, box, unary_union, from_wkb, forward, backward
    from shapely.geometry import shape, mapping, box
    from shapely.ops import transform, unary_union
    from shapely import from_wkb
    from osgeo import osr
    osr.UseExceptions()
    wgs, conus = osr.SpatialReference(), osr.SpatialReference()
    wgs.ImportFromEPSG(4326); conus.ImportFromEPSG(5070)
    wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    conus.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    def project(conversion):
        def fn(x, y, z=None):
            try:
                points = conversion.TransformPoints(list(zip(x, y)))
                return [p[0] for p in points], [p[1] for p in points]
            except TypeError:
                p = conversion.TransformPoint(x, y)
                return p[0], p[1]
        return fn
    forward = project(osr.CoordinateTransformation(wgs, conus))
    backward = project(osr.CoordinateTransformation(conus, wgs))


def lines(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == 'LineString':
        # This helper is used in both degrees and metres; never apply a
        # metric threshold here (short geographic segments must survive).
        if geometry.length > 0:
            yield geometry
    elif hasattr(geometry, 'geoms'):
        for g in geometry.geoms:
            yield from lines(g)


def route_keys(properties):
    p = props_lower(properties)
    keys = set()
    cn = first(p, 'trail_cn', 'rte_cn')
    if cn:
        keys.add('cn:' + cn)
    number = first(p, 'trail_no', 'id')
    # Route numbers repeat nationally, so require the forest identity if known.
    forest = first(p, 'security_id', 'securityid') or first(p, 'admin_org', 'adminorg')[:4]
    if number:
        keys.add('no:' + forest + ':' + number.upper())
    return keys


class LineIndex:
    """Disk R-tree: bounded RAM even for the full national road inventory."""
    def __init__(self, path):
        self.work = path.parents[1]
        self.db = sqlite3.connect(path)
        self.db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-16000; CREATE TABLE line(id INTEGER PRIMARY KEY, kind TEXT, geom BLOB, props TEXT, keys TEXT); CREATE VIRTUAL TABLE bbox USING rtree(id,w,e,s,n);')
        self.next_id = 0

    def add(self, kind, geom, props=None, keys=()):
        self.next_id += 1
        w,s,e,n = geom.bounds
        self.db.execute('INSERT INTO line VALUES(?,?,?,?,?)', (self.next_id, kind, geom.wkb, compact(props or {}), compact(sorted(keys))))
        self.db.execute('INSERT INTO bbox VALUES(?,?,?,?,?)', (self.next_id,w,e,s,n))
        if self.next_id % 5000 == 0:
            self.db.commit()
            disk_guard(self.work)

    def candidates(self, geom, kind=None, keys=None):
        w,s,e,n = geom.bounds
        sql = 'SELECT kind,geom,props,keys FROM bbox JOIN line USING(id) WHERE w<=? AND e>=? AND s<=? AND n>=?'
        params = [e+21,w-21,n+21,s-21]
        if kind:
            sql += ' AND kind=?'; params.append(kind)
        # SQLite R-tree disallows writes while a scan is active. Materialize
        # this local bbox result before callers add emitted agency segments.
        for k,g,p,ids in self.db.execute(sql, params).fetchall():
            if keys is None or keys & set(json.loads(ids)):
                yield k, from_wkb(g), json.loads(p)

    def coverage(self, geom, kind=None, keys=None):
        nearby = [g.buffer(20, quad_segs=2) for _,g,_ in self.candidates(geom,kind,keys) if g.distance(geom) <= 20]
        return unary_union(nearby) if nearby else None


def merge_motor(base, motor):
    p = dict(base)
    uses = set(base.get('uses','').split(', ')) | set(motor.get('uses','').split(', '))
    uses.discard('')
    p['uses'] = use_list(uses)
    season_parts = (base.get('seasons','') + '; ' + motor.get('seasons','')).split('; ')
    p['seasons'] = '; '.join(dict.fromkeys(filter(None, season_parts)))[:600]
    p['mvum'] = 1
    p['type'] = trail_type(uses)
    if motor.get('type') == 'ohv' and p['type'] != 'ohv':
        p['type'] = 'ohv'
    if motor.get('unit') and not base.get('unit', '').endswith(('Forest','Forests')):
        p['unit'] = motor['unit']
    p['date'] = max(base.get('date',''), motor.get('date',''))
    return {key:value for key,value in p.items() if value != ''}


def length_km(geometry):
    total = 0
    for line in lines(geometry):
        coordinates = list(line.coords)
        for a,b in zip(coordinates, coordinates[1:]):
            lon1, lat1, lon2, lat2 = map(math.radians, (a[0],a[1],b[0],b[1]))
            h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
            total += 12742.0088 * math.asin(min(1, math.sqrt(h)))
    return total


def normalize(args):
    init_geometry()
    folder = args.work / args.region
    output = folder / 'trails.geojsonl'
    index_path = folder / 'index.sqlite'
    index_path.unlink(missing_ok=True)
    index = LineIndex(index_path)
    clip = box(*REGIONS[args.region])
    stats = {'region':args.region, 'bounds':list(REGIONS[args.region]), 'sources':{}, 'excluded':collections.Counter()}
    seen = set()
    def raw(src):
        paths = sorted((folder / 'raw').glob(src + '-*.jsonl.gz'))
        paths = [path for path in paths if path.with_suffix('.done.json').exists()]
        bulk = [path for path in paths if path.name.endswith('-bulk.jsonl.gz')]
        if bulk:
            paths = bulk  # never combine cached REST and national ZIP snapshots
        if not paths:
            raise RuntimeError(f'Missing download for {src}')
        for path in paths:
            acquisition_date = json.loads(path.with_suffix('.done.json').read_text()).get('date','')
            with gzip.open(path, 'rt', encoding='utf-8') as f:
                for row in f:
                    feature = json.loads(row)
                    p = normalize_properties(src, feature['properties'], feature.get('_date') or acquisition_date)
                    if p is None or not feature.get('geometry'):
                        stats['excluded'][src + ':attributes'] += 1
                        continue
                    geo = shape(feature['geometry']).intersection(clip)
                    for line in lines(geo):
                        yield feature, p, transform(forward, line)
    def emit(geom, props, f, agency=True):
        for g in lines(geom):
            if g.length <= 0:
                continue
            geo = transform(backward, g)
            # Stable 6-decimal coordinates are ample for ~20m dedup tolerance.
            coords = [[round(x,6),round(y,6)] for x,y,*_ in geo.coords]
            coords = [p for i,p in enumerate(coords) if i == 0 or p != coords[i-1]]
            if len(coords) < 2:
                continue
            geometry = {'type':'LineString','coordinates':coords}
            sig = hashlib.sha256(compact([props, sorted([coords,list(reversed(coords))])[0]]).encode()).digest()
            if sig in seen:
                stats['excluded'][props['src'] + ':exact'] += 1
                continue
            seen.add(sig)
            minzoom = 10 if props['type'] == 'road' else (7 if props.get('mvum') or props['type'] == 'ohv' else 8)
            f.write(compact({'type':'Feature','properties':props,'geometry':geometry,'tippecanoe':{'minzoom':minzoom,'maxzoom':14}}) + '\n')
            s = stats['sources'].setdefault(props['src'], {'features':0,'km':0,'types':collections.Counter()})
            s['features'] += 1; s['km'] += length_km(geo); s['types'][props['type']] += 1
            if agency:
                index.add('agency',g)
    with output.with_suffix('.partial').open('w', encoding='utf-8') as f:
        # MVUM goes into a temporary spatial index first; it is emitted only
        # after NFS geometry has absorbed its overlapping designated segments.
        for feature,p,g in raw('usfs_mvum_trails'):
            index.add('motor', g, p, route_keys(feature['properties']))
        log('Normalize NFS trails + MVUM designations')
        for feature,p,g in raw('usfs_trails'):
            keys = route_keys(feature['properties'])
            pieces = [(g,p)]
            for _,motor,mp in index.candidates(g,'motor',keys):
                area = motor.buffer(20, quad_segs=2)
                next_pieces = []
                for segment,properties in pieces:
                    if segment.is_empty or motor.distance(segment) > 20:
                        next_pieces.append((segment,properties))
                        continue
                    covered = segment.intersection(area)
                    remainder = segment.difference(area)
                    if not covered.is_empty:
                        next_pieces.append((covered,merge_motor(properties,mp)))
                    if not remainder.is_empty:
                        next_pieces.append((remainder,properties))
                pieces = next_pieces
            for segment,properties in pieces:
                emit(segment,properties,f)
            index.add('nfs',g,keys=keys)
        log('Normalize unmatched MVUM trail segments')
        for feature,p,g in raw('usfs_mvum_trails'):
            covered = index.coverage(g,'nfs',route_keys(feature['properties']))
            emit(g.difference(covered) if covered is not None else g,p,f)
        log('Normalize MVUM roads')
        for feature,p,g in raw('usfs_mvum_roads'):
            emit(g,p,f)
            index.add('mvumroad',g,keys=route_keys(feature['properties']))
        log('Normalize non-MVUM NFS roads (including maintenance level 1)')
        for feature,p,g in raw('usfs_roads'):
            covered = index.coverage(g,'mvumroad',route_keys(feature['properties']))
            if covered is not None:
                stats['excluded']['usfs_roads:mvum_overlap_km'] += length_km(transform(backward,g.intersection(covered)))
            emit(g.difference(covered) if covered is not None else g,p,f)
        log('Normalize BLM public designated roads/trails')
        for feature,p,g in raw('blm_gtlf'):
            pp = props_lower(feature['properties'])
            feature_id = first(pp,'original_globalid','globalid')
            # Route IDs may describe several distinct segments. Only suppress
            # the spatially duplicated portion, never every segment of a route.
            keys = {feature_id} if feature_id else {first(pp,'admin_st') + ':' + first(pp,'route_plan_id','fams_id')}
            covered = index.coverage(g,'blm',keys)
            emit(g.difference(covered) if covered is not None else g,p,f)
            index.add('blm',g,keys=keys)
        log('Normalize NPS public trails')
        for _,p,g in raw('nps_trails'):
            emit(g,p,f)
        log('Normalize federal-origin USGS NDT, excluding >70% agency overlap within 20m')
        for _,p,g in raw('usgs_ndt'):
            covered = index.coverage(g,'agency')
            if covered is not None and g.intersection(covered).length / g.length > 0.70:
                stats['excluded']['usgs_ndt:spatial_duplicate'] += 1
                continue
            emit(g,p,f,agency=False)
        disk_guard(args.work)
    output.with_suffix('.partial').replace(output)
    index.db.close(); index_path.unlink()
    for s in stats['sources'].values():
        s['km'] = round(s['km'], 2)
    (folder / 'stats.json').write_text(json.dumps(stats, indent=2) + '\n')
    log(json.dumps(stats, indent=2))


def run(command, work=None, **kw):
    log('+ ' + ' '.join(map(str,command)))
    with subprocess.Popen(list(map(str,command)), **kw) as process:
        try:
            while process.poll() is None:
                if work is not None:
                    disk_guard(work)
                time.sleep(1)
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, command)
        except BaseException:
            process.terminate()
            process.wait()
            raise


def tiles(args):
    folder = args.work / args.region
    temp = folder / 'tile-tmp'; temp.mkdir(exist_ok=True)
    env = {**os.environ, 'TIPPECANOE_MAX_THREADS':'4'}
    common = ['tippecanoe','--force','--layer=trails','--name=Public trails', '--attribution='+ATTRIBUTION, '--simplification=2', '--buffer=8', '--no-progress-indicator', '--temporary-directory='+str(temp)]
    try:
        # Separate zoom ranges ensure that no density dropping or coalescing
        # can ever propagate into z12+.
        for low,high,name,options in [(6,11,'low',['--drop-densest-as-needed']), (12,14,'high',['--no-feature-limit','--no-tile-size-limit'])]:
            disk_guard(args.work)
            run(common + ['-Z'+str(low),'-z'+str(high),'-o',folder/(name+'.pmtiles')] + options + [folder/'trails.geojsonl'], env=env, work=args.work)
        run(['tile-join','--force','--no-tile-size-limit','--no-tile-stats','-o',folder/'trails.pmtiles',folder/'low.pmtiles',folder/'high.pmtiles'], env=env, work=args.work)
        # tile-join infers the first populated zoom (7/8/10). The public
        # source contract starts at z6 even when those tiles are empty. This
        # fixed-size header field does not change offsets or tile contents.
        with (folder/'trails.pmtiles').open('r+b') as f:
            if f.read(8) != b'PMTiles\x03':
                raise RuntimeError('Expected PMTiles v3 output')
            f.seek(100); f.write(bytes([6])); f.seek(0)
            header = f.read(127)
            if header[:8] != b'PMTiles\x03' or header[100:102] != bytes([6,14]):
                raise RuntimeError('Unexpected PMTiles format/zoom range')
            metadata_offset, metadata_length = struct.unpack_from('<QQ',header,24)
            f.seek(metadata_offset); payload=f.read(metadata_length)
            if header[97] == 2:
                payload=gzip.decompress(payload)
            meta=json.loads(payload)
            if [l['id'] for l in meta['vector_layers']] != ['trails']:
                raise RuntimeError('Expected exactly one trails vector layer')
        size = (folder/'trails.pmtiles').stat().st_size
        stats = json.loads((folder/'stats.json').read_text())
        stats['archiveBytes'] = size
        stats['sha256'] = file_sha(folder/'trails.pmtiles')
        (folder/'stats.json').write_text(json.dumps(stats,indent=2)+'\n')
        log(f'Archive {folder/"trails.pmtiles"}: {size:,} bytes ({size/1024**2:.2f} MiB)')
        log(json.dumps(stats,indent=2))
    finally:
        for name in ['low.pmtiles','high.pmtiles']:
            (folder/name).unlink(missing_ok=True)
        shutil.rmtree(temp,ignore_errors=True)


def wrangler(*args, check=True, capture=False):
    return subprocess.run(['npx','--no-install','wrangler',*map(str,args)],cwd=ROOT,check=check,text=True,stdout=subprocess.PIPE if capture else None,stderr=subprocess.STDOUT if capture else None)


def upload(args):
    # Each data build is immutable under its own version; bump TRAILS_TILES in src/map/sources.ts to match.
    PREFIX=f'fhm-tiles/trails/{args.version}/'
    folder=args.work/args.region
    archive=folder/'trails.pmtiles'
    buckets=wrangler('r2','bucket','list',capture=True).stdout
    if not re.search(r'name:\s+fhm-tiles(?:\s|$)',buckets):
        wrangler('r2','bucket','create','fhm-tiles')
    old_path=folder/'previous-manifest.json'
    old=wrangler('r2','object','get',PREFIX+'manifest.json','--file',old_path,'--remote',check=False,capture=True)
    old_parts=0
    if old.returncode==0:
        old_parts=json.loads(old_path.read_text())['parts']
    elif not any(s in old.stdout.lower() for s in ['does not exist','not found','10007','404']):
        raise RuntimeError('Cannot safely read previous manifest: '+old.stdout)
    size=archive.stat().st_size
    manifest={'size':size,'partSize':PART_SIZE,'parts':math.ceil(size/PART_SIZE),'sha256':file_sha(archive),'built':dt.datetime.now(dt.timezone.utc).date().isoformat(),'bounds':list(REGIONS[args.region])}
    manifest_path=folder/'manifest.json'
    manifest_path.write_text(compact(manifest)+'\n')
    part=folder/'upload-part'
    try:
        with archive.open('rb') as f:
            for i in range(manifest['parts']):
                part.write_bytes(f.read(PART_SIZE))
                wrangler('r2','object','put',PREFIX+f'part-{i:03}','--file',part,'--remote','--content-type','application/octet-stream')
        # Publish after ALL parts. Stable keys mean replacement is not atomic
        # for clients reading an old cached manifest; see README deployment note.
        wrangler('r2','object','put',PREFIX+'manifest.json','--file',manifest_path,'--remote','--content-type','application/json')
        verify=folder/'verified-manifest.json'
        wrangler('r2','object','get',PREFIX+'manifest.json','--file',verify,'--remote')
        if json.loads(verify.read_text()) != manifest:
            raise RuntimeError('Remote manifest differs from local archive')
        for i in range(manifest['parts'],old_parts):
            wrangler('r2','object','delete',PREFIX+f'part-{i:03}','--remote','--force')
        log('Verified R2 '+PREFIX+'manifest.json '+compact(manifest))
    finally:
        part.unlink(missing_ok=True); old_path.unlink(missing_ok=True)


def cleanup(args):
    folder=args.work/args.region
    shutil.rmtree(folder/'raw',ignore_errors=True)
    (folder/'trails.geojsonl').unlink(missing_ok=True)
    downloads=args.work/'downloads'
    if downloads.exists() and sum(p.stat().st_size for p in downloads.iterdir()) >= 2*1024**3:
        shutil.rmtree(downloads)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['download','normalize','tiles','upload','all'])
    parser.add_argument('--region',choices=REGIONS,default='wi')
    parser.add_argument('--version',default='v2',help='R2 data version prefix (trails/vN/); use a new N for every build')
    parser.add_argument('--work',type=Path,default=Path('/workspace/trails-build/work'))
    args=parser.parse_args(); args.work=args.work.resolve(); args.work.mkdir(parents=True,exist_ok=True)
    if args.command=='all':
        for command in [download,normalize,tiles,upload]:
            command(args)
        cleanup(args)
    else:
        globals()[args.command](args)


if __name__=='__main__':
    main()
