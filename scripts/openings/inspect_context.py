"""Inspect WorldCover context at exploratory NAIP reference points.

Run after reference_context.py exports are downloaded:
  python3 scripts/openings/inspect_context.py /path/to/downloads
Components touching the export boundary have unknown full size. These point
samples are exploratory and cannot measure classification accuracy.
"""
import csv
import sys
from pathlib import Path

import numpy as np
import rasterio
from scipy import ndimage

from inspect_reference import BOUNDS, POINTS


def main(directory: Path) -> None:
    with POINTS.open(newline='') as source:
        points = list(csv.DictReader(source))
    print('region,label,worldcover,forest_fraction_61px,open_component_pixels,boundary')
    for region, bounds in BOUNDS.items():
        path = directory / f'context-worldcover-{region}.tif'
        with rasterio.open(path) as raster:
            if raster.crs is None or raster.crs.to_epsg() != 4326:
                raise ValueError(f'Expected EPSG:4326 in {path}')
            classes = raster.read(1, masked=True)
            if np.ma.getmaskarray(classes).any():
                raise ValueError(f'Missing classification in {path}')
            values = np.asarray(classes)
            forest = ndimage.uniform_filter((values == 10).astype(float), size=61, mode='constant')
            components, count = ndimage.label(np.isin(values, [20, 30, 40, 60]), structure=np.ones((3, 3)))
            sizes = np.bincount(components.ravel(), minlength=count + 1)
            edge = set(np.unique(np.concatenate((components[0], components[-1], components[:, 0], components[:, -1]))))
            west, south, east, north = bounds
            for point in (p for p in points if p['region'] == region):
                lng = west + float(point['x_fraction']) * (east - west)
                lat = north - float(point['y_fraction']) * (north - south)
                row, col = raster.index(lng, lat)
                if not (30 <= row < raster.height - 30 and 30 <= col < raster.width - 30):
                    raise ValueError(f'Point lacks forest neighborhood in {path}')
                component = components[row, col]
                size = int(sizes[component]) if component else 0
                print(f"{region},{point['label']},{values[row, col]},{forest[row, col]:.3f},{size},{bool(component and component in edge)}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 inspect_context.py /path/to/downloads')
    main(Path(sys.argv[1]))
