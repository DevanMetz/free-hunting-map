import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'new-jersey-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query';
const attribution = '<a href="https://nj.gov/njgin/edata/parcels/">New Jersey Office of GIS</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (NJ)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/services2\.arcgis\.com\/XVOqAjTOJ5P6ngMu\/arcgis\/rest\/services\/Parcels_Composite_NJ_WM\/FeatureServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,PCLBLOCK,PCLLOT,PCLQCODE,MUN_NAME,COUNTY,PROP_LOC,CALC_ACRE', [-75.6, 38.8, -73.8, 41.4]));
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
    for (const [label, value] of [['Block', p.PCLBLOCK], ['Lot', p.PCLLOT], ['Qualifier', p.PCLQCODE], ['Address', p.PROP_LOC], ['Municipality', p.MUN_NAME], ['County', p.COUNTY], ['Acres', p.CALC_ACRE]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'New Jersey parcel', rows };
  },
});
