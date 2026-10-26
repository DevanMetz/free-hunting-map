import ee
ee.Initialize(project='free-hunting-map')
region=ee.FeatureCollection('TIGER/2018/States').filter(ee.Filter.eq('NAME','Wisconsin')).geometry()
image=ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select(['occurrence','seasonality']).unmask(0).toByte().clip(region)
task=ee.batch.Export.image.toDrive(image=image,description='fhm-small-water-jrc-wi-20261026',folder='FreeHuntingMap-small-water-pilot',fileNamePrefix='jrc-wi-state',region=region.bounds(),scale=30,crs='EPSG:4326',maxPixels=1000000000,fileFormat='GeoTIFF')
task.start()
print(task.id)
