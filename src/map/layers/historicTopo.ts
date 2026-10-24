import { registerLayer, type LayerDef } from '../layerRegistry';

const attribution = 'USGS Historical Topographic Map Collection';
const variants = [['early', '1924–1958', 'topo-early'], ['1970s', '1969–1984', 'topo-1970s']].map(([id, label, archive]) => ({
  id: id!, label: label!, tiles: [`/tiles/${archive}/v1/{z}/{x}/{y}.webp`], attribution,
}));
export const historicTopo: LayerDef = {
  id: 'historic-topo', name: 'Historic topos', category: 'terrain', defaultOpacity: 1,
  attribution, variants, defaultVariant: 'early',
  source: { kind: 'raster', tiles: variants[0]!.tiles, tileSize: 256, minzoom: 9, maxzoom: 15, bounds: [-91.0, 44.25, -90.25, 45.25] },
  cacheRoute: /\/tiles\/topo-(?:early|1970s)\/v[1-9]\d*\/\d+\/\d+\/\d+\.webp$/,
  cacheStrategy: 'CacheFirst',
};
registerLayer(historicTopo);
