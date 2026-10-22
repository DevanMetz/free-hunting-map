/**
 * Place / road / trail / water labels drawn from OpenFreeMap vector tiles
 * (OpenMapTiles schema) on top of the raster basemaps.
 */
import type {
  ExpressionSpecification,
  FilterSpecification,
  SymbolLayerSpecification,
  VectorSourceSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import { OPENFREEMAP_ATTR, OPENFREEMAP_TILEJSON } from './sources';

export type LabelTheme = 'topo' | 'satellite';

export const LABELS_SOURCE_ID = 'ohm-labels';
export const LABELS_LAYER_PREFIX = `${LABELS_SOURCE_ID}-`;

export const LABEL_FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'] as const;
const [REGULAR, BOLD, ITALIC] = LABEL_FONTS;

const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name_en'], ['get', 'name']];

interface Palette {
  text: string;
  water: string;
  trail: string;
  peak: string;
  halo: string;
  haloBlur: number;
}

const PALETTES: Record<LabelTheme, Palette> = {
  topo: { text: '#222', water: '#1f5f99', trail: '#5a3d1e', peak: '#4a3b2a', halo: 'rgba(255,255,255,0.9)', haloBlur: 0.3 },
  satellite: { text: '#ffffff', water: '#bfe3ff', trail: '#ffe9b0', peak: '#f3ead8', halo: 'rgba(0,0,0,0.85)', haloBlur: 0 },
};

export function labelsSource(): VectorSourceSpecification {
  return { type: 'vector', url: OPENFREEMAP_TILEJSON, attribution: OPENFREEMAP_ATTR };
}

const classIn = (...classes: string[]): FilterSpecification => ['in', ['get', 'class'], ['literal', classes]];

/** Symbol layers for the labels overlay, ordered bottom to top. */
export function labelLayers(theme: LabelTheme, visible: boolean): SymbolLayerSpecification[] {
  const p = PALETTES[theme];
  const visibility = visible ? 'visible' : 'none';
  const paint = (color: string): SymbolLayerSpecification['paint'] => ({
    'text-color': color,
    'text-halo-color': p.halo,
    'text-halo-width': 1.6,
    'text-halo-blur': p.haloBlur,
  });
  const layer = (
    id: string,
    sourceLayer: string,
    minzoom: number,
    filter: FilterSpecification | undefined,
    layout: SymbolLayerSpecification['layout'],
    color: string,
  ): SymbolLayerSpecification => ({
    id: LABELS_LAYER_PREFIX + id,
    type: 'symbol',
    source: LABELS_SOURCE_ID,
    'source-layer': sourceLayer,
    minzoom,
    ...(filter ? { filter } : {}),
    layout: { 'text-field': NAME, visibility, ...layout },
    paint: paint(color),
  });
  const line = (font: string, size: ExpressionSpecification | number): SymbolLayerSpecification['layout'] => ({
    'symbol-placement': 'line',
    'text-font': [font],
    'text-size': size,
    'symbol-spacing': 300,
    'text-max-angle': 30,
    'text-padding': 2,
  });
  const roadSize: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14];
  const point = (font: string, size: ExpressionSpecification | number): SymbolLayerSpecification['layout'] => ({
    'text-font': [font],
    'text-size': size,
    'text-max-width': 8,
    'text-padding': 2,
  });
  const scaled = (z0: number, s0: number, z1: number, s1: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], z0, s0, z1, s1];

  return [
    layer('waterway', 'waterway', 12, undefined, line(ITALIC, 11), p.water),
    layer('water-line', 'water_name', 10, ['==', ['geometry-type'], 'LineString'], line(ITALIC, 12), p.water),
    layer('water-point', 'water_name', 8, ['==', ['geometry-type'], 'Point'], point(ITALIC, scaled(8, 11, 14, 14)), p.water),
    layer('trail', 'transportation_name', 13, classIn('path', 'track'), line(ITALIC, roadSize), p.trail),
    layer('road-minor', 'transportation_name', 14, classIn('minor', 'service'), line(REGULAR, roadSize), p.text),
    layer('road-secondary', 'transportation_name', 12, classIn('secondary', 'tertiary'), line(REGULAR, roadSize), p.text),
    layer('road-major', 'transportation_name', 10, classIn('motorway', 'trunk', 'primary'), line(REGULAR, roadSize), p.text),
    layer('peak', 'mountain_peak', 11, undefined, { ...point(ITALIC, 11), 'text-anchor': 'top', 'text-offset': [0, 0.3] }, p.peak),
    layer('place-minor', 'place', 12, classIn('hamlet', 'suburb', 'neighbourhood'), point(REGULAR, scaled(12, 10, 16, 13)), p.text),
    layer('place-village', 'place', 10, classIn('village'), point(REGULAR, scaled(10, 11, 15, 14)), p.text),
    layer('place-town', 'place', 8, classIn('town'), point(BOLD, scaled(8, 11, 14, 16)), p.text),
    layer('place-city', 'place', 5, classIn('city'), point(BOLD, scaled(5, 12, 12, 20)), p.text),
  ];
}
