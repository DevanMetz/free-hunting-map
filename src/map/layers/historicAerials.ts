import { registerLayer, type LayerDef } from '../layerRegistry';
import { HISTORIC_AERIAL_SERVICE, WISCONSIN_BOUNDS } from '../sources';
import { rasterTiles } from './raster';

const attribution = 'USDA NAIP via Wisconsin DNR';
const variants = [2022, 2020, 2015, 2013, 2008, 2005, 1938].map(year => ({
  id: String(year), label: year === 1938 ? '1930s' : String(year),
  tiles: [rasterTiles(`${HISTORIC_AERIAL_SERVICE}${year === 1938 ? '1930s' : year}_Leaf_On/ImageServer`,
    { format: 'jpgpng', transparent: 'true', interpolation: 'RSP_BilinearInterpolation' })],
  attribution: year === 1938 ? 'USDA 1937–41 aerials, UW–Madison SCO / Wisconsin DNR' : attribution,
}));
export const historicAerials: LayerDef = {
  id: 'historic-aerials', name: 'Historic aerials', category: 'terrain', defaultOpacity: 1,
  attribution, variants, defaultVariant: '2005',
  source: { kind: 'raster', tiles: variants.find(v => v.id === '2005')!.tiles, tileSize: 256, bounds: WISCONSIN_BOUNDS },
  cacheRoute: /^https:\/\/dnrmaps\.wi\.gov\/arcgis_image\/rest\/services\/DW_Imagery\/EN_Image_Basemap_(?:2022|2020|2015|2013|2008|2005|1930s)_Leaf_On\/ImageServer\/exportImage\?/,
  cacheStrategy: 'CacheFirst',
};
registerLayer(historicAerials);
