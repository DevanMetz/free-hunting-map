import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'florida-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query';
const attribution = '<a href="https://www.arcgis.com/home/item.html?id=efa909d6b1c841d298b0a649e7f71cf2">Florida Department of Revenue and county property appraisers</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (FL)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services9\.arcgis\.com\/Gh9awoU677aKree0\/arcgis\/rest\/services\/Florida_Statewide_Cadastral\/FeatureServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,PARCEL_ID,OWN_NAME,PHY_ADDR1,PHY_CITY,ASMNT_YR', [-87.7, 24.3, -79.7, 31.1]));
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
    for (const [label, value] of [['Parcel', p.PARCEL_ID], ['Owner', p.OWN_NAME], ['Address', p.PHY_ADDR1], ['City', p.PHY_CITY], ['Assessment year', p.ASMNT_YR]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Florida parcel', rows };
  },
});
