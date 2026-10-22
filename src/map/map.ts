import {
  GeolocateControl,
  Map as MLMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection } from 'geojson';
import { WAYPOINT_ICONS, type Item, type LngLat } from '../types';
import { loadIconImage } from './icons';
import { LABELS_LAYER_PREFIX, LABELS_SOURCE_ID, labelLayers, labelsSource } from './labels';
import { basemapStyle, PADUS_ATTR, PADUS_EXPORT, type BasemapId } from './sources';

// MapLibre v6 ships its worker as a separate module; point it at the bundled asset.
setWorkerUrl(workerUrl);

export const LAYER_WAYPOINTS = 'ohm-waypoints';
export const LAYER_TRACKS = 'ohm-tracks';
const SRC_ITEMS_PT = 'ohm-items-pt';
const SRC_ITEMS_LN = 'ohm-items-ln';
const SRC_SKETCH = 'ohm-sketch';

export interface MapState {
  basemap: BasemapId;
  publicLands: boolean;
  labels: boolean;
}

export interface MapView {
  center: LngLat;
  zoom: number;
}

/**
 * Owns the MapLibre instance. Our sources/layers are re-added after every
 * style swap (basemap toggle) so callers never deal with style lifecycle.
 */
export class HuntMap {
  readonly map: MLMap;
  readonly geolocate: GeolocateControl;
  private state: MapState;
  private items: Item[] = [];
  private sketch: { line: LngLat[]; color: string } = { line: [], color: '#ffd54f' };

  constructor(container: HTMLElement, state: MapState, view: MapView) {
    this.state = state;
    this.map = new MLMap({
      container,
      style: basemapStyle(state.basemap),
      center: view.center,
      zoom: view.zoom,
      attributionControl: { compact: true },
      maxPitch: 60,
    });
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
    this.geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: true,
    });
    this.map.addControl(this.geolocate, 'top-left');
    this.map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-left');
    this.map.on('style.load', () => void this.installOverlays());
  }

  get mapState(): MapState {
    return { ...this.state };
  }

  setBasemap(id: BasemapId): void {
    if (id === this.state.basemap) return;
    this.state.basemap = id;
    this.map.setStyle(basemapStyle(id), { diff: false });
  }

  setPublicLands(on: boolean): void {
    this.state.publicLands = on;
    if (this.map.getLayer('padus')) this.map.setLayoutProperty('padus', 'visibility', on ? 'visible' : 'none');
  }

  setLabels(on: boolean): void {
    this.state.labels = on;
    for (const layer of this.map.getStyle()?.layers ?? []) {
      if (layer.id.startsWith(LABELS_LAYER_PREFIX)) this.map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none');
    }
  }

  setItems(items: Item[]): void {
    this.items = items;
    this.refreshItems();
  }

  /** Temporary line for drawing / measuring. */
  setSketch(line: LngLat[], color = '#ffd54f'): void {
    this.sketch = { line, color };
    this.refreshSketch();
  }

  view(): MapView {
    const c = this.map.getCenter();
    return { center: [c.lng, c.lat], zoom: this.map.getZoom() };
  }

  private async installOverlays(): Promise<void> {
    const m = this.map;
    if (!m.getSource('padus')) {
      m.addSource('padus', { type: 'raster', tiles: [PADUS_EXPORT], tileSize: 256, minzoom: 5, attribution: PADUS_ATTR });
      m.addLayer(
        {
          id: 'padus',
          type: 'raster',
          source: 'padus',
          paint: { 'raster-opacity': 0.5 },
          layout: { visibility: this.state.publicLands ? 'visible' : 'none' },
        },
      );
    }
    // Streets (OpenFreeMap Liberty) has its own labels. Added before our tracks/waypoints so those draw on top.
    const { basemap } = this.state;
    if (basemap !== 'streets' && !m.getSource(LABELS_SOURCE_ID)) {
      m.addSource(LABELS_SOURCE_ID, labelsSource());
      for (const layer of labelLayers(basemap, this.state.labels)) m.addLayer(layer);
    }
    if (!m.getSource(SRC_ITEMS_LN)) {
      m.addSource(SRC_ITEMS_LN, { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: `${LAYER_TRACKS}-casing`,
        type: 'line',
        source: SRC_ITEMS_LN,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.45 },
      });
      m.addLayer({
        id: LAYER_TRACKS,
        type: 'line',
        source: SRC_ITEMS_LN,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['case', ['get', 'recorded'], '#4fc3f7', '#ff7043'], 'line-width': 3.5 },
      });
    }
    if (!m.getSource(SRC_SKETCH)) {
      m.addSource(SRC_SKETCH, { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: 'ohm-sketch-line',
        type: 'line',
        source: SRC_SKETCH,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1.5] },
      });
      m.addLayer({
        id: 'ohm-sketch-pts',
        type: 'circle',
        source: SRC_SKETCH,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 },
      });
    }
    await Promise.all(
      WAYPOINT_ICONS.map(async (icon) => {
        const name = `ohm-${icon}`;
        if (m.hasImage(name)) return;
        const img = await loadIconImage(icon, 40);
        if (!m.hasImage(name)) m.addImage(name, img, { pixelRatio: 2 });
      }),
    );
    if (!m.getSource(SRC_ITEMS_PT)) {
      m.addSource(SRC_ITEMS_PT, { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: LAYER_WAYPOINTS,
        type: 'symbol',
        source: SRC_ITEMS_PT,
        layout: {
          'icon-image': ['concat', 'ohm-', ['get', 'icon']],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }
    this.refreshItems();
    this.refreshSketch();
  }

  private refreshItems(): void {
    const pt = this.map.getSource<GeoJSONSource>(SRC_ITEMS_PT);
    const ln = this.map.getSource<GeoJSONSource>(SRC_ITEMS_LN);
    if (!pt || !ln) return;
    const live = this.items.filter((i) => !i.deleted);
    pt.setData({
      type: 'FeatureCollection',
      features: live.flatMap((i) =>
        i.kind === 'waypoint'
          ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: i.coord }, properties: { id: i.id, icon: i.icon } }]
          : [],
      ),
    });
    ln.setData({
      type: 'FeatureCollection',
      features: live.flatMap((i) =>
        i.kind === 'track' && i.coords.length > 1
          ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: i.coords }, properties: { id: i.id, recorded: i.recorded } }]
          : [],
      ),
    });
  }

  private refreshSketch(): void {
    const src = this.map.getSource<GeoJSONSource>(SRC_SKETCH);
    if (!src) return;
    const { line, color } = this.sketch;
    src.setData({
      type: 'FeatureCollection',
      features: [
        ...(line.length > 1 ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: line }, properties: { color } }] : []),
        ...line.map((c) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: { color } })),
      ],
    });
  }
}

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}
