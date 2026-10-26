"""Export wider 2021 NAIP reference imagery for visually selecting candidate openings.

Record estimated and actual Earth Engine use before and after submitting exports.
These exploratory areas must not be reused as independent validation holdouts.
"""
import ee


ee.Initialize(project='free-hunting-map')
regions = {
    'mn': [-93.525, 47.175, -93.475, 47.225],
    'va': [-79.525, 37.975, -79.475, 38.025],
    'me': [-69.525, 45.275, -69.475, 45.325],
}
for name, bounds in regions.items():
    region = ee.Geometry.Rectangle(bounds, None, False)
    images = (ee.ImageCollection('USDA/NAIP/DOQQ').filterBounds(region)
              .filterDate('2021-01-01', '2022-01-01').select(['R', 'G', 'B']))
    task = ee.batch.Export.image.toDrive(
        image=images.mosaic().toByte(), description=f'fhm-openings-aerial-context-{name}-2021',
        folder='FreeHuntingMap-openings-pilot', fileNamePrefix=f'context-naip-{name}',
        region=region, scale=1, crs='EPSG:4326', maxPixels=100000000, fileFormat='GeoTIFF',
    )
    task.start()
    print(name, task.id, flush=True)
