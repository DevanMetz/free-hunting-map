import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'massachusetts-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query';
const attribution = '<a href="https://www.mass.gov/info-details/massgis-data-property-tax-parcels">MassGIS and Massachusetts municipalities</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (MA)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services1\.arcgis\.com\/hGdibHYSPO59RG1h\/ArcGIS\/rest\/services\/Massachusetts_Property_Tax_Parcels\/FeatureServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,LOC_ID,PROP_ID,OWNER1,SITE_ADDR,CITY,LOT_SIZE,LOT_UNITS,FY', [-73.6, 41.2, -69.8, 42.9]));
    loaders.get(map)?.refresh();
  },
  setVisible(map, on) {
    for (const layer of [fill, line]) if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
    loaders.get(map)?.setEnabled(on);
  },
  setOpacity(map, opacity) { map.setPaintProperty(line, 'line-opacity', opacity); },
  async identify(_lng, _lat, _signal, map, point) {
    const p = map.getLayer(fill) ? map.queryRenderedFeatures(point, { layers: [fill] })[0]?.properties : undefined;
    if (!p) return null;
    const rows: [string, string][] = [];
    for (const [label, value] of [['Owner', p.OWNER1], ['Parcel', p.PROP_ID], ['Map ID', p.LOC_ID], ['Address', p.SITE_ADDR], ['Town', p.CITY], ['Lot size', p.LOT_SIZE], ['Units', p.LOT_UNITS], ['Fiscal year', p.FY]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Massachusetts parcel', rows };
  },
});
