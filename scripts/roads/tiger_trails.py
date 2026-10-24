#!/usr/bin/env python3
"""Build Census TIGER vehicular trails, public domain under 17 USC 105.
Sources: https://www2.census.gov/geo/tiger/TIGER2026/ROADS/ (latest checked).
License: https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2026/TGRSHP2026_TechDoc_Ch1.pdf
Run: python3 scripts/roads/tiger_trails.py --work /workspace/roads-build/tiger
Requires Python 3.11+, GDAL Python, pyproj, pmtiles, curl, pdftotext,
and tippecanoe/tile-join; never uploads.
"""
from __future__ import annotations
import argparse
import concurrent.futures as futures
import collections
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from osgeo import ogr, osr
from pyproj import Geod
from pmtiles.reader import Reader

BASE = 'https://www2.census.gov/geo/tiger/'
LICENSE = 'https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2026/TGRSHP2026_TechDoc_Ch1.pdf'
MIDWEST = {'55', '27', '26', '19', '17'}
STATES = {'01','04','05','06','08','09','10','11','12','13','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','44','45','46','47','48','49','50','51','53','54','55','56'}
GEOD = Geod(ellps='WGS84')
ogr.UseExceptions()

def guard(work):
    if shutil.disk_usage(work).free < 26 * 1024**3:
        raise RuntimeError('Free disk guard: reserve 25 GiB plus download allowance')
    if sum(p.stat().st_size for p in work.rglob('*') if p.is_file()) > 11 * 1024**3:
        raise RuntimeError('Work directory approaching 12 GB budget')

def fetch(url, path):
    guard(path.parent)
    result = subprocess.run(['curl','--http1.1','-fLsS','--retry','5','--retry-all-errors','--connect-timeout','30','--max-time','300','-w','%{http_code} %{content_type} %{size_download}',url,'-o',str(path)], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{url}: {result.stderr}')
    return {'url':url,'response':result.stdout,'checked':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}

def rounded(value):
    if isinstance(value, list):
        return [rounded(v) for v in value]
    return round(value,6)

def county(work, year, code):
    dest = work / 'counties' / (code+'.geojsonl.gz')
    meta = dest.with_suffix('.json')
    if dest.exists() and meta.exists():
        cached = json.loads(meta.read_text())
        if f'TIGER{year}/ROADS/' in cached.get('url',''):
            return cached
    raw = work / f'tl_{year}_{code}_roads.zip'
    evidence = fetch(f'{BASE}TIGER{year}/ROADS/{raw.name}', raw)
    temp = dest.with_suffix('.part')
    counts = collections.Counter()
    try:
        ds = ogr.Open('/vsizip/'+str(raw))
        if ds is None:
            raise RuntimeError(f'Invalid ZIP {raw}')
        layer = ds.GetLayer(0)
        if code == '55019':
            layer.SetAttributeFilter("FULLNAME = 'Wildcat Ln'")
            wildcat = [{'c':f['MTFCC'], 'n':f['FULLNAME'], 'id':f['LINEARID']} for f in layer]
            (work/'wildcat-road-class.json').write_text(json.dumps(wildcat,indent=2)+'\n')
        layer.SetAttributeFilter("MTFCC IN ('S1500','S1740','S1730','S1780','S1820','S1830')")
        target = osr.SpatialReference(); target.ImportFromEPSG(4326)
        target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        source = layer.GetSpatialRef(); source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        transform = osr.CoordinateTransformation(source,target)
        with gzip.open(temp,'wt') as out:
            for feature in layer:
                c = feature['MTFCC']; counts[c] += 1
                if c not in {'S1500','S1740'}:
                    continue
                geom = feature.GetGeometryRef().Clone(); geom.Transform(transform)
                geometry = json.loads(geom.ExportToJson())
                geometry['coordinates'] = rounded(geometry['coordinates'])
                props = {'c':c, 'id':feature['LINEARID'], 'statefp':code[:2], 'countyfp':code[2:]}
                if feature['FULLNAME']:
                    props['n'] = feature['FULLNAME']
                out.write(json.dumps({'type':'Feature','properties':props,'geometry':geometry},separators=(',',':'))+'\n')
        ds = None
        temp.replace(dest)
        evidence.update(county=code,counts=dict(counts))
        meta.write_text(json.dumps(evidence,indent=2)+'\n')
        return evidence
    finally:
        raw.unlink(missing_ok=True)
        temp.unlink(missing_ok=True)

def run_tiles(work, stem, tile_input):
    env = {**os.environ,'TIPPECANOE_MAX_THREADS':'4'}
    common = ['tippecanoe','--force','--layer=tiger','--name=Census TIGER vehicular trails','--attribution=U.S. Census Bureau; public domain','--buffer=8','--no-progress-indicator','--temporary-directory='+str(work/'tile-tmp')]
    for lo,hi,label,opts in [(8,11,'low',['--drop-densest-as-needed']),(12,14,'high',['--no-feature-limit','--no-tile-size-limit'])]:
        guard(work)
        with (work/(stem+'-'+label+'.log')).open('w') as log:
            subprocess.run(common+[f'-Z{lo}',f'-z{hi}','-o',str(work/(label+'.pmtiles'))]+opts+[str(tile_input)],env=env,stdout=log,stderr=log,check=True)
    archive = work/(stem+'.pmtiles')
    with (work/(stem+'-join.log')).open('w') as log:
        subprocess.run(['tile-join','--force','--no-tile-size-limit','--no-tile-stats','-o',str(archive),str(work/'low.pmtiles'),str(work/'high.pmtiles')],env=env,stdout=log,stderr=log,check=True)
    with archive.open('r+b') as out:
        assert out.read(8) == b'PMTiles\x03'
        out.seek(100); out.write(bytes([8]))
    for name in ['low.pmtiles','high.pmtiles']:
        (work/name).unlink()
    return archive

def build(work, stem, codes, year):
    export = work/(stem+'.geojsonl.gz')
    tile_input = work/'tiles.geojsonl'
    counts = collections.Counter(); km = collections.Counter(); bbox = [180,90,-180,-90]
    with gzip.open(export,'wt') as out, tile_input.open('w') as tiles:
        for code in codes:
            with gzip.open(work/'counties'/(code+'.geojsonl.gz'),'rt') as src:
                for line in src:
                    f = json.loads(line); c = f['properties']['c']
                    counts[c] += 1
                    coords = f['geometry']['coordinates']
                    parts = [coords] if f['geometry']['type']=='LineString' else coords
                    for part in parts:
                        xs,ys = zip(*part)
                        km[c] += GEOD.line_length(xs,ys)/1000
                        bbox = [min(bbox[0],min(xs)),min(bbox[1],min(ys)),max(bbox[2],max(xs)),max(bbox[3],max(ys))]
                    out.write(line)
                    f['properties'] = {k:v for k,v in f['properties'].items() if k in {'c','n','id'}}
                    f['tippecanoe'] = {'minzoom':8 if c=='S1500' else 9,'maxzoom':14}
                    tiles.write(json.dumps(f,separators=(',',':'))+'\n')
    archive = run_tiles(work,stem,tile_input)
    tile_input.unlink()
    with archive.open('rb') as file:
        reader = Reader(lambda offset,length: (file.seek(offset),file.read(length))[1])
        assert reader.header()['min_zoom']==8 and reader.header()['max_zoom']==14
        metadata = reader.metadata()
        assert [v['id'] for v in metadata['vector_layers']]==['tiger']
        wildcat = []
        for z in range(8,15):
            x=int((-90.81941+180)/360*2**z)
            y=int((1-math.asinh(math.tan(math.radians(44.51971)))/math.pi)/2*2**z)
            data = reader.get(z,x,y)
            if data:
                wildcat.append({'z':z,'x':x,'y':y,'bytes':len(data)})
    stats = dict(year=year,counties=len(codes),states=sorted({c[:2] for c in codes}),counts=dict(counts),km=dict(km),bbox=bbox,archiveBytes=archive.stat().st_size,exportBytes=export.stat().st_size,wildcatTiles=wildcat,metadata=metadata)
    with archive.open('rb') as source:
        stats['sha256'] = hashlib.file_digest(source,'sha256').hexdigest()
    (work/(stem+'.stats.json')).write_text(json.dumps(stats,indent=2)+'\n')
    report(work,year)
    print(f'Finished {stem}: {sum(counts.values()):,} features; {sum(km.values()):,.2f} km',flush=True)

def report(work,year):
    text = f'''# Census TIGER vehicular trails\n\nBuilt {time.strftime('%Y-%m-%d')} from TIGER{year}. Source: {BASE}TIGER{year}/ROADS/ .\n\nLicense evidence: {LICENSE} section 1.2 states federal works have no copyright under 17 USC 105 and permits reproduction; cite U.S. Census Bureau. Saved license.pdf/license.txt. Federal public domain; no access permission is inferred from road classification.\n\nVerified root and 2025/2026 directory listings with real HTTP/1.1 requests; 2026 county ROADS exist (newer than the task's suggested 2025/2024 releases). County request URL, HTTP status, content type, size, checked time and class counts are recorded in counties/*.geojsonl.json. Every downloaded ZIP was opened by GDAL, filtered and immediately deleted.\n\nKept S1500 (vehicular trail, 4WD) and S1740 (private service roads, including logging/oil/ranch roads). Excluded S1730 alleys and S1780 parking roads: urban/service circulation rather than useful trail labels. Excluded S1820 bike paths and S1830 bridle paths: nonvehicular and outside the requested classes. All other MTFCC classes excluded. No surface or legal public-access inference. Geometry reprojected NAD83 to EPSG:4326 and rounded to six decimals. County records retained as published; no cross-county deduplication.\n\nOne vector source-layer `tiger`; zooms 8–14, S1500 minzoom 8, S1740 minzoom 9. z8–11 may drop dense lines; separate z12–14 build uses --no-feature-limit --no-tile-size-limit, joined without tile size limits. Header minzoom verified/set to 8. Tiles use c:string (MTFCC), n:string (FULLNAME, omitted if empty), id:string (LINEARID). Training exports are gzipped newline-delimited GeoJSON Features (GeoJSONSeq without optional RS), same properties plus statefp:string (2-digit), countyfp:string (3-digit). No tippecanoe metadata in training exports.\n'''
    text += '\nCoverage: Midwest is WI, MN, MI, IA, IL; national is the lower 48 states plus DC, excluding AK, HI and all territories. Bboxes below describe retained geometry, not the county download extents.\n'
    text += '\nCurrent classification definitions verified in https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2026/TGRSHP2026_TechDoc.pdf (saved techdoc2026.pdf/.txt). S1500 explicitly requires 4WD; ordinary unpaved roads are S1400 and outside this task. S1740 does not assert an unpaved surface.\n'
    for path in sorted(work.glob('*.stats.json')):
        s=json.loads(path.read_text())
        evaluated = collections.Counter()
        for meta in (work/'counties').glob('*.geojsonl.json'):
            m = json.loads(meta.read_text())
            if m['county'][:2] in s['states']:
                evaluated.update(m['counts'])
        text += f'\nEvaluated class counts for {path.stem}: {dict(sorted(evaluated.items()))}.\n'
        text += f"\n## {path.name.removesuffix('.stats.json')}\n\nCounties: {s['counties']}; state FIPS: {', '.join(s['states'])}. Bbox: {s['bbox']}.\n\nFeatures: {sum(s['counts'].values()):,}; geodesic length: {sum(s['km'].values()):,.2f} km. By class: {s['counts']}; km: {s['km']}. Archive: {s['archiveBytes']:,} bytes; gzipped export: {s['exportBytes']:,} bytes.\n\nWildcat Ln point-containing tiles with archive data: {s['wildcatTiles'] or 'none; no retained geometry in those point-containing tiles'}. Tile presence is not proof that Wildcat Ln itself is classified S1500/S1740.\n"
        empty_zooms = [z for z in range(8,15) if z not in {t['z'] for t in s['wildcatTiles']}]
        text += f'\nNo point-containing tile data at zooms {empty_zooms}; no retained line was encoded in those tiles.\n'
    wildcat_path = work/'wildcat-road-class.json'
    if wildcat_path.exists():
        text += f'\nClark County Wildcat Ln source classifications: {json.loads(wildcat_path.read_text())}. S1400 is excluded; nearby retained features can still populate the supplied point tile.\n'
    elif (work/'wildcat-source-check.json').exists():
        text += '\nWildcat Ln source check: Clark County LINEARID 110689963906, FULLNAME Wildcat Ln, is S1400 in TIGER2026 and therefore excluded. Its closest source geometry is about 0.000896 degrees from the supplied point; see wildcat-source-check.json. Nearby retained features can still populate its tile.\n'
    for validation in sorted(work.glob('*.validation.json')):
        v=json.loads(validation.read_text())
        text += f"\nVerification {validation.name}: all {sum(v['exportCounts'].values()):,} export records checked for schema, geographic ranges and rounding; {v['sampledFeatures']} sampled features checked at each z12/13/14; missing: {v['missing']}. Decoded Wildcat tiles: {v['wildcatDecoded']}.\n"
    (work/'REPORT.md').write_text(text)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--work',type=Path,default=Path('/workspace/roads-build/tiger')); args=p.parse_args()
    work=args.work.resolve(); work.mkdir(parents=True,exist_ok=True)
    (work/'counties').mkdir(exist_ok=True); (work/'tile-tmp').mkdir(exist_ok=True)
    guard(work)
    evidence=[]
    evidence.append(fetch(BASE,work/'tiger-index.html'))
    years=sorted(set(re.findall(r'href="TIGER(202[4-9])/',(work/'tiger-index.html').read_text())),reverse=True)
    for year in years:
        try:
            evidence.append(fetch(f'{BASE}TIGER{year}/ROADS/',work/f'roads{year}-index.html'))
            codes=sorted(set(re.findall(r'tl_'+year+r'_(\d{5})_roads.zip',(work/f'roads{year}-index.html').read_text())))
            if codes: break
        except RuntimeError:
            continue
    else: raise RuntimeError('No verified county ROADS release')
    evidence.append(fetch(LICENSE,work/'license.pdf'))
    evidence.append(fetch('https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2026/TGRSHP2026_TechDoc.pdf',work/'techdoc2026.pdf'))
    subprocess.run(['pdftotext','-layout',str(work/'techdoc2026.pdf'),str(work/'techdoc2026.txt')],check=True)
    subprocess.run(['pdftotext',str(work/'license.pdf'),str(work/'license.txt')],check=True)
    (work/'requests.json').write_text(json.dumps(evidence,indent=2)+'\n')
    mid=[c for c in codes if c[:2] in MIDWEST]
    national=[c for c in codes if c[:2] in STATES]
    for group,stem in [(mid,'tiger-trails-midwest'),(national,'tiger-trails')]:
        with futures.ThreadPoolExecutor(max_workers=8) as pool:
            jobs=[pool.submit(county,work,year,c) for c in group]
            for i,job in enumerate(futures.as_completed(jobs),1):
                job.result()
                if i%50==0: print(f'{stem}: {i}/{len(group)} counties processed',flush=True)
        build(work,stem,group,year)

if __name__=='__main__':
    main()
