import { wedge } from './fov';
import { effectiveColor, effectiveIcon, isVisible, type TypeVisibility } from '../organize/model';
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
import type { Category, FieldOfView, Item, LngLat, Waypoint } from '../types';
import { loadIconImage } from './icons';
import { LABELS_LAYER_PREFIX, LABELS_SOURCE_ID, clampLabelScale, labelLayers, labelTextSizes, labelsSource, roadLineLayers } from './labels';
import { ParcelLoader } from './parcels';
import { basemapStyle, type BasemapId } from './sources';
import { layerRegistry, layerSetting, layerVariant, type LayerDef, type LayerContext, type LayerPreferences } from './layerRegistry';
import './builtinLayers';

// MapLibre v6 ships its worker as a separate module; point it at the bundled asset.
setWorkerUrl(workerUrl);

export const LAYER_WAYPOINTS = 'ohm-waypoints';
export const LAYER_TRACKS = 'ohm-tracks';
const SRC_ITEMS_PT = 'ohm-items-pt';
const SRC_ITEMS_LN = 'ohm-items-ln';
const SRC_SKETCH = 'ohm-sketch';

export interface MapState extends LayerPreferences, TypeVisibility {
  basemap: BasemapId;
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
  private categories: Category[] = [];
  private refreshVersion = 0;
  private preview: ({ id: string; fov: FieldOfView } & Pick<Waypoint, 'categoryId' | 'color' | 'icon'>) | undefined;
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
    this.map.on('style.load', () => { this.styleReady = true; this.styleVersion++; this.installed.clear(); void this.installOverlays(); });
    const unsubscribe = layerRegistry.subscribe(() => this.syncLayers());
    this.map.on('remove', unsubscribe);
  }

  get mapState(): MapState {
    return { ...this.state, layers: Object.fromEntries(Object.entries(this.state.layers).map(([id, value]) => [id, { ...value }])),
      collapsed: { ...this.state.collapsed }, remembered: Object.fromEntries(Object.entries(this.state.remembered).map(([id, ids]) => [id, [...ids]])) };
  }

  setBasemap(id: BasemapId): void {
    if (id === this.state.basemap) return;
    this.state.basemap = id;
    this.styleReady = false;
    this.map.setStyle(basemapStyle(id), { diff: false });
  }

  private installed = new Set<string>();
  private styleReady = false;
  private styleVersion = 0;

  setLayer(id: string, on: boolean): void {
    const def = layerRegistry.get(id);
    const value = this.state.layers[id] ?? { on: false, opacity: def?.defaultOpacity ?? 1 };
    this.state.layers[id] = { ...value, on };
    this.syncLayers();
  }

  setLayerOpacity(id: string, opacity: number): void {
    const def = layerRegistry.get(id);
    if (!def || !Number.isFinite(opacity)) return;
    this.state.layers[id] = { ...layerSetting(this.state, def), opacity: Math.max(0, Math.min(1, opacity)) };
    if (this.styleReady && this.installed.has(id)) this.applyOpacity(def, this.state.layers[id]!.opacity);
  }

  setLayerVariant(id: string, variant?: string): void {
    const def = layerRegistry.get(id);
    if (!def?.source || !def.variants) return;
    const selected = layerVariant(def, variant)!;
    this.state.layers[id] = { ...layerSetting(this.state, def), variant: selected.id };
    if (this.styleReady && this.installed.has(id)) {
      const source = this.map.getSource(id) as import('maplibre-gl').RasterTileSource;
      // setTiles reloads TileJSON metadata, including attribution, from these options.
      source._options.attribution = selected.attribution ?? def.attribution;
      source.setTiles(selected.tiles);
    }
  }

  private applyOpacity(def: LayerDef, opacity: number): void {
    if (def.source) this.map.setPaintProperty(def.id, 'raster-opacity', opacity);
    else def.setOpacity?.(this.map, opacity, this.layerContext());
  }

  setCategoryCollapsed(id: string, collapsed: boolean): void { this.state.collapsed[id] = collapsed; }
  setCategoryRemembered(id: string, ids: string[]): void { this.state.remembered[id] = [...ids]; }

  private layerContext(beforeId?: string): LayerContext {
    return { basemap: this.state.basemap, beforeId, setParcelsEnabled: on => this.parcelLoader.setEnabled(on) };
  }

  private syncLayers(): void {
    if (!this.styleReady) return;
    const m = this.map;
    // Insert before basemap labels/roads and before application overlays.
    const dataIds = this.dataLayerIds();
    const before = m.getStyle()?.layers?.find(layer => !dataIds.has(layer.id) &&
      (layer.type === 'line' || layer.type === 'symbol' || layer.id.startsWith('ohm-')))?.id;
    for (const def of layerRegistry.layers()) {
      if (def.action) continue;
      const value = layerSetting(this.state, def);
      const ctx = this.layerContext(before);
      if (value.on && !this.installed.has(def.id)) {
        if (def.source) {
          const { kind: _kind, ...source } = def.source;
          const variant = layerVariant(def, value.variant);
          m.addSource(def.id, { type: 'raster', tileSize: 256, ...source, tiles: variant?.tiles ?? source.tiles, attribution: variant?.attribution ?? def.attribution });
          m.addLayer({ id: def.id, type: 'raster', source: def.id, minzoom: def.minzoom, maxzoom: def.maxzoom }, before);
        } else def.install?.(m, ctx);
        this.installed.add(def.id);
      }
      if (!this.installed.has(def.id)) continue;
      if (def.source) {
        m.setLayoutProperty(def.id, 'visibility', value.on ? 'visible' : 'none');
        m.setPaintProperty(def.id, 'raster-opacity', value.opacity);
      } else {
        def.setVisible?.(m, value.on, ctx);
        def.setOpacity?.(m, value.opacity, ctx);
      }
    }
    // Turning an earlier category on later still preserves registry order.
    for (const def of layerRegistry.layers()) for (const id of this.layerIds(def)) if (m.getLayer(id)) m.moveLayer(id, before);
  }

  private layerIds(def: LayerDef): string[] { return def.layerIds ?? (def.source ? [def.id] : []); }
  private dataLayerIds(): Set<string> { return new Set(layerRegistry.layers().flatMap(def => this.layerIds(def))); }

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

  setItems(items: Item[], categories: Category[] = this.categories): void {
    this.items = items;
    this.categories = categories;
    this.refreshItems();
  }

  setTypeVisibility(patch: Partial<TypeVisibility>): void {
    for (const key of ['showPins', 'showTrails', 'showRecordings'] as const) if (typeof patch[key] === 'boolean') this.state[key] = patch[key];
    this.refreshItems();
  }

  setFovPreview(id?: string, fov?: FieldOfView, appearance: Pick<Waypoint, 'categoryId' | 'color' | 'icon'> = { icon: 'trailcam' }): void {
    this.preview = id && fov ? { id, fov, ...appearance } : undefined;
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
    const generation = this.styleVersion;
    this.syncLayers();
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
        paint: { 'line-color': ['get', 'color'], 'line-width': 3.5 },
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
    if (!m.getSource('ohm-fov')) {
      m.addSource('ohm-fov', { type: 'geojson', data: emptyFC() });
      m.addLayer({ id: 'ohm-fov-fill', source: 'ohm-fov', type: 'fill', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 } });
      m.addLayer({ id: 'ohm-fov-line', source: 'ohm-fov', type: 'line', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } });
    }
    if (generation !== this.styleVersion || !this.styleReady) return;
    if (!m.getSource(SRC_ITEMS_PT)) {
      m.addSource(SRC_ITEMS_PT, { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: LAYER_WAYPOINTS,
        type: 'symbol',
        source: SRC_ITEMS_PT,
        layout: {
          'icon-image': ['get', 'image'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }
    this.syncLayers();
    this.refreshItems();
    this.refreshSketch();
  }

  private async refreshItems(): Promise<void> {
    const version = ++this.refreshVersion;
    const generation = this.styleVersion;
    if (!this.styleReady) return;
    const pt = this.map.getSource<GeoJSONSource>(SRC_ITEMS_PT);
    const ln = this.map.getSource<GeoJSONSource>(SRC_ITEMS_LN);
    if (!pt || !ln) return;
    const live = this.items.map(i => i.kind === 'waypoint' && this.preview?.id === i.id ? { ...i, ...this.preview } : i).filter(i => isVisible(i, this.categories, this.state));
    await Promise.all(live.map(async item => {
      if (item.kind !== 'waypoint') return;
      const icon = effectiveIcon(item, this.categories), color = effectiveColor(item, this.categories);
      const image = `ohm-${icon}-${color.slice(1)}`;
      if (this.map.hasImage(image)) return;
      const img = await loadIconImage(icon, 40, color);
      if (version === this.refreshVersion && generation === this.styleVersion && this.styleReady && this.map.getSource(SRC_ITEMS_PT) && !this.map.hasImage(image)) this.map.addImage(image, img, { pixelRatio: 2 });
    }));
    if (version !== this.refreshVersion || generation !== this.styleVersion || !this.styleReady || !this.map.getSource(SRC_ITEMS_PT)) return;
    pt.setData({
      type: 'FeatureCollection',
      features: live.flatMap((i) =>
        i.kind === 'waypoint'
          ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: i.coord }, properties: { id: i.id, icon: effectiveIcon(i, this.categories), image: `ohm-${effectiveIcon(i, this.categories)}-${effectiveColor(i, this.categories).slice(1)}` } }]
          : [],
      ),
    });
    this.map.getSource<GeoJSONSource>('ohm-fov')?.setData({
      type: 'FeatureCollection', features: live.flatMap(i => i.kind === 'waypoint' && i.icon === 'trailcam' ? [{
        type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [wedge(i.coord, i.fov ?? { bearing: 0, angle: 45, range: 25 })] },
        properties: { id: i.id, color: effectiveColor(i, this.categories) },
      }] : []),
    });
    ln.setData({
      type: 'FeatureCollection',
      features: live.flatMap((i) =>
        i.kind === 'track' && i.coords.length > 1
          ? [{ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: i.coords }, properties: { id: i.id, recorded: i.recorded, color: effectiveColor(i, this.categories) } }]
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
