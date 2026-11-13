import type { Feature, FeatureCollection, Point } from 'geojson';
import { Popup, type GeoJSONSource, type IControl, type Map as HuntMap } from 'maplibre-gl';
import { accessStore, type Pullout } from '../access/store';
import { accessPlacementArmed, cancelAccessPlacement, onAccessPlacementChange, setAccessPlacementHandler, toggleAccessPlacement } from '../access/place';
import { pulloutForm } from '../../ui/accessEditor';
import { registerLayer } from '../layerRegistry';
import { text } from './arcgis';
import { iconButton } from '../../ui/dom';

interface Loader { on: boolean; refresh: boolean; official: Feature<Point>[]; controller?: AbortController; load(): Promise<void> }

export interface AccessLayerOptions {
  id: string;
  name: string;
  attribution: string;
  cacheRoute: RegExp;
  /** Official points for this state. User pullouts are drawn only when `userPullouts` is set. */
  load(west: number, south: number, east: number, north: number, zoom: number, signal: AbortSignal): Promise<Feature<Point>[]>;
  userPullouts?: boolean;
  swatch?: string;
  legend?: { color: string; label: string }[];
}

function pulloutPoints(): Feature<Point>[] {
  return (accessStore?.pullouts ?? []).map(item => ({
    type: 'Feature' as const,
    id: `pullout:${item.id}`,
    geometry: { type: 'Point' as const, coordinates: item.coord },
    properties: {
      spotId: `pullout:${item.id}`, origin: 'pullout', title: item.name || 'Pullout',
      detail: [item.capacity, item.gate, item.boulders, item.note].filter(Boolean).join(' · '),
      water: '', county: '', owner: '', sourceLabel: '', sourceUrl: '', pulloutId: item.id,
    },
  }));
}

class PulloutControl implements IControl {
  readonly element = document.createElement('div');
  private button = iconButton('plus', 'Add pullout', () => { toggleAccessPlacement(); });
  private stop: () => void;
  constructor() {
    this.element.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button.classList.add('access-add');
    this.element.append(this.button);
    this.stop = onAccessPlacementChange(() => this.paint());
    this.paint();
  }
  private paint(): void {
    const on = accessPlacementArmed();
    this.button.setAttribute('aria-pressed', String(on));
    this.button.classList.toggle('active', on);
  }
  onAdd(): HTMLElement { return this.element; }
  onRemove(): void { this.stop(); this.element.remove(); }
}

function openPullout(map: HuntMap, item: Pullout): void {
  const popup = new Popup({ closeButton: true, className: 'inspect-popup', maxWidth: '320px' });
  popup.setLngLat(item.coord).setDOMContent(pulloutForm(item.id)).addTo(map);
  const close = popup.getElement()?.querySelector<HTMLButtonElement>('.maplibregl-popup-close-button');
  close?.setAttribute('aria-label', 'Close');
  close?.setAttribute('title', 'Close');
}

/** Shared parking/access layer. Pass another state's loader to add it. */
export function registerAccessLayer(options: AccessLayerOptions): void {
  const { id, name, attribution, cacheRoute } = options;
  const circles = `${id}-points`;
  const minzoom = 9;
  const loaders = new WeakMap<HuntMap, Loader>();
  const controls = new WeakMap<HuntMap, PulloutControl>();
  registerLayer({
    id, name, category: 'land', minzoom, maxzoom: 20, defaultOpacity: 1,
    swatch: options.swatch ?? '#2f6f4e', attribution, layerIds: [circles], cacheRoute, cacheStrategy: 'NetworkFirst',
    legend: options.legend ?? [
      { color: '#2f6f4e', label: 'Parking' },
      { color: '#3d7ea6', label: 'Access' },
      { color: '#d39234', label: 'Pullout' },
    ],
    install(map, ctx) {
      if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution });
        map.addLayer({
          id: circles, type: 'circle', source: id, minzoom,
          paint: {
            'circle-radius': ['match', ['get', 'origin'], 'pullout', 7, 6],
            'circle-color': ['match', ['get', 'origin'], 'pullout', '#d39234', 'access', '#3d7ea6', '#2f6f4e'],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
          },
        }, ctx.beforeId);
      }
      let loader = loaders.get(map);
      if (!loader) {
        const view: Loader = { on: false, refresh: true, official: [], async load() {
          view.controller?.abort();
          if (!view.on || map.getZoom() < minzoom) return;
          const source = map.getSource(id) as GeoJSONSource | undefined;
          if (!source) return;
          const controller = view.controller = new AbortController();
          const bounds = map.getBounds();
          if (map.getZoom() >= 11) {
            try {
              view.official = await options.load(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), map.getZoom(), controller.signal);
            } catch { /* Keep the last official points. */ }
          } else view.official = [];
          if (controller.signal.aborted || map.getSource(id) !== source) return;
          const collection: FeatureCollection<Point> = {
            type: 'FeatureCollection',
            features: [...view.official, ...(options.userPullouts ? pulloutPoints() : [])],
          };
          source.setData(collection);
        } };
        const move = () => { void view.load(); };
        const changed = () => { if (view.on) void view.load(); };
        map.on('moveend', move);
        accessStore?.addEventListener('change', changed);
        map.once('remove', () => {
          view.controller?.abort();
          map.off('moveend', move);
          accessStore?.removeEventListener('change', changed);
        });
        loaders.set(map, view);
        loader = view;
      }
      loader.refresh = true;
    },
    setVisible(map, on) {
      if (map.getLayer(circles)) map.setLayoutProperty(circles, 'visibility', on ? 'visible' : 'none');
      const view = loaders.get(map);
      if (options.userPullouts) {
        if (on) {
          if (!controls.get(map)?.element.isConnected) {
            const control = new PulloutControl();
            controls.set(map, control);
            map.addControl(control, 'top-left');
          }
          setAccessPlacementHandler(at => {
            const item = accessStore?.createPullout(at);
            if (!item) return;
            openPullout(map, item);
            void view?.load();
          });
        } else {
          cancelAccessPlacement();
          setAccessPlacementHandler(undefined);
          const control = controls.get(map);
          if (control?.element.isConnected) map.removeControl(control);
          controls.delete(map);
        }
      }
      if (!view) return;
      const changed = view.on !== on;
      view.on = on;
      if (on && (changed || view.refresh)) { view.refresh = false; void view.load(); }
      if (!on) view.controller?.abort();
    },
    setOpacity(map, opacity) {
      map.setPaintProperty(circles, 'circle-opacity', opacity);
      map.setPaintProperty(circles, 'circle-stroke-opacity', opacity);
    },
    async identify(_lng, _lat, _signal, map, point) {
      if (!map.getLayer(circles)) return null;
      const properties = map.queryRenderedFeatures(point, { layers: [circles] })[0]?.properties;
      if (!properties) return null;
      const pulloutId = text(properties.pulloutId);
      const rows: [string, string][] = [];
      if (!pulloutId) {
        for (const [label, value] of [['Detail', properties.detail], ['Water', properties.water], ['County', properties.county], ['Owner', properties.owner]] as const) {
          if (text(value)) rows.push([label, text(value)]);
        }
      }
      const sourceUrl = text(properties.sourceUrl);
      return {
        title: text(properties.title) || name,
        rows,
        links: sourceUrl.startsWith('https://') ? [{ label: text(properties.sourceLabel) || 'Source', url: sourceUrl }] : [],
        accessSpotId: text(properties.spotId) || undefined,
        ...(pulloutId ? { pulloutId } : {}),
      };
    },
  });
}
