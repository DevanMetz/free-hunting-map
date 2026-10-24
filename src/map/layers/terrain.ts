import { registerLayers, type IdentifyResult } from '../layerRegistry';
import { attributeResult, mapImage, queryPoint, text, type Attributes } from './arcgis';

const SOILS = 'https://SDMDataAccess.sc.egov.usda.gov';
const ECOREGIONS = 'https://geodata.epa.gov/arcgis/rest/services/ORD/USEPA_Ecoregions_Level_III_and_IV/MapServer';
const CONTOURS = 'https://carto.nationalmap.gov/arcgis/rest/services/contours/MapServer';
const ELEVATION = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
export function soilQuery(lng: number, lat: number): string {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new RangeError('Invalid soil coordinate');
  return `SELECT TOP 1 m.muname, a.drclassdcd, (SELECT TOP 1 c.hydricrating FROM component c WHERE c.mukey = m.mukey ORDER BY c.comppct_r DESC, c.cokey) AS hydricrating, m.farmlndcl FROM mapunit m LEFT JOIN muaggatt a ON a.mukey = m.mukey WHERE m.mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng} ${lat})'))`;
}
export function soilContent(data: unknown): IdentifyResult | null {
  if (!data || typeof data !== 'object' || !('Table' in data) || !Array.isArray(data.Table)) return null;
  const row: unknown = data.Table[0];
  if (!Array.isArray(row) || !text(row[0])) return null;
  const labels = ['Drainage', 'Hydric (dominant)', 'Farmland'];
  return { title: text(row[0]), rows: labels.flatMap((label, index): [string, string][] => {
    const value = text(row[index + 1]);
    return value ? [[label, value]] : [];
  }) };
}
export function ecoregionContent(p: Attributes, level: 3 | 4): IdentifyResult | null {
  return attributeResult(`Ecoregion level ${level === 3 ? 'III' : 'IV'}`, p,
    level === 3 ? [['US_L3NAME', 'Region'], ['US_L3CODE', 'Code']] : [['US_L4NAME', 'Region'], ['US_L4CODE', 'Code'], ['US_L3NAME', 'Level III']]);
}
export function contourContent(p: Attributes): IdentifyResult | null {
  const normalized = Object.fromEntries(Object.entries(p).map(([key, value]) => [key.toLowerCase(), value]));
  const value = text(normalized.contourelevation), elevation = Number(value);
  if (!value || !Number.isFinite(elevation)) return null;
  const units = text(normalized.contourunits).toLowerCase();
  const suffix = units === '1' || units === 'feet' ? ' ft' : units === '2' || units === 'meters' ? ' m' : '';
  return { title: 'Contour', rows: [['Elevation', `${elevation.toLocaleString('en-US')}${suffix}`]] };
}
export function elevationContent(value: unknown): IdentifyResult | null {
  const raw = text(value), meters = Number(raw);
  if (!raw || !Number.isFinite(meters) || meters < -500 || meters > 9000) return null;
  return { title: 'Elevation', rows: [['Height', `${Math.round(meters).toLocaleString('en-US')} m / ${Math.round(meters * 3.28084).toLocaleString('en-US')} ft`]] };
}
// Colors copied from the service renderer (2026-10-24); key Upper Midwest classes only.
const legend3 = [
  {
    "label": "Western Corn Belt Plains",
    "color": "#c48a21"
  },
  {
    "label": "Northern Lakes and Forests",
    "color": "#c4ffff"
  },
  {
    "label": "North Central Hardwood Forests",
    "color": "#b3e8d9"
  },
  {
    "label": "Driftless Area",
    "color": "#c2ffcf"
  },
  {
    "label": "Southeastern Wisconsin Till Plains",
    "color": "#ffb005"
  },
  {
    "label": "Central Corn Belt Plains",
    "color": "#e6ba45"
  }
];
const legend4 = [
  {
    "label": "Chequamegon Moraines and Outwash Plain",
    "color": "#c7f0ff"
  },
  {
    "label": "Chippewa Lobe Rocky Ground Moraines",
    "color": "#cfdbff"
  },
  {
    "label": "Perkinstown End Moraines",
    "color": "#91bdff"
  },
  {
    "label": "Northern Wisconsin Highlands Lakes Country",
    "color": "#70a3f2"
  },
  {
    "label": "St. Croix Stagnation Moraines",
    "color": "#f0fff0"
  },
  {
    "label": "Central Wisconsin Undulating Till Plain",
    "color": "#e0fff0"
  },
  {
    "label": "Glacial Lake Wisconsin Sand Plain",
    "color": "#ccffe0"
  },
  {
    "label": "Central Sand Ridges",
    "color": "#b0fff0"
  },
  {
    "label": "Green Bay Till and Lacustrine Plain",
    "color": "#a1ffd1"
  },
  {
    "label": "Blufflands and Coulees",
    "color": "#c2ffd1"
  },
  {
    "label": "Rock River Drift Plain",
    "color": "#fff0cc"
  },
  {
    "label": "Kettle Moraines",
    "color": "#ffe0b0"
  }
];
const elevationBands = [
  { color: '#286caa', label: '<0 m', rgb: [40, 108, 170] },
  { color: '#58a374', label: '0–250 m', rgb: [88, 163, 116] },
  { color: '#acbe6a', label: '250–500 m', rgb: [172, 190, 106] },
  { color: '#dbc585', label: '500–1,000 m', rgb: [219, 197, 133] },
  { color: '#b2875c', label: '1,000–2,000 m', rgb: [178, 135, 92] },
  { color: '#94867d', label: '2,000–3,000 m', rgb: [148, 134, 125] },
  { color: '#ebebeb', label: '3,000+ m', rgb: [235, 235, 235] },
];
registerLayers([
  {
    id: 'soils-ssurgo', category: 'terrain', name: 'Soils (SSURGO)', swatch: '#ff8000', minzoom: 12, maxzoom: 20, defaultOpacity: 0.65,
    attribution: '<a href="https://sdmdataaccess.sc.egov.usda.gov/">USDA NRCS SSURGO</a> · Public domain',
    legend: [{ color: '#ff8000', label: 'Soil map unit' }],
    cacheRoute: /^https:\/\/SDMDataAccess\.sc\.egov\.usda\.gov\/Spatial\/SDM\.wms\?/i,
    source: { kind: 'raster', tileSize: 512, minzoom: 12, maxzoom: 17, tiles: [`${SOILS}/Spatial/SDM.wms?bbox={bbox-epsg-3857}&${new URLSearchParams({
      service: 'WMS', version: '1.1.1', request: 'GetMap', layers: 'mapunitpoly', styles: '', srs: 'EPSG:3857', width: '512', height: '512', format: 'image/png', transparent: 'true',
    })}`] },
    async identify(lng, lat, signal) {
      const response = await fetch(`${SOILS}/Tabular/post.rest`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'JSON', query: soilQuery(lng, lat) }) });
      return response.ok ? soilContent(await response.json()) : null;
    },
  },
  ...([{ id: 'terrain-ecoregions-iii', layer: 11, level: 3, name: 'Ecoregions III', minzoom: 4, maxzoom: 15, legend: legend3 },
    { id: 'terrain-ecoregions-iv', layer: 7, level: 4, name: 'Ecoregions IV', minzoom: 6, maxzoom: 16, legend: legend4 }] as const).map(c => ({
    id: c.id, category: 'terrain' as const, name: c.name, minzoom: c.minzoom, maxzoom: c.maxzoom, defaultOpacity: 0.25,
    attribution: '<a href="https://www.epa.gov/eco-research/ecoregions">US EPA ecoregions (2011)</a> · Public domain',
    legend: c.legend, cacheRoute: /^https:\/\/geodata\.epa\.gov\/arcgis\/rest\/services\/ORD\/USEPA_Ecoregions_Level_III_and_IV\/MapServer\/export\?/,
    source: { kind: 'raster' as const, tileSize: 512, minzoom: c.minzoom, maxzoom: 14, tiles: [mapImage(ECOREGIONS, { layers: `show:${c.layer}` })] },
    async identify(lng: number, lat: number, signal: AbortSignal) {
      const fields = c.level === 3 ? ['US_L3NAME', 'US_L3CODE'] : ['US_L4NAME', 'US_L4CODE', 'US_L3NAME'];
      const p = await queryPoint(ECOREGIONS, c.layer, lng, lat, fields, signal);
      return p ? ecoregionContent(p, c.level) : null;
    },
  })),
  {
    id: 'terrain-contours', category: 'terrain', name: 'Contours', swatch: '#a67442', minzoom: 11, maxzoom: 20, defaultOpacity: 0.9,
    attribution: '<a href="https://www.usgs.gov/the-national-map-data-delivery/gis-data-download">USGS contours</a> · Public domain',
    cacheRoute: /^https:\/\/carto\.nationalmap\.gov\/arcgis\/rest\/services\/contours\/MapServer\/export\?/,
    legend: [{ color: '#a67442', label: 'Contour' }], source: { kind: 'raster', tileSize: 512, minzoom: 11, maxzoom: 17, tiles: [mapImage(CONTOURS, {})] },
    async identify(lng, lat, signal, map) {
      const bounds = map.getBounds(), canvas = map.getCanvas();
      const params = new URLSearchParams({ f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', sr: '4326',
        mapExtent: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        imageDisplay: `${canvas.clientWidth},${canvas.clientHeight},96`, layers: 'visible', tolerance: '8', returnGeometry: 'false' });
      const response = await fetch(`${CONTOURS}/identify?${params}`, { signal });
      if (!response.ok) return null;
      const data = await response.json() as { results?: { attributes?: Attributes }[] };
      for (const hit of data.results ?? []) { const result = contourContent(hit.attributes ?? {}); if (result) return result; }
      return null;
    },
  },
  {
    id: 'terrain-elevation', category: 'terrain', name: 'Elevation tint', minzoom: 9, maxzoom: 20, defaultOpacity: 0.35,
    attribution: '<a href="https://www.usgs.gov/3d-elevation-program">USGS 3DEP</a> · Public domain',
    cacheRoute: /^https:\/\/elevation\.nationalmap\.gov\/arcgis\/rest\/services\/3DEPElevation\/ImageServer\/exportImage\?/,
    legend: elevationBands.map(({ color, label }) => ({ color, label })),
    source: { kind: 'raster', tileSize: 512, minzoom: 9, maxzoom: 17, tiles: [`${ELEVATION}/exportImage?bbox={bbox-epsg-3857}&${new URLSearchParams({
      bboxSR: '3857', imageSR: '3857', size: '512,512', format: 'png32', f: 'image', noData: '-999999', noDataInterpretation: 'esriNoDataMatchAny',
      renderingRule: JSON.stringify({ rasterFunction: 'Colormap', rasterFunctionArguments: {
        Raster: { rasterFunction: 'Remap', rasterFunctionArguments: { Raster: '$$',
          InputRanges: [-500, 0, 0, 250, 250, 500, 500, 1000, 1000, 2000, 2000, 3000, 3000, 9000], OutputValues: [1, 2, 3, 4, 5, 6, 7], AllowUnmatched: false } },
        Colormap: elevationBands.map((band, index) => [index + 1, ...band.rgb]),
      } }),
    })}`] },
    async identify(lng, lat, signal) {
      const params = new URLSearchParams({ f: 'json', geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryPoint', returnGeometry: 'false', returnCatalogItems: 'false', renderingRule: JSON.stringify({ rasterFunction: 'None' }) });
      const response = await fetch(`${ELEVATION}/identify?${params}`, { signal });
      if (!response.ok) return null;
      const data = await response.json() as { value?: unknown };
      return elevationContent(data.value);
    },
  },
]);
