import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'montana-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1/query';
const attribution = '<a href="https://msl.mt.gov/geoinfo/msdi/cadastral/">Montana State Library and Department of Revenue</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (MT)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/gisservice\.mt\.gov\/arcgis\/rest\/services\/msdi_cadastral_map_v1\/MapServer\/1\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,PARCELID,OwnerName,AddressLine1,CityStateZip,GISAcres', [-116.1, 44.3, -103.9, 49.1]));
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
    for (const [label, value] of [['Parcel', p.PARCELID], ['Owner', p.OwnerName], ['Address', p.AddressLine1], ['City', p.CityStateZip], ['Acres', p.GISAcres]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Montana parcel', rows };
  },
});
