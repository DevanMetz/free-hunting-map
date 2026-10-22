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
import { LABELS_LAYER_PREFIX, LABELS_SOURCE_ID, clampLabelScale, labelLayers, labelTextSizes, labelsSource, roadLineLayers } from './labels';
import { ParcelLoader } from './parcels';
import { DEER_EXPORT, DEER_ATTR, NHD_TILES, NHD_ATTR, NWI_EXPORT, NWI_ATTR, PARCELS_ATTR, basemapStyle, HILLSHADE_ATTR, HILLSHADE_EXPORT, PADUS_ATTR, PADUS_EXPORT, type BasemapId } from './sources';

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
  hillshade: boolean;
  parcels: boolean;
  water: boolean;
  deerUnits: boolean;
  labels: boolean;
  labelScale: number;
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
  private readonly parcelLoader: ParcelLoader;
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
    this.parcelLoader = new ParcelLoader(this.map);
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

  setHillshade(on: boolean): void {
    this.state.hillshade = on;
    if (this.map.getLayer('hillshade')) this.map.setLayoutProperty('hillshade', 'visibility', on ? 'visible' : 'none');
  }

  setPublicLands(on: boolean): void {
    this.state.publicLands = on;
    if (this.map.getLayer('padus')) this.map.setLayoutProperty('padus', 'visibility', on ? 'visible' : 'none');
  }

  setParcels(on: boolean): void {
    this.state.parcels = on;
    this.setVisibility(['parcels-fill', 'parcels-line'], on);
    this.parcelLoader.setEnabled(on);
  }

  setWater(on: boolean): void {
    this.state.water = on;
    this.setVisibility(['water-nhd', 'water-nwi'], on);
  }

  setDeerUnits(on: boolean): void {
    this.state.deerUnits = on;
    this.setVisibility(['deer-units'], on);
  }

  private setVisibility(ids: string[], on: boolean): void {
    for (const id of ids) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  setLabels(on: boolean): void {
    this.state.labels = on;
    for (const layer of this.map.getStyle()?.layers ?? []) {
      if (layer.id.startsWith(LABELS_LAYER_PREFIX)) this.map.setLayoutProperty(layer.id, 'visibility', on ? 'visible' : 'none');
    }
  }

  setLabelScale(scale: number): void {
    this.state.labelScale = clampLabelScale(scale);
    if (this.state.basemap === 'streets') return;
    for (const [id, size] of Object.entries(labelTextSizes(this.state.basemap, this.state.labelScale))) {
      if (this.map.getLayer(id)?.type === 'symbol') this.map.setLayoutProperty(id, 'text-size', size);
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
    const before = m.getStyle()?.layers?.find(layer => layer.type === 'line' || layer.type === 'symbol')?.id;
    if (!m.getSource('hillshade')) {
      m.addSource('hillshade', {
        type: 'raster', tiles: [HILLSHADE_EXPORT], tileSize: 256, minzoom: 11, maxzoom: 17, attribution: HILLSHADE_ATTR,
      });
      // Preserve the streets basemap's road lines and labels above the shading.
      m.addLayer({
        id: 'hillshade',
        type: 'raster',
        source: 'hillshade',
        paint: { 'raster-opacity': this.state.basemap === 'satellite' ? 0.45 : 0.55, 'raster-contrast': 0.2 },
        layout: { visibility: this.state.hillshade ? 'visible' : 'none' },
      }, before);
    }
    for (const [id, tiles, attribution, minzoom, opacity] of [
      ['water-nhd', NHD_TILES, NHD_ATTR, 0, 1],
      ['water-nwi', NWI_EXPORT, NWI_ATTR, 11, 0.7],
    ] as const) {
      if (!m.getSource(id)) {
        m.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: 16, attribution });
        m.addLayer({ id, type: 'raster', source: id, minzoom, paint: { 'raster-opacity': opacity }, layout: { visibility: this.state.water ? 'visible' : 'none' } }, before);
      }
    }
    if (!m.getSource('padus')) {
      m.addSource('padus', { type: 'raster', tiles: [PADUS_EXPORT], tileSize: 256, minzoom: 5, attribution: PADUS_ATTR });
      m.addLayer(
        {
          id: 'padus',
          type: 'raster',
          source: 'padus',
          paint: { 'raster-opacity': 0.5 },
          layout: { visibility: this.state.publicLands ? 'visible' : 'none' },
        }, before,
      );
    }
    if (!m.getSource('parcels')) {
      m.addSource('parcels', { type: 'geojson', data: emptyFC(), attribution: PARCELS_ATTR });
      const layout = { visibility: this.state.parcels ? 'visible' as const : 'none' as const };
      m.addLayer({ id: 'parcels-fill', type: 'fill', source: 'parcels', minzoom: 13, layout, paint: { 'fill-opacity': 0 } }, before);
      m.addLayer({ id: 'parcels-line', type: 'line', source: 'parcels', minzoom: 13, layout, paint: {
        'line-color': this.state.basemap === 'satellite' ? '#ffd400' : '#b0306a',
        'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.6],
      } }, before);
    }
    this.parcelLoader.setEnabled(this.state.parcels);
    if (!m.getSource('deer-units')) {
      m.addSource('deer-units', { type: 'raster', tiles: [DEER_EXPORT], tileSize: 256, attribution: DEER_ATTR });
      m.addLayer({ id: 'deer-units', type: 'raster', source: 'deer-units', minzoom: 6, layout: { visibility: this.state.deerUnits ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.8 } }, before);
    }
    // Streets (OpenFreeMap Liberty) has its own labels. Added before our tracks/waypoints so those draw on top.
    const { basemap } = this.state;
    if (basemap !== 'streets' && !m.getSource(LABELS_SOURCE_ID)) {
      m.addSource(LABELS_SOURCE_ID, labelsSource());
      // Draw satellite roads or topo trails below names and user items.
      for (const layer of roadLineLayers(this.state.labels, basemap)) m.addLayer(layer);
      for (const layer of labelLayers(basemap, this.state.labels, this.state.labelScale)) m.addLayer(layer);
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
