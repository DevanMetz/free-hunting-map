/**
 * Every external map endpoint lives here. All were verified to return tiles/images
 * (see README "Data sources"). Do not add endpoints without verifying them.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

/** Bump the version for every new trails data build (R2 prefix trails/vN/) so edge and offline caches never mix builds. */
export const TRAILS_TILES = '/tiles/trails/v2/{z}/{x}/{y}.mvt';
export const TRAILS_ATTR = 'USFS, BLM, NPS, USGS trails (public domain)';

export type BasemapId = 'topo' | 'satellite' | 'streets';

const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

export const USGS_TOPO_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
export const USGS_IMAGERY_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
/** OpenMapTiles-schema vector TileJSON (labels overlay) and its glyph PBFs. */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export const OPENFREEMAP_ATTR =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** PAD-US 4.1 (fee lands) rendered server-side by the USGS ArcGIS MapServer export endpoint. */
export const PADUS_EXPORT =
  'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/export' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';

export const PADUS_QUERY = 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0/query';

export const PADUS_ATTR =
  '<a href="https://doi.org/10.5066/P96WBCHS" target="_blank" rel="noopener">USGS GAP PAD-US 4.1</a>';

/** USGS 3DEP lidar-derived hillshade rendered by the ImageServer. */
export const HILLSHADE_EXPORT =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&renderingRule=' +
  encodeURIComponent('{"rasterFunction":"Hillshade Gray"}') +
  '&f=image';
export const HILLSHADE_ATTR = 'USGS 3DEP';

export const BASEMAP_IDS: BasemapId[] = ['topo', 'satellite', 'streets'];

export const BASEMAP_NAMES: Record<BasemapId, string> = {
  topo: 'Topo',
  satellite: 'Satellite',
  streets: 'Streets',
};

function rasterStyle(tiles: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      basemap: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: 16, attribution },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#1b231d' } },
      { id: 'basemap', type: 'raster', source: 'basemap' },
    ],
  };
}

/** A style object, or a URL for vector styles fetched by MapLibre. */
export function basemapStyle(id: BasemapId): StyleSpecification | string {
  switch (id) {
    case 'topo':
      return rasterStyle(USGS_TOPO_TILES, USGS_ATTR);
    case 'satellite':
      return rasterStyle(USGS_IMAGERY_TILES, `${USGS_ATTR} Orthoimagery`);
    case 'streets':
      return OPENFREEMAP_STYLE;
  }
}

export const PARCELS_QUERY = 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0/query';
export const PARCELS_ATTR = 'Wisconsin Statewide Parcels V12 (SCO)';
export const NHD_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}';
export const NHD_ATTR = 'USGS NHD';
export const NWI_EXPORT = 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';
export const NWI_ATTR = 'USFWS NWI';
export const DEER_SERVICE = 'https://dnrmaps.wi.gov/arcgis/rest/services/WM_CWD/WM_DMU_MSU_DMZ_Ext/MapServer';
export const DEER_EXPORT = DEER_SERVICE + '/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:2&f=image';
export const DEER_ATTR = 'Wisconsin DNR';

/** Full-density 3DEP point clouds and v4 gap-fill elevation (USGS public domain). */
export const LIDAR_EPT_ROOT = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public';
export const LIDAR_DEM_ROOT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

/** Verified colored 3DEP server functions, USGS public domain. */
const terrainExport = (name: string): string => LIDAR_DEM_ROOT +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png&renderingRule=' +
  encodeURIComponent(JSON.stringify({ rasterFunction: name })) + '&f=image';
export const SLOPE_EXPORT = terrainExport('Slope Map');
export const ASPECT_EXPORT = terrainExport('Aspect Map');

export const LIDAR_VERSION = 'v1';
export const LIDAR_BOUNDS: [number, number, number, number] = [-90.991, 44.399, -90.202, 45.136];
export const LIDAR_TILES = Object.fromEntries(
  ['lidar-lrm', 'lidar-openness', 'lidar-hillshade', 'lidar-slope', 'lidar-chm'].map(name =>
    [name, `/tiles/${name}/${LIDAR_VERSION}/{z}/{x}/{y}.webp`]),
);
export const HISTORIC_AERIAL_SERVICE = 'https://dnrmaps.wi.gov/arcgis_image/rest/services/DW_Imagery/EN_Image_Basemap_';
export const WISCONSIN_BOUNDS: [number, number, number, number] = [-92.89, 42.49, -86.25, 47.31];
