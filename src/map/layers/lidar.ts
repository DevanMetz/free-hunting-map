import { registerLayers, type LayerDef } from '../layerRegistry';
import { LIDAR_BOUNDS, LIDAR_TILES } from '../sources';

const LIDAR_CACHE = /\/tiles\/lidar-(?:lrm|openness|hillshade|slope|chm)\/v[1-9]\d*\/\d+\/\d+\/\d+\.webp$/;
const names: [string, string][] = [
  ['lidar-lrm', 'Local relief'], ['lidar-openness', 'Openness'], ['lidar-hillshade', 'Lidar hillshade'], ['lidar-slope', 'Lidar slope'],
  ['lidar-chm', 'Canopy height'],
];
export const lidarLayers: LayerDef[] = names.map(([id, name]) => ({
  id, name, category: 'terrain', defaultOpacity: id === 'lidar-chm' ? 0.7 : 0.85,
  attribution: 'USGS 3DEP lidar',
  source: { kind: 'raster', tiles: [LIDAR_TILES[id]!], tileSize: 256, minzoom: 8, maxzoom: id === 'lidar-chm' ? 15 : 16, bounds: LIDAR_BOUNDS },
  cacheRoute: LIDAR_CACHE,
  cacheStrategy: 'CacheFirst',
  legend: id === 'lidar-lrm' ? [
    { color: '#3976af', label: 'Lower' }, { color: '#f5f3e4', label: '0' }, { color: '#d46036', label: 'Raised' },
  ] : id === 'lidar-chm' ? [
    { color: '#f5f3e4', label: '0 m' }, { color: '#e2e8aa', label: '10 m' }, { color: '#96c46e', label: '20 m' },
    { color: '#3c8c46', label: '30 m' }, { color: '#0a3c23', label: '40 m+' },
  ] : undefined,
}));
registerLayers(lidarLayers);
