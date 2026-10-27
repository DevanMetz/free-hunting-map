import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'oregon-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_View_WGS84/FeatureServer/2/query';
const attribution = '<a href="https://gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_View_WGS84/FeatureServer/2">Oregon Water Resources Department and participating counties</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (OR)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/gis\.wrd\.state\.or\.us\/server\/rest\/services\/tax\/Tax_Lots_Public_View_WGS84\/FeatureServer\/2\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,county_name,maptaxlot,site_address,taxlot_acre', [-124.7, 41.9, -116.4, 46.4], 'OBJECTID', 2000));
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
    for (const [label, value] of [['Parcel', p.maptaxlot], ['Address', p.site_address], ['County', p.county_name], ['Acres', p.taxlot_acre]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Oregon parcel', rows };
  },
});
