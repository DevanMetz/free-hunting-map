import { registerLayer } from '../layerRegistry';
import { attributeResult, mapImage, queryPoint } from './arcgis';

const service = 'https://ert.gfp.sd.gov/arcgis/rest/services/SD_Public/SageGrouseCoreAreas/MapServer';
const details = 'https://ert.gfp.sd.gov/arcgis/rest/services/SD_Public/SageGrouseCoreAreas/MapServer/0';

registerLayer({
  id: 'south-dakota-sage-grouse-core', name: 'Sage-grouse core area (SD)', category: 'vegetation',
  defaultOpacity: 0.65, minzoom: 7, maxzoom: 20, swatch: '#d2cffc',
  attribution: `<a href="${details}">South Dakota Game, Fish and Parks</a>`,
  legend: [{ color: '#d2cffc', label: 'Sage-grouse core area' }],
  cacheRoute: /^https:\/\/ert\.gfp\.sd\.gov\/arcgis\/rest\/services\/SD_Public\/SageGrouseCoreAreas\/MapServer\/export\?/,
  cacheStrategy: 'NetworkFirst',
  source: { kind: 'raster', tileSize: 512, minzoom: 7, maxzoom: 17, tiles: [mapImage(service, {})] },
  async identify(lng, lat, signal) {
    const attributes = await queryPoint(service, 0, lng, lat, ['acres'], signal);
    return attributes ? attributeResult('Sage-grouse core area', attributes, [['acres', 'Acres']]) : null;
  },
});
