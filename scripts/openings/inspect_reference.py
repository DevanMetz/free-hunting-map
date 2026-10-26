"""Inspect manually labeled NAIP points against matching WorldCover GeoTIFFs.

Run after reference_samples.py exports and the Drive files are downloaded:
  python scripts/openings/inspect_reference.py /path/to/downloads
The labels are exploratory negative examples, not an accuracy sample.
"""
import csv
import sys
from pathlib import Path

import numpy as np
import rasterio

BOUNDS = {
    'mn': (-93.505, 47.195, -93.495, 47.205),
    'va': (-79.505, 37.995, -79.495, 38.005),
    'me': (-69.505, 45.295, -69.495, 45.305),
}
POINTS = Path(__file__).parent / 'reference' / 'negative-points.csv'


def main(directory: Path) -> None:
    with POINTS.open(newline='') as source:
        points = list(csv.DictReader(source))
    print('region,label,longitude,latitude,worldcover_2021')
    for point in points:
        west, south, east, north = BOUNDS[point['region']]
        lng = west + float(point['x_fraction']) * (east - west)
        lat = north - float(point['y_fraction']) * (north - south)
        path = directory / f"sample-worldcover-{point['region']}.tif"
        with rasterio.open(path) as raster:
            if raster.crs is None or raster.crs.to_epsg() != 4326:
                raise ValueError(f'Expected EPSG:4326 in {path}')
            if not (raster.bounds.left <= lng <= raster.bounds.right and
                    raster.bounds.bottom <= lat <= raster.bounds.top):
                raise ValueError(f'Point outside {path}: {lng}, {lat}')
            value = next(raster.sample([(lng, lat)], masked=True))[0]
            if np.ma.is_masked(value):
                raise ValueError(f'No classification at {lng}, {lat}')
        print(f"{point['region']},{point['label']},{lng:.7f},{lat:.7f},{int(value)}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python inspect_reference.py /path/to/downloads')
    main(Path(sys.argv[1]))
