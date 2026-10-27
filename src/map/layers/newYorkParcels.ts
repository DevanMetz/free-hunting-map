import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'new-york-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query';
const attribution = '<a href="https://www.arcgis.com/home/item.html?id=8af5cef967f8474a9f262684b8908737">NYS Geospatial Services and contributing counties</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (NY)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services6\.arcgis\.com\/EbVsqZ18sv1kVJ3k\/arcgis\/rest\/services\/NYS_Tax_Parcels_Public\/FeatureServer\/1\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,COUNTY_NAME,MUNI_NAME,PARCEL_ADDR,PRINT_KEY,ACRES,PRIMARY_OWNER,ADD_OWNER,ROLL_YR', [-79.8, 40.4, -71.8, 45.1], 'OBJECTID', 1000));
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
    for (const [label, value] of [['Parcel', p.PRINT_KEY], ['Address', p.PARCEL_ADDR], ['Municipality', p.MUNI_NAME], ['County', p.COUNTY_NAME], ['Owner', p.PRIMARY_OWNER], ['Owner 2', p.ADD_OWNER], ['Acres', p.ACRES], ['Assessment year', p.ROLL_YR]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'New York parcel', rows };
  },
});
