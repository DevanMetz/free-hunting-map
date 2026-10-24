import { registerLayer } from '../layerRegistry';
import { TRAILS_ATTR } from '../sources';
import { TRAIL_HIT_LAYERS, TRAILS_SOURCE, trailAt, trailDetails, trailLayers, trailsSource } from '../trails';

registerLayer({
  id: 'public-trails', category: 'trails', name: 'Public trails', swatch: '#e47b13',
  defaultOpacity: 1, minzoom: 8, attribution: TRAILS_ATTR,
  legend: [
    { color: '#5c3a1c', label: 'Foot' }, { color: '#8b3baa', label: 'Horse' },
    { color: '#087c64', label: 'Bike' }, { color: '#d1202f', label: 'OHV' },
    { color: '#147da5', label: 'Snowmobile' }, { color: '#77766d', label: 'Road' },
    { color: '#e47b13', label: 'MVUM motor route' },
  ],
  layerIds: TRAIL_HIT_LAYERS.flatMap(id => [`${id}-casing`, id]),
  install(map, ctx) {
    if (!map.getSource(TRAILS_SOURCE)) map.addSource(TRAILS_SOURCE, trailsSource());
    for (const layer of trailLayers(true, ctx.basemap)) if (!map.getLayer(layer.id)) map.addLayer(layer, ctx.beforeId);
  },
  setVisible(map, on) {
    for (const id of this.layerIds!) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  },
  setOpacity(map, opacity) {
    for (const id of this.layerIds!) if (map.getLayer(id)) {
      const casing = id.endsWith('-casing');
      map.setPaintProperty(id, 'line-opacity', opacity * (casing ? id.startsWith('public-trails-mvum') ? 0.95 : 0.85 : 1));
    }
  },
  identifyPresentation: 'sheet',
  async identify(_lng, _lat, _signal, map, point) {
    const properties = trailAt(map, Array.isArray(point) ? { x: point[0], y: point[1] } : point);
    return properties ? trailDetails(properties) : null;
  },
});
