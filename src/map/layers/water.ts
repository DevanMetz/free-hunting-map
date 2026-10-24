import { layerRegistry, registerLayers, type IdentifyResult, type LayerDef } from '../layerRegistry';
import { attributeResult, mapImage, queryPoint, text, type Attributes } from './arcgis';

const NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer';
const WBD = 'https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer';
const RIPARIAN = 'https://imagery.geoplatform.gov/iipp/rest/services/Ecosystems/USFS_EDW_Riparian_Areas/ImageServer';
const nhdAttribution = '<a href="https://www.usgs.gov/national-hydrography">USGS NHD</a> · Public domain';
const nhdRoute = /^https:\/\/hydro\.nationalmap\.gov\/arcgis\/rest\/services\/nhd\/MapServer\/export\?/;
const wbdRoute = /^https:\/\/hydro\.nationalmap\.gov\/arcgis\/rest\/services\/wbd\/MapServer\/export\?/;
const types: Record<string, string> = { '458': 'Spring / seep', '460': 'Stream / river', '390': 'Lake / pond', '436': 'Reservoir', '466': 'Swamp / marsh', '336': 'Canal / ditch', '558': 'Artificial path' };
export function waterContent(p: Attributes): IdentifyResult | null {
  const name = text(p.gnis_name ?? p.GNIS_NAME), code = text(p.ftype ?? p.FTYPE);
  if (!name && !code) return null;
  return { title: name || types[code] || 'Water', rows: [['Type', types[code] || code]] };
}
export function watershedContent(p: Attributes, digits: 10 | 12): IdentifyResult | null {
  return attributeResult(digits === 10 ? 'Watershed' : 'Subwatershed', p, [['name', 'Name'], [`huc${digits}`, `HUC ${digits}`]]);
}
export function riparianContent(value: unknown): IdentifyResult | null {
  return text(value) === '1' ? { title: 'Riparian area', rows: [['Model', 'USFS potential riparian area']] } : null;
}
const nhdIdentify: NonNullable<LayerDef['identify']> = async (lng, lat, signal, map) => {
  const distance = Math.max(5, Math.min(250, 8 * 78271.51696 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom()));
  const [lake, stream] = await Promise.all([
    queryPoint(NHD, 12, lng, lat, ['gnis_name', 'ftype'], signal),
    queryPoint(NHD, 6, lng, lat, ['gnis_name', 'ftype'], signal, '1=1', distance),
  ]);
  return lake ? waterContent(lake) : stream ? waterContent(stream) : null;
};
// Builtins register after imported modules execute. Attach to the existing imagery entry once it appears.
function attachNhdIdentify(): boolean {
  const nhd = layerRegistry.get('water-nhd');
  if (!nhd) return false;
  nhd.identify = nhdIdentify;
  return true;
}
if (!attachNhdIdentify()) {
  const unsubscribe = layerRegistry.subscribe(() => { if (attachNhdIdentify()) unsubscribe(); });
}
registerLayers([
  {
    id: 'water-springs', category: 'water', name: 'Springs & seeps', swatch: '#73b2ff', minzoom: 12, maxzoom: 20, defaultOpacity: 1,
    attribution: nhdAttribution, cacheRoute: nhdRoute, legend: [{ color: '#73b2ff', label: 'Spring / seep' }],
    source: { kind: 'raster', minzoom: 12, maxzoom: 17, tiles: [mapImage(NHD, { layers: 'show:0', layerDefs: JSON.stringify({ 0: 'FTYPE = 458' }) })] },
    async identify(lng, lat, signal, map) {
      const distance = Math.max(5, Math.min(150, 8 * 78271.51696 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom()));
      const p = await queryPoint(NHD, 0, lng, lat, ['GNIS_NAME', 'FTYPE'], signal, 'FTYPE = 458', distance);
      return p ? waterContent(p) : null;
    },
  },
  ...([{ layer: 5, digits: 10, name: 'Watersheds (HUC 10)', color: '#75439c', rgb: [117, 67, 156], minzoom: 9 },
    { layer: 6, digits: 12, name: 'Subwatersheds (HUC 12)', color: '#19a3b3', rgb: [25, 163, 179], minzoom: 11 }] as const).map(c => ({
    id: `water-huc${c.digits}`, category: 'water' as const, name: c.name, swatch: c.color, minzoom: c.minzoom, maxzoom: 20, defaultOpacity: 0.85,
    attribution: '<a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset">USGS / USDA WBD</a> · Public domain',
    legend: [{ color: c.color, label: `HUC ${c.digits}` }], cacheRoute: wbdRoute,
    source: { kind: 'raster' as const, minzoom: c.minzoom, maxzoom: 17,
      tiles: [mapImage(WBD, { dynamicLayers: JSON.stringify([{ id: 0, source: { type: 'mapLayer', mapLayerId: 0 },
        definitionExpression: `hudigit > 0 AND hudigit <= ${c.digits}`, drawingInfo: { scaleSymbols: false, renderer: { type: 'simple',
          symbol: { type: 'esriSLS', style: 'esriSLSSolid', color: [...c.rgb, 255], width: 1.2 } } } }]) })] },
    async identify(lng: number, lat: number, signal: AbortSignal) {
      const p = await queryPoint(WBD, c.layer, lng, lat, ['name', `huc${c.digits}`], signal);
      return p ? watershedContent(p, c.digits) : null;
    },
  })),
  {
    id: 'water-riparian', category: 'water', name: 'Riparian areas', swatch: '#309c7e', minzoom: 10, maxzoom: 20, defaultOpacity: 0.45,
    attribution: '<a href="https://www.fs.usda.gov/rds/archive/catalog/RDS-2019-0030">USFS potential riparian areas</a> · Public domain',
    cacheRoute: /^https:\/\/imagery\.geoplatform\.gov\/iipp\/rest\/services\/Ecosystems\/USFS_EDW_Riparian_Areas\/ImageServer\/exportImage\?/,
    legend: [{ color: '#309c7e', label: 'Potential riparian area' }],
    source: { kind: 'raster', minzoom: 10, maxzoom: 17, tiles: [`${RIPARIAN}/exportImage?bbox={bbox-epsg-3857}&${new URLSearchParams({
      bboxSR: '3857', imageSR: '3857', size: '256,256', format: 'png32', f: 'image', noData: '0', noDataInterpretation: 'esriNoDataMatchAny',
      interpolation: 'RSP_NearestNeighbor', renderingRule: JSON.stringify({ rasterFunction: 'Colormap', rasterFunctionArguments: {
        Raster: '$$', Colormap: [[0, 0, 0, 0], [1, 48, 156, 126]],
      }, variableName: 'Raster' }),
    })}`] },
    async identify(lng, lat, signal) {
      const params = new URLSearchParams({ f: 'json', geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint', returnGeometry: 'false', returnCatalogItems: 'false' });
      const response = await fetch(`${RIPARIAN}/identify?${params}`, { signal });
      if (!response.ok) return null;
      const data = await response.json() as { value?: unknown };
      return riparianContent(data.value);
    },
  },
]);
