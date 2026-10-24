import type { FilterSpecification, LineLayerSpecification } from 'maplibre-gl';
import type { IdentifyResult, LayerDef } from './layerRegistry';
import { trailAt } from './trails';

interface RoadClass { key: string; label: string; color: string; dash?: number[]; filter?: FilterSpecification }
interface RoadOptions {
  id: string; name: string; archive: string; sourceLayer: string; attribution: string;
  classes: RoadClass[];
  details(properties: Record<string, unknown>): IdentifyResult;
}
export const roadText = (value: unknown): string => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
export const roadRows = (rows: [string, string][]): [string, string][] => rows.filter(([, value]) => Boolean(value));

/** Shared mechanics only; each inventory owns its schema, styles and registration. */
export function roadLineDef(options: RoadOptions): LayerDef {
  const { id, name, archive, sourceLayer, attribution, classes } = options;
  const hits = classes.map(c => `${id}-${c.key}`);
  const layerIds = hits.flatMap(hit => [`${hit}-casing`, hit]);
  return {
    id, name, category: 'trails', attribution, defaultOpacity: 1, minzoom: 10,
    swatch: classes[0]!.color, legend: classes.map(({ color, label }) => ({ color, label })),
    cacheRoute: new RegExp(`/tiles/${archive}/v\\d+/\\d+/\\d+/\\d+\\.mvt$`), cacheStrategy: 'CacheFirst',
    layerIds,
    install(map, ctx) {
      if (!map.getSource(id)) map.addSource(id, { type: 'vector', tiles: [`/tiles/${archive}/v1/{z}/{x}/{y}.mvt`], minzoom: 8, maxzoom: 14, attribution });
      classes.forEach((c, i) => {
        const rgb = c.color.slice(1).match(/../g)!.map(hex => parseInt(hex, 16));
        const light = rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114 > 150;
        const common = { type: 'line' as const, source: id, 'source-layer': sourceLayer, minzoom: 10,
          ...(c.filter ? { filter: c.filter } : {}), layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const } };
        const layers: LineLayerSpecification[] = [
          { ...common, id: `${hits[i]}-casing`, paint: { 'line-color': light ? '#20271f' : '#fffdf5',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 6], 'line-opacity': 0.85 } },
          { ...common, id: hits[i]!, paint: { 'line-color': c.color,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 16, 3.2], ...(c.dash ? { 'line-dasharray': c.dash } : {}) } },
        ];
        for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer, ctx.beforeId);
      });
    },
    setVisible(map, on) {
      for (const layer of layerIds) if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
    },
    setOpacity(map, opacity) {
      for (const layer of layerIds) if (map.getLayer(layer)) map.setPaintProperty(layer, 'line-opacity', opacity * (layer.endsWith('-casing') ? 0.85 : 1));
    },
    identifyPresentation: 'sheet',
    async identify(_lng, _lat, _signal, map, point) {
      const p = trailAt(map, Array.isArray(point) ? { x: point[0], y: point[1] } : point, hits);
      return p ? options.details(p) : null;
    },
  };
}
