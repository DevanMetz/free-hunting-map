import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'idaho-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7/query';
const attribution = '<a href="https://www.arcgis.com/home/item.html?id=65a3f7c6d4ca404ba6ab677913953b35">Idaho ITS and participating counties</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (ID)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services1\.arcgis\.com\/CNPdEkvnGl65jCX8\/arcgis\/rest\/services\/Public_Idaho_Parcels_\/FeatureServer\/7\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,PARCEL_ID,County,OWNER1,OWNER2,SITE_ADD,ASR_ACRES', [-117.3, 41.9, -111, 49.1], 'OBJECTID', 2000));
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
    for (const [label, value] of [['Parcel', p.PARCEL_ID], ['Address', p.SITE_ADD], ['County', p.County], ['Owner', p.OWNER1], ['Owner 2', p.OWNER2], ['Acres', p.ASR_ACRES]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Idaho parcel', rows };
  },
});
