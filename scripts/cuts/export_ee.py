#!/usr/bin/env python3
"""Resumable lower-48 Hansen lossyear export. Requires earthengine-api."""
import argparse
import json
from pathlib import Path
import ee

DATASET = 'UMD/hansen/global_forest_change_2025_v1_13'
FOLDER = 'FreeHuntingMap-gee-cuts-v1'
PREFIX = 'cuts-v1-lossyear-2025'


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('--work', type=Path, default=Path('/workspace/gee/cuts'))
    parser.add_argument('--start', action='store_true')
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    record = args.work / 'export.json'
    ee.Initialize(project='free-hunting-map')
    if record.exists():
        saved = json.loads(record.read_text())
        status = ee.data.getTaskStatus(saved['task_id'])[0]
        saved['status'] = status
        record.write_text(json.dumps(saved, indent=2) + '\n')
        print(json.dumps(status, indent=2))
        return
    if not args.start:
        parser.error('No export record; pass --start to submit once')
    image = ee.Image(DATASET)
    # Native grid: no interpolation of categorical years. Exclude all territories.
    states = ee.FeatureCollection('TIGER/2018/States').filter(
        ee.Filter.inList('STUSPS', ['AK', 'HI', 'PR', 'VI', 'GU', 'MP', 'AS']).Not())
    loss = image.select('lossyear')
    loss = loss.updateMask(image.select('treecover2000').gte(25)).selfMask()
    loss = loss.clipToCollection(states).toUint8()
    task = ee.batch.Export.image.toDrive(
        image=loss, description=PREFIX, folder=FOLDER, fileNamePrefix=PREFIX,
        region=ee.Geometry.Rectangle([-124.85, 24.4, -66.85, 49.4], geodesic=False),
        crs='EPSG:4326', crsTransform=[0.00025, 0, -180, 0, -0.00025, 80],
        maxPixels=30_000_000_000, shardSize=256, fileDimensions=32768,
        skipEmptyTiles=True, fileFormat='GeoTIFF',
        formatOptions={'cloudOptimized': True, 'noData': 0})
    task.start()
    saved = {'task_id': task.id, 'dataset': DATASET, 'folder': FOLDER,
             'prefix': PREFIX, 'status': task.status()}
    record.write_text(json.dumps(saved, indent=2) + '\n')
    print(json.dumps(saved, indent=2))


if __name__ == '__main__':
    main()
