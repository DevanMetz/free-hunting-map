import ee
ee.Initialize(project='free-hunting-map')
region=ee.Geometry.Rectangle([-90.75,44.65,-90.55,44.85],None,False)
image=ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select(['occurrence','seasonality']).unmask(0).toByte()
task=ee.batch.Export.image.toDrive(image=image,description='fhm-small-water-jrc-pilot-20261026',folder='FreeHuntingMap-small-water-pilot',fileNamePrefix='jrc-wi-pilot',region=region,scale=30,crs='EPSG:4326',maxPixels=10000000,fileFormat='GeoTIFF')
task.start()
print(task.id)
