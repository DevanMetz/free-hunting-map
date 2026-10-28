import { registerLayer } from '../layerRegistry';
import { attributeResult, mapImage, queryPoint } from './arcgis';

const service = 'https://ert.gfp.sd.gov/arcgis/rest/services/SD_Public/UndisturbedLands/MapServer';
const details = `${service}/0`;

registerLayer({
  id: 'south-dakota-undisturbed-lands', name: 'Potentially undisturbed lands (SD)', category: 'vegetation',
  defaultOpacity: 0.65, minzoom: 7, maxzoom: 20, swatch: '#b4d79e',
  attribution: `<a href="${details}">South Dakota Game, Fish and Parks / SDSU</a>`,
  legend: [{ color: '#b4d79e', label: 'Grassland' }, { color: '#5c8944', label: 'Woodland' }],
  cacheRoute: /^https:\/\/ert\.gfp\.sd\.gov\/arcgis\/rest\/services\/SD_Public\/UndisturbedLands\/MapServer\/export\?/,
  cacheStrategy: 'NetworkFirst',
  source: { kind: 'raster', tileSize: 512, minzoom: 7, maxzoom: 17, tiles: [mapImage(service, {})] },
  async identify(lng, lat, signal) {
    const attributes = await queryPoint(service, 0, lng, lat, ['Land_Type'], signal);
    return attributes ? attributeResult('Potentially undisturbed lands', attributes, [['Land_Type', 'Land type']]) : null;
  },
});
