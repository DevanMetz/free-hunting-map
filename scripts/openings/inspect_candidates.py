"""Inspect exploratory candidate points in downloaded WorldCover context rasters.

Usage: python3 scripts/openings/inspect_candidates.py /path/to/downloads
Points are visual interpretations, not a representative accuracy sample.
"""
import csv
import sys
from pathlib import Path

import rasterio

POINTS = Path(__file__).parent / 'reference' / 'positive-candidates.csv'


def main(directory: Path) -> None:
    with POINTS.open(newline='') as source:
        points = list(csv.DictReader(source))
    print('region,label,longitude,latitude,worldcover')
    for point in points:
        path = directory / f"context-worldcover-{point['region']}.tif"
        with rasterio.open(path) as raster:
            if raster.crs is None or raster.crs.to_epsg() != 4326:
                raise ValueError(f'Expected EPSG:4326 in {path}')
            row, col = raster.index(float(point['longitude']), float(point['latitude']))
            if not (0 <= row < raster.height and 0 <= col < raster.width):
                raise ValueError(f'Point outside {path}')
            value = raster.read(1, window=((row, row + 1), (col, col + 1)), masked=True)[0, 0]
            if getattr(value, 'mask', False):
                raise ValueError(f'Missing classification in {path}')
            print(f"{point['region']},{point['label']},{point['longitude']},{point['latitude']},{int(value)}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 inspect_candidates.py /path/to/downloads')
    main(Path(sys.argv[1]))
