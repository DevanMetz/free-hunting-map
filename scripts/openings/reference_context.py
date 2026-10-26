"""Export wider WorldCover context around the 2021 aerial reference seeds.

Requires Earth Engine authentication. Record estimated and actual usage in the
agent ledger before and after submitting the three exports.
"""
import ee


ee.Initialize(project='free-hunting-map')
regions = {
    'mn': [-93.525, 47.175, -93.475, 47.225],
    'va': [-79.525, 37.975, -79.475, 38.025],
    'me': [-69.525, 45.275, -69.475, 45.325],
}
worldcover = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map')
for name, bounds in regions.items():
    task = ee.batch.Export.image.toDrive(
        image=worldcover.toByte(), description=f'fhm-openings-context-{name}-2021',
        folder='FreeHuntingMap-openings-pilot', fileNamePrefix=f'context-worldcover-{name}',
        region=ee.Geometry.Rectangle(bounds, None, False), scale=10, crs='EPSG:4326',
        maxPixels=10000000, fileFormat='GeoTIFF',
    )
    task.start()
    print(name, task.id, flush=True)
