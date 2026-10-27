import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'tennessee-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0/query';
const attribution = '<a href="https://www.arcgis.com/home/item.html?id=e356f1a241844d6f9025f2fa4e977df3">Tennessee Comptroller of the Treasury</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (TN)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services1\.arcgis\.com\/YuVBSS7Y1of2Qud1\/arcgis\/rest\/services\/Tennessee_Property_Boundaries_Public_Use\/FeatureServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,PARCELID,ADDRESS,DEEDAC,OWNER,OWNER2,COUNTY_NAME', [-90.4, 34.9, -81.6, 36.8]));
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
    for (const [label, value] of [['Parcel', p.PARCELID], ['Owner', p.OWNER], ['Owner', p.OWNER2], ['Address', p.ADDRESS], ['Acres', p.DEEDAC], ['County', p.COUNTY_NAME]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Tennessee parcel', rows };
  },
});
