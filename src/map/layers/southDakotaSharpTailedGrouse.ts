import { registerLayer } from '../layerRegistry';
import { attributeResult, mapImage, queryPoint } from './arcgis';

const service = 'https://ert.gfp.sd.gov/arcgis/rest/services/SD_Public/STGR/MapServer';
const plan = 'https://gfp.sd.gov/userdocs/docs/prairiegrousemanagementplan.pdf';

registerLayer({
  id: 'south-dakota-sharp-tailed-grouse-habitat', name: 'Sharp-tailed grouse habitat (SD)', category: 'vegetation',
  defaultOpacity: 0.65, minzoom: 7, maxzoom: 20, swatch: '#e60000',
  attribution: `<a href="${plan}">South Dakota Game, Fish and Parks</a>`,
  legend: [
    { color: '#e60000', label: 'Tier 1' },
    { color: '#ffaa00', label: 'Tier 2' },
    { color: '#ffff00', label: 'Tier 3' },
  ],
  cacheRoute: /^https:\/\/ert\.gfp\.sd\.gov\/arcgis\/rest\/services\/SD_Public\/GPCH\/MapServer\/export\?/,
  cacheStrategy: 'NetworkFirst',
  source: { kind: 'raster', tileSize: 512, minzoom: 7, maxzoom: 17, tiles: [mapImage(service, {})] },
  async identify(lng, lat, signal) {
    const attributes = await queryPoint(service, 0, lng, lat, ['Categories'], signal);
    return attributes ? attributeResult('Sharp-tailed grouse habitat', attributes, [['Categories', 'Priority']]) : null;
  },
});
