import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'connecticut-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/ArcGIS/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0/query';
const attribution = '<a href="https://portal.ct.gov/datapolicy/gis-office/parcel-and-cama">Connecticut GIS Office and municipalities</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (CT)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services3\.arcgis\.com\/3FL1kr7L4LvwA2Kb\/ArcGIS\/rest\/services\/Connecticut_CAMA_and_Parcel_Layer\/FeatureServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,Parcel_ID,Owner,Co_Owner,Location,Town_Name,Land_Acres,Parcel_Collection_Year', [-73.8, 40.9, -71.7, 42.1]));
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
    for (const [label, value] of [['Owner', p.Owner], ['Co-owner', p.Co_Owner], ['Parcel', p.Parcel_ID], ['Address', p.Location], ['Town', p.Town_Name], ['Acres', p.Land_Acres], ['Collection year', p.Parcel_Collection_Year]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Connecticut parcel', rows };
  },
});
