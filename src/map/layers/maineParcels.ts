import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'maine-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://gis.maine.gov/mapservices/rest/services/dep/MaineDEP_Parcels_NDW_NWI_NHD/MapServer/0/query';
const attribution = '<a href="https://www.maine.gov/geolib/">Maine GeoLibrary and municipalities</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (ME organized towns)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/gis\.maine\.gov\/mapservices\/rest\/services\/dep\/MaineDEP_Parcels_NDW_NWI_NHD\/MapServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,TOWN,COUNTY,MAP_BK_LOT,PROP_LOC,FMUPDAT', [-71.2, 42.9, -66.9, 47.5]));
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
    for (const [label, value] of [['Parcel', p.MAP_BK_LOT], ['Address', p.PROP_LOC], ['Town', p.TOWN], ['County', p.COUNTY], ['Updated', p.FMUPDAT]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Maine parcel', rows };
  },
});
