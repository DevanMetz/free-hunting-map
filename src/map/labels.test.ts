import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { LABEL_FONTS, LABELS_LAYER_PREFIX, LABELS_SOURCE_ID, labelLayers, labelsSource, roadLineLayers } from './labels';
import { OPENFREEMAP_GLYPHS } from './sources';

const THEMES = ['topo', 'satellite'] as const;

describe('labelLayers', () => {
  it('builds prefixed symbol layers on the labels source', () => {
    for (const theme of THEMES) {
      const layers = labelLayers(theme, true);
      expect(layers.length).toBeGreaterThan(0);
      expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
      for (const l of layers) {
        expect(l.type).toBe('symbol');
        expect(l.id.startsWith('ohm-labels-')).toBe(true);
        expect(l.source).toBe(LABELS_SOURCE_ID);
      }
    }
  });

  it('follows the visibility flag', () => {
    expect(labelLayers('topo', true).every((l) => l.layout?.visibility === 'visible')).toBe(true);
    expect(labelLayers('satellite', false).every((l) => l.layout?.visibility === 'none')).toBe(true);
  });

  it('uses a light halo on topo and a dark halo on satellite', () => {
    for (const l of labelLayers('topo', true)) expect(l.paint?.['text-halo-color']).toBe('rgba(255,255,255,0.9)');
    for (const l of labelLayers('satellite', true)) expect(l.paint?.['text-halo-color']).toBe('rgba(0,0,0,0.85)');
  });

  it('only uses fonts OpenFreeMap serves', () => {
    for (const theme of THEMES) {
      for (const l of labelLayers(theme, true)) {
        const font = l.layout?.['text-font'];
        expect(Array.isArray(font) && font.length === 1).toBe(true);
        expect(LABEL_FONTS).toContain((font as string[])[0]);
      }
    }
  });

  it('labels roads, trails, water, peaks and places', () => {
    const bySourceLayer = new Set(labelLayers('topo', true).map((l) => l['source-layer']));
    for (const sl of ['transportation_name', 'waterway', 'water_name', 'mountain_peak', 'place']) expect(bySourceLayer).toContain(sl);
    const roads = labelLayers('topo', true).filter((l) => l['source-layer'] === 'transportation_name');
    expect(roads.every((l) => l.layout?.['symbol-placement'] === 'line')).toBe(true);
  });

  it('produces a valid style', () => {
    for (const theme of THEMES) {
      const style: StyleSpecification = {
        version: 8,
        glyphs: OPENFREEMAP_GLYPHS,
        sources: { [LABELS_SOURCE_ID]: labelsSource() },
        layers: labelLayers(theme, true),
      };
      expect(validateStyleMin(style)).toEqual([]);
    }
  });
});

describe('roadLineLayers', () => {
  it('draws prefixed line layers for every road class on the transportation layer', () => {
    const layers = roadLineLayers(true);
    expect(layers.length).toBeGreaterThan(0);
    for (const l of layers) {
      expect(l.type).toBe('line');
      expect(l.id.startsWith(LABELS_LAYER_PREFIX)).toBe(true);
      expect(l.source).toBe(LABELS_SOURCE_ID);
      expect(l['source-layer']).toBe('transportation');
    }
    const classes = JSON.stringify(layers.map((l) => l.filter));
    for (const c of ['motorway', 'primary', 'secondary', 'minor', 'service', 'path', 'track']) expect(classes).toContain(`"${c}"`);
  });

  it('follows the visibility flag', () => {
    expect(roadLineLayers(true).every((l) => l.layout?.visibility === 'visible')).toBe(true);
    expect(roadLineLayers(false).every((l) => l.layout?.visibility === 'none')).toBe(true);
  });

  it('forms a valid hybrid style with the labels', () => {
    const style: StyleSpecification = {
      version: 8,
      glyphs: OPENFREEMAP_GLYPHS,
      sources: { [LABELS_SOURCE_ID]: labelsSource() },
      layers: [...roadLineLayers(true), ...labelLayers('satellite', true)],
    };
    expect(validateStyleMin(style)).toEqual([]);
  });
});
