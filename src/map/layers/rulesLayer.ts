import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { GeoJSONSource, Map as HuntMap } from 'maplibre-gl';
import type { IdentifyResult } from '../layerRegistry';
import { registerLayer } from '../layerRegistry';
import { areaSources, seasonSources } from '../rules/registry';
import { text } from './arcgis';

interface RulesLayerOptions {
  id: string;
  name: string;
  state: string;
  attribution: string;
  cacheRoute: RegExp;
}

interface Loader { on: boolean; refresh: boolean; controller?: AbortController; load(): Promise<void> }

function rows(properties: Record<string, unknown>): [string, string][] {
  const pairs: [string, string][] = [
    ['Rule', text(properties.rule)],
    ['Dates', text(properties.dates)],
    ['Entry', text(properties.entry)],
    ['Exceptions', text(properties.exceptions)],
    ['Authority', text(properties.authority)],
  ];
  return pairs.filter(([, value]) => value);
}

function links(properties: Record<string, unknown>): { label: string; url: string }[] {
  const mapUrl = text(properties.mapUrl);
  const authorityUrl = text(properties.authorityUrl);
  const sourceUrl = text(properties.sourceUrl);
  return [
    mapUrl.startsWith('https://') ? { label: 'Property map', url: mapUrl } : undefined,
    authorityUrl.startsWith('https://') ? { label: text(properties.authority) || 'Authority', url: authorityUrl } : undefined,
    sourceUrl.startsWith('https://') ? { label: text(properties.sourceLabel) || 'Source', url: sourceUrl } : undefined,
  ].filter((link): link is { label: string; url: string } => !!link);
}

/** One state layer over the shared rule registry. Another state calls this with its code. */
export function registerRulesLayer(options: RulesLayerOptions): void {
  const { id, name, state, attribution, cacheRoute } = options;
  const fill = `${id}-fill`;
  const line = `${id}-line`;
  const minzoom = 6;
  const loaders = new WeakMap<HuntMap, Loader>();
  registerLayer({
    id, name, category: 'land', minzoom, maxzoom: 20, defaultOpacity: 0.85,
    swatch: '#c47b2b', attribution, layerIds: [fill, line], cacheRoute, cacheStrategy: 'NetworkFirst',
    legend: [
      { color: '#9b2c2c', label: 'No entry' },
      { color: '#c47b2b', label: 'Restricted' },
      { color: '#5c4d8a', label: 'Municipal' },
    ],
    install(map, ctx) {
      if (map.getSource(id)) return;
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
      map.addLayer({
        id: fill, type: 'fill', source: id, minzoom,
        paint: {
          'fill-color': ['match', ['get', 'kind'], 'entry', '#9b2c2c', 'municipal', '#5c4d8a', '#c47b2b'],
          'fill-opacity': 0.22,
        },
      }, ctx.beforeId);
      map.addLayer({
        id: line, type: 'line', source: id, minzoom,
        paint: {
          'line-color': ['match', ['get', 'kind'], 'entry', '#9b2c2c', 'municipal', '#5c4d8a', '#c47b2b'],
          'line-width': 2,
        },
      }, ctx.beforeId);
      let loader = loaders.get(map);
      if (!loader) {
        const view: Loader = { on: false, refresh: true, async load() {
          view.controller?.abort();
          if (!view.on || map.getZoom() < minzoom) return;
          const source = map.getSource(id) as GeoJSONSource | undefined;
          if (!source) return;
          const controller = view.controller = new AbortController();
          const bounds = map.getBounds();
          try {
            const features = new Map<string, Feature<Polygon | MultiPolygon>>();
            for (const area of areaSources.filter(source => source.state === state)) {
              if (map.getZoom() < area.minzoom) continue;
              for (const feature of await area.load(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), map.getZoom(), controller.signal)) {
                features.set(String(feature.id ?? features.size), feature);
              }
            }
            if (!controller.signal.aborted && map.getSource(id) === source) {
              const collection: FeatureCollection<Polygon | MultiPolygon> = { type: 'FeatureCollection', features: [...features.values()] };
              source.setData(collection);
            }
          } catch { /* Keep the last viewed rules when a service is unreachable. */ }
        } };
        const move = () => { void view.load(); };
        map.on('moveend', move);
        map.once('remove', () => { view.controller?.abort(); map.off('moveend', move); });
        loaders.set(map, view);
        loader = view;
      }
      loader.refresh = true;
    },
    setVisible(map, on) {
      for (const layer of [fill, line]) if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
      const view = loaders.get(map);
      if (!view) return;
      const changed = view.on !== on;
      view.on = on;
      if (on && (changed || view.refresh)) { view.refresh = false; void view.load(); }
      if (!on) view.controller?.abort();
    },
    setOpacity(map, opacity) {
      map.setPaintProperty(fill, 'fill-opacity', opacity * 0.28);
      map.setPaintProperty(line, 'line-opacity', opacity);
    },
    async identify(lng, lat, signal, map, point) {
      const rendered = map.getLayer(fill) ? map.queryRenderedFeatures(point, { layers: [fill, line] }) : [];
      const seen = new Set<string>();
      const sections: IdentifyResult[] = [];
      for (const feature of rendered) {
        const properties = feature.properties ?? {};
        const key = `${text(properties.title)}|${text(properties.rule)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sections.push({ title: text(properties.title), rows: rows(properties), links: links(properties) });
      }
      for (const source of seasonSources.filter(item => item.state === state)) {
        const season = await source.seasons(lng, lat, signal).catch(() => null);
        if (season) sections.push(season);
      }
      if (!sections.length) return null;
      const [first, ...rest] = sections;
      const mergedLinks = [...first!.links ?? [], ...rest.flatMap(section => section.links ?? [])];
      const unique = mergedLinks.filter((link, index) => mergedLinks.findIndex(item => item.url === link.url) === index);
      return {
        title: first!.title || name,
        rows: [...first!.rows, ...rest.flatMap(section => [...(section.title ? [['Also', section.title] as [string, string]] : []), ...section.rows])],
        links: unique,
      };
    },
  });
}
