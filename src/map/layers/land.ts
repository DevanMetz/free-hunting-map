import { registerLayers, type IdentifyResult } from '../layerRegistry';
import { attributeResult, mapImage, queryPoint, text, type Attributes } from './arcgis';

const PLSS = 'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer';
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
