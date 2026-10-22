/**
 * Every external map endpoint lives here. All were verified to return tiles/images
 * (see README "Data sources"). Do not add endpoints without verifying them.
 */
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

export type BasemapId = 'topo' | 'satellite' | 'streets';

const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

export const USGS_TOPO_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}';
export const USGS_IMAGERY_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** PAD-US 4.1 (fee lands) rendered server-side by the USGS ArcGIS MapServer export endpoint. */
export const PADUS_EXPORT =
  'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/export' +
  '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image';

export const PADUS_ATTR =
  '<a href="https://doi.org/10.5066/P96WBCHS" target="_blank" rel="noopener">USGS GAP PAD-US 4.1</a>';

export const BASEMAP_IDS: BasemapId[] = ['topo', 'satellite', 'streets'];

export const BASEMAP_NAMES: Record<BasemapId, string> = {
  topo: 'Topo',
  satellite: 'Satellite',
  streets: 'Streets',
};

function rasterStyle(tiles: string, attribution: string): StyleSpecification {
  return {
    version: 8,
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
