import { registerLayers, type IdentifyResult } from '../layerRegistry';
import { attributeResult, mapImage, polygonSymbol, queryPoint, text, type Attributes } from './arcgis';

const PADUS = 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer';
const PLSS = 'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer';
const access = [
  { code: 'OA', label: 'Open', rgb: [42, 150, 92], color: '#2a965c' },
  { code: 'RA', label: 'Restricted', rgb: [228, 168, 45], color: '#e4a82d' },
  { code: 'XA', label: 'Closed', rgb: [202, 72, 84], color: '#ca4854' },
  { code: 'UK', label: 'Unknown', rgb: [130, 137, 146], color: '#828992' },
];
export function accessContent(p: Attributes): IdentifyResult | null {
  if (!text(p.Unit_Nm) && !text(p.Pub_Access)) return null;
  return { title: text(p.Unit_Nm) || 'Public access', rows: [
    ['Access', access.find(a => a.code === p.Pub_Access)?.label ?? 'Unknown'],
    ...text(p.Loc_Mang) ? [['Manager', text(p.Loc_Mang)] as [string, string]] : [],
  ] };
}
export function townshipContent(p: Attributes): IdentifyResult | null {
  return attributeResult('PLSS township', p, [['TWNSHPLAB', 'Township / range'], ['PRINMER', 'Meridian']]);
}
export function sectionContent(p: Attributes): IdentifyResult | null {
  const id = text(p.PLSSID);
  const match = /^[A-Z]{2}\d{2}(\d{3})0([NS])(\d{3})0([EW])\d$/.exec(id);
  const township = match ? `${Number(match[1])}${match[2]} ${Number(match[3])}${match[4]}` : '';
  return attributeResult('PLSS section', { ...p, township, FRSTDIVTXT: p.FRSTDIVTXT === 'Section' ? '' : p.FRSTDIVTXT },
    [['FRSTDIVNO', 'Section'], township ? ['township', 'Township / range'] : ['PLSSID', 'Township ID'], ['FRSTDIVTXT', 'Division']]);
}
registerLayers([
  {
    id: 'padus-access', category: 'land', name: 'Public access', defaultOpacity: 0.85, minzoom: 5, maxzoom: 20,
    attribution: '<a href="https://doi.org/10.5066/P96WBCHS">USGS PAD-US 4.1</a> · Public domain',
    legend: access.map(({ label, color }) => ({ label, color })),
    cacheRoute: /^https:\/\/edits\.nationalmap\.gov\/arcgis\/rest\/services\/PAD-US\/PAD_US_4_1\/MapServer\/export\?/,
    source: { kind: 'raster', tileSize: 512, minzoom: 5, maxzoom: 17, tiles: [mapImage(PADUS, { dynamicLayers: JSON.stringify([
      { id: 0, source: { type: 'mapLayer', mapLayerId: 0 }, drawingInfo: { renderer: {
        type: 'uniqueValue', field1: 'Pub_Access', defaultSymbol: polygonSymbol([130, 137, 146], 95, 0.8),
        uniqueValueInfos: access.map(a => ({ value: a.code, symbol: polygonSymbol(a.rgb, 95, 0.8) })),
      } } },
    ]) })] },
    async identify(lng, lat, signal) {
      const p = await queryPoint(PADUS, 0, lng, lat, ['Unit_Nm', 'Pub_Access', 'Loc_Mang'], signal);
      return p ? accessContent(p) : null;
    },
  },
  ...([{ layer: 1, id: 'plss-townships', name: 'PLSS townships', color: '#ff0000', minzoom: 10,
    fields: ['TWNSHPLAB', 'PRINMER'], parse: townshipContent },
  { layer: 2, id: 'plss-sections', name: 'PLSS sections', color: '#ff7f7f', minzoom: 12,
    fields: ['FRSTDIVNO', 'PLSSID', 'FRSTDIVTXT'], parse: sectionContent }] as const).map(c => ({
    id: c.id, category: 'land' as const, name: c.name, swatch: c.color, defaultOpacity: 0.8, minzoom: c.minzoom, maxzoom: 20,
    attribution: '<a href="https://www.blm.gov/services/geospatial/GISData">BLM PLSS CadNSDI</a> · Public domain',
    legend: [{ color: c.color, label: c.layer === 1 ? 'Township' : 'Section' }],
    cacheRoute: /^https:\/\/gis\.blm\.gov\/arcgis\/rest\/services\/Cadastral\/BLM_Natl_PLSS_CadNSDI\/MapServer\/export\?/,
    source: { kind: 'raster' as const, tileSize: 512, minzoom: c.minzoom, maxzoom: 17, tiles: [mapImage(PLSS, { layers: `show:${c.layer}` })] },
    async identify(lng: number, lat: number, signal: AbortSignal) {
      const p = await queryPoint(PLSS, c.layer, lng, lat, [...c.fields], signal);
      return p ? c.parse(p) : null;
    },
  })),
]);
