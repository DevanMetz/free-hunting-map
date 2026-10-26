"""Export small 2021 NAIP and WorldCover reference squares to Google Drive.

Requires earthengine-api authentication and a configured free-hunting-map project.
Check the Earth Engine budget and ledger before running; this submits six tasks.
"""
import ee
ee.Initialize(project='free-hunting-map')
regions={'mn':[-93.505,47.195,-93.495,47.205], 'va':[-79.505,37.995,-79.495,38.005], 'me':[-69.505,45.295,-69.495,45.305]}
for name,bounds in regions.items():
 region=ee.Geometry.Rectangle(bounds,None,False)
 images=ee.ImageCollection('USDA/NAIP/DOQQ').filterBounds(region).filterDate('2021-01-01','2022-01-01').select(['R','G','B'])
 for kind,img,scale in [('naip',images.mosaic(),1),('worldcover',ee.ImageCollection('ESA/WorldCover/v200').first().select('Map'),10)]:
  task=ee.batch.Export.image.toDrive(image=img.toByte(),description='fhm-openings-ref-'+kind+'-'+name+'-2021',folder='FreeHuntingMap-openings-pilot',fileNamePrefix='sample-'+kind+'-'+name,region=region,scale=scale,crs='EPSG:4326',maxPixels=10000000,fileFormat='GeoTIFF')
  task.start()
  print(name,kind,task.id,flush=True)
