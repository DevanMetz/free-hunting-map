import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'north-dakota-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0/query';
const attribution = '<a href="https://www.arcgis.com/home/item.html?id=ac6da1176038457db16e8debe3f1abaf">North Dakota GIS Hub and counties</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (ND)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services1\.arcgis\.com\/GOcSXpzwBHyk2nog\/arcgis\/rest\/services\/NDGISHUB_Parcels\/FeatureServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,GISID,CountyName,CalculatedAcres,Ownership', [-104.1, 45.9, -96.5, 49.1]));
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
    for (const [label, value] of [['Parcel', p.GISID], ['County', p.CountyName], ['Ownership', p.Ownership], ['Acres', p.CalculatedAcres]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'North Dakota parcel', rows };
  },
});
