import { registerLayer, type LayerDef } from '../layerRegistry';
import { HISTORIC_AERIAL_SERVICE, WISCONSIN_BOUNDS } from '../sources';
import { rasterTiles } from './raster';

const attribution = 'USDA NAIP via Wisconsin DNR';
const variants = [2022, 2020, 2015, 2013, 2008, 2005].map(year => ({
  id: String(year), label: String(year),
  tiles: [rasterTiles(`${HISTORIC_AERIAL_SERVICE}${year}_Leaf_On/ImageServer`,
    { format: 'jpgpng', transparent: 'true', interpolation: 'RSP_BilinearInterpolation' })],
  attribution,
}));
export const historicAerials: LayerDef = {
  id: 'historic-aerials', name: 'Historic aerials', category: 'terrain', defaultOpacity: 1,
  attribution, variants, defaultVariant: '2005',
  source: { kind: 'raster', tiles: variants.find(v => v.id === '2005')!.tiles, tileSize: 256, bounds: WISCONSIN_BOUNDS },
  cacheRoute: /^https:\/\/dnrmaps\.wi\.gov\/arcgis_image\/rest\/services\/DW_Imagery\/EN_Image_Basemap_(?:2022|2020|2015|2013|2008|2005)_Leaf_On\/ImageServer\/exportImage\?/,
  cacheStrategy: 'CacheFirst',
};
registerLayer(historicAerials);
