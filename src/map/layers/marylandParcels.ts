import type { Map } from 'maplibre-gl';
import { registerLayer } from '../layerRegistry';
import { ParcelLoader } from '../parcels';
import { text } from './arcgis';

const id = 'maryland-parcels', fill = `${id}-fill`, line = `${id}-line`;
const service = 'https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query';
const attribution = '<a href="https://www.arcgis.com/sharing/rest/content/items/b33e5f03d50844b8819a4046ecfe0d97/info/metadata/metadata.xml?format=default&amp;output=html">State of Maryland: MD iMAP, MDP, SDAT</a>';
const loaders = new WeakMap<Map, ParcelLoader>();
registerLayer({
  id, name: 'Parcels (MD)', category: 'land', minzoom: 13, defaultOpacity: 0.8,
  swatch: '#b0306a', attribution, layerIds: [fill, line],
  cacheRoute: /^https:\/\/mdgeodata\.md\.gov\/imap\/rest\/services\/PlanningCadastre\/MD_ParcelBoundaries\/MapServer\/0\/query\?/,
  install(map, ctx) {
    if (map.getSource(id)) return;
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
    map.addLayer({ id: fill, type: 'fill', source: id, minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
    map.addLayer({ id: line, type: 'line', source: id, minzoom: 13, paint: { 'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a', 'line-width': 1.5 } }, ctx.beforeId);
    if (!loaders.has(map)) loaders.set(map, new ParcelLoader(map, id, service, 'OBJECTID,ACCTID,ADDRESS,ACRES,POLYACRES', [-79.5, 37.85, -75.0, 39.75]));
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
    for (const [label, value] of [['Parcel', p.ACCTID], ['Address', p.ADDRESS], ['Acres', p.ACRES ?? p.POLYACRES]] as const) {
      if (text(value)) rows.push([label, text(value)]);
    }
    return { title: 'Maryland parcel', rows };
  },
});
