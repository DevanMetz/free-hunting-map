import { registerLayer } from '../layerRegistry';

registerLayer({
  id: 'bedding',
  category: 'terrain',
  name: 'Bedding',
  swatch: '#c47a2c',
  defaultOpacity: 0.75,
  attribution: 'USGS 3DEP',
  layerIds: ['bedding'],
  install(map, ctx) { void import('../../beds/session').then(m => m.attachBedding(map, ctx.beforeId)); },
  setVisible(map, on) { void import('../../beds/session').then(m => m.showBedding(on, map)); },
  setOpacity(_map, opacity) { void import('../../beds/session').then(m => m.fadeBedding(opacity)); },
});
