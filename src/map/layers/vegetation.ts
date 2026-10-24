import { registerLayers, type IdentifyResult, type LayerDef } from '../layerRegistry';
import { IIPP, IIPP_CACHE, LANDFIRE_CACHE, fetchJson, pixelValue, rasterIdentify, rasterTiles, record } from './raster';

// Verified 2026-10-24: MRLC's Annual NLCD WMS serves 2025; IIPP currently ends at 2024.
const NLCD = 'https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms';
const NLCD_LAYER = 'Land-Cover-Native_conus_year_data';
const nlcdParams = { service: 'WMS', version: '1.1.1', layers: NLCD_LAYER, styles: '',
  srs: 'EPSG:3857', width: '256', height: '256', format: 'image/png', transparent: 'true', time: '2025-01-01' };
const USGS = '<a href="https://www.mrlc.gov/">USGS Annual NLCD 2025</a>';
const USFS = '<a href="https://data.fs.usda.gov/geodata/">USDA Forest Service</a>';
const LANDFIRE = '<a href="https://www.landfire.gov/">USGS / USFS LANDFIRE 2024</a>';
const forest = `${IIPP}Vegetation/USFS_FIA_BIGMAP_CONUS_ForestTypeGroup_2018/ImageServer`;
const canopy = `${IIPP}Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer`;
const ownership = `${IIPP}Lands_Realty/USFS_EDW_ForestOwnership_CONUS/ImageServer`;
const loss = `${IIPP}Vegetation/USFS_EDW_LCMS_MostRecentYearFastLoss_CONUS/ImageServer`;
const evt = 'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVT_CONUS/ImageServer';
const evh = 'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVH_CONUS/ImageServer';
const canopyOptions = { time: '1735689600000', noData: '0,254,255' };
const landfireOptions = { noData: '-9999' };

const nlcdClasses: Record<number, string> = {
  11: 'Open water', 12: 'Perennial ice/snow', 21: 'Developed, open space', 22: 'Developed, low intensity',
  23: 'Developed, medium intensity', 24: 'Developed, high intensity', 31: 'Barren land', 41: 'Deciduous forest',
  42: 'Evergreen forest', 43: 'Mixed forest', 52: 'Shrub/scrub', 71: 'Grassland/herbaceous',
  81: 'Pasture/hay', 82: 'Cultivated crops', 90: 'Woody wetlands', 95: 'Emergent herbaceous wetlands',
};
export function nlcdIdentifyResult(data: unknown): IdentifyResult | null {
  const features = record(data).features;
  if (!Array.isArray(features)) return null;
  const value = pixelValue(record(record(features[0]).properties).PALETTE_INDEX);
  const name = value === null ? undefined : nlcdClasses[value];
  return name ? { title: 'Land cover', rows: [['Cover', name], ['Year', '2025']] } : null;
}

const raster = (id: string, name: string, service: string, options: Record<string, string>,
  rasterFunction: string, nameField: string, legend: LayerDef['legend'], attribution = USFS, cacheRoute = IIPP_CACHE): LayerDef => ({
  id, name, category: 'vegetation', defaultOpacity: 0.65, minzoom: 8, maxzoom: 18, attribution, cacheRoute, legend,
  source: { kind: 'raster', tiles: [rasterTiles(service, options)], minzoom: 8, maxzoom: 16 },
  identify: rasterIdentify(service, name, id === 'forest-loss' ? 'Loss year' : id === 'vegetation-height' ? 'Height' : id === 'forest-ownership' ? 'Owner' : 'Type', options, { rasterFunction, nameField }),
});

registerLayers([
  { id: 'land-cover', name: 'Land cover (2025)', category: 'vegetation', defaultOpacity: 0.65, minzoom: 8, maxzoom: 18,
    attribution: USGS, cacheRoute: /^https:\/\/dmsdata\.cr\.usgs\.gov\/geoserver\/mrlc_Land-Cover-Native_conus_year_data\/wms\?.*request=GetMap(?:&|$)/,
    source: { kind: 'raster', tiles: [`${NLCD}?${new URLSearchParams({ ...nlcdParams, request: 'GetMap' })}&bbox={bbox-epsg-3857}`], minzoom: 8, maxzoom: 16 },
    legend: [
      { color: '#68ab5f', label: 'Deciduous forest' }, { color: '#1c5f2c', label: 'Evergreen forest' },
      { color: '#b5c58f', label: 'Mixed forest' }, { color: '#ccb879', label: 'Shrub/scrub' },
      { color: '#dfdfc2', label: 'Grassland' }, { color: '#dcd939', label: 'Pasture/hay' },
      { color: '#ab6c28', label: 'Crops' }, { color: '#b8d9eb', label: 'Woody wetlands' },
      { color: '#6c9fb8', label: 'Emergent wetlands' }, { color: '#466b9f', label: 'Water' },
      { color: '#dec5c5', label: 'Developed, open' }, { color: '#d99282', label: 'Developed, low' },
      { color: '#eb0000', label: 'Developed, medium' }, { color: '#ab0000', label: 'Developed, high' },
    ],
    async identify(lng, lat, signal) {
      // WMS 1.1.1 uses longitude/latitude axis order. The center pixel is the tapped coordinate.
      const delta = 0.0003;
      return nlcdIdentifyResult(await fetchJson(`${NLCD}?${new URLSearchParams({ ...nlcdParams,
        request: 'GetFeatureInfo', query_layers: NLCD_LAYER, info_format: 'application/json',
        srs: 'EPSG:4326', width: '3', height: '3', x: '1', y: '1',
        bbox: `${lng - delta},${lat - delta},${lng + delta},${lat + delta}` })}`, signal));
    },
  },
  raster('vegetation-type', 'Vegetation type (2024)', evt, landfireOptions, 'LF2024_EVT_CONUS', 'EVT_NAME', [
    { color: '#aef5e0', label: 'Northern oak/pine' }, { color: '#c0ff8a', label: 'Aspen/birch' },
    { color: '#abff8a', label: 'Northern hardwoods' }, { color: '#55bbc2', label: 'Oak woodland' },
    { color: '#005c00', label: 'Hemlock/hardwood' }, { color: '#3289a8', label: 'Swamp forest' },
    { color: '#baa377', label: 'Bog' }, { color: '#ff5c26', label: 'Marsh/fen' },
    { color: '#ff8940', label: 'Tallgrass prairie' }, { color: '#faff77', label: 'Row crops' },
  ], LANDFIRE, LANDFIRE_CACHE),
  raster('vegetation-height', 'Vegetation height (2024)', evh, landfireOptions, 'LF2024_EVH_CONUS', 'CLASSNAMES', [
    { color: '#ccff99', label: 'Tree 1 m' }, { color: '#9bdb6e', label: 'Tree 10 m' },
    { color: '#6bb547', label: 'Tree 20 m' }, { color: '#408f28', label: 'Tree 30 m' },
    { color: '#cf9b6d', label: 'Shrub 0.5 m' }, { color: '#c77e5a', label: 'Shrub 1 m' },
    { color: '#9e0020', label: 'Shrub ≥3 m' }, { color: '#ffcc66', label: 'Herb 0.1 m' },
    { color: '#ff8533', label: 'Herb 0.5 m' }, { color: '#ff3300', label: 'Herb ≥1 m' },
  ], LANDFIRE, LANDFIRE_CACHE),
  raster('forest-type', 'Forest type (2018)', forest, { noData: '0' }, 'BIGMAP Forest Type Groups', 'Name', [
    { color: '#c4d6ec', label: 'White/red/jack pine' }, { color: '#a1b0d0', label: 'Spruce/fir' },
    { color: '#fafa7a', label: 'Oak/hickory' }, { color: '#edea00', label: 'Maple/beech/birch' },
    { color: '#e2cf00', label: 'Aspen/birch' }, { color: '#f3f322', label: 'Elm/ash/cottonwood' },
    { color: '#fdfda7', label: 'Oak/pine' }, { color: '#2e3e70', label: 'Douglas-fir' },
    { color: '#4f6a86', label: 'Ponderosa pine' }, { color: '#b2eeca', label: 'Lodgepole pine' },
    { color: '#3c9542', label: 'Mixed conifer' }, { color: '#e1e1e1', label: 'Nonstocked' },
  ]),
  { id: 'tree-canopy', name: 'Tree canopy (2025)', category: 'vegetation', defaultOpacity: 0.65, minzoom: 8, maxzoom: 18,
    attribution: `${USFS} NLCD TCC 2025`, cacheRoute: IIPP_CACHE,
    source: { kind: 'raster', tiles: [rasterTiles(canopy, canopyOptions)], minzoom: 8, maxzoom: 16 },
    legend: [{ color: '#fafdf9', label: '1%' }, { color: '#8dce85', label: '50%' }, { color: '#1b9d0c', label: '100%' }],
    identify: rasterIdentify(canopy, 'Tree canopy', 'Cover', canopyOptions, value => value >= 0 && value <= 100 ? `${value}%` : null, '2025'),
  },
  raster('forest-ownership', 'Forest ownership', ownership, { noData: '0' }, 'CONUS', 'Ownership', [
    { color: '#38a800', label: 'Family' }, { color: '#e64c00', label: 'Corporate' },
    { color: '#e60000', label: 'TIMO/REIT' }, { color: '#e6e600', label: 'Other private' },
    { color: '#267300', label: 'Federal' }, { color: '#005ce6', label: 'State' },
    { color: '#8400a8', label: 'Local' }, { color: '#df73ff', label: 'Tribal' },
  ]),
  raster('forest-loss', 'Fast vegetation loss (1985–2024)', loss, { noData: '55' }, 'Summary_Loss_v2', 'Classname', [
    { color: '#ffffe5', label: '1985' }, { color: '#feeba3', label: '1995' },
    { color: '#febd49', label: '2005' }, { color: '#f17b1a', label: '2015' }, { color: '#cc4c02', label: '2024' },
  ], `${USFS} LCMS`),
]);
