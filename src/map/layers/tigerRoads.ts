import { registerLayer } from '../layerRegistry';
import { roadLineDef, roadRows, roadText as text } from '../roadLines';

registerLayer(roadLineDef({
  id: 'census-4wd', name: 'Census 4WD roads', archive: 'tiger-trails', version: 'v2', sourceLayer: 'tiger',
  attribution: 'U.S. Census Bureau TIGER/Line',
  classes: [
    { key: '4wd', label: '4WD trail', color: '#b02c87', dash: [3, 2], filter: ['==', ['get', 'c'], 'S1500'] },
    { key: 'private', label: 'Private/logging road', color: '#7650b5', dash: [3, 2], filter: ['==', ['get', 'c'], 'S1740'] },
  ],
  details: p => ({ title: text(p.n) || 'Census 4WD road', rows: roadRows([
    ['Class', text(p.c)], ['Name', text(p.n)], ['ID', text(p.id)],
  ]) }),
}));
