import type { Map, PointLike } from 'maplibre-gl';
import type { BasemapId } from './sources';

export const LAYER_CATEGORIES = [
  { id: 'land', name: 'Land & Access' },
  { id: 'trails', name: 'Trails' },
  { id: 'vegetation', name: 'Vegetation' },
  { id: 'water', name: 'Water' },
  { id: 'agriculture', name: 'Agriculture' },
  { id: 'terrain', name: 'Terrain' },
  { id: 'hazards', name: 'Hazards' },
  { id: 'mydata', name: 'My Data' },
  { id: 'trailfinder', name: 'Trail Finder' },
] as const;
export type CategoryId = typeof LAYER_CATEGORIES[number]['id'];
export interface LayerSetting { on: boolean; opacity: number }
export interface LayerPreferences {
  layers: Record<string, LayerSetting>;
  collapsed: Record<string, boolean>;
  remembered: Record<string, string[]>;
}
export interface IdentifyResult { title?: string; rows: [string, string][] }
export interface LayerContext {
  basemap: BasemapId;
  beforeId?: string;
  setParcelsEnabled(on: boolean): void;
}
export interface LayerDef {
  id: string;
  category: CategoryId;
  name: string;
  swatch?: string;
  info?: string;
  defaultOpacity: number;
  defaultOn?: boolean;
  minzoom?: number;
  maxzoom?: number;
  legend?: { color: string; label: string }[] | string;
  attribution: string;
  cacheRoute?: RegExp;
  /** Live feeds must request fresh data before falling back to viewed data. */
  cacheStrategy?: 'CacheFirst' | 'NetworkFirst';
  source?: { kind: 'raster'; tiles: string[]; tileSize?: number; minzoom?: number; maxzoom?: number };
  /** Custom hooks run again on every style load. layerIds controls ordering. */
  layerIds?: string[];
  install?(map: Map, ctx: LayerContext): void;
  setVisible?(map: Map, on: boolean, ctx: LayerContext): void;
  setOpacity?(map: Map, opacity: number, ctx: LayerContext): void;
  identify?(lng: number, lat: number, signal: AbortSignal, map: Map, point: PointLike): Promise<IdentifyResult | null>;
  /** Actions appear as entries without a visibility switch. */
  action?: 'trailfinder';
}

/** No DOM or MapLibre runtime dependency: also consumed by the service-worker build. */
export class LayerRegistry {
  private definitions = new globalThis.Map<string, LayerDef>();
  private listeners = new Set<() => void>();
  registerLayer(def: LayerDef): void {
    if (this.definitions.has(def.id)) throw new Error(`Layer already registered: ${def.id}`);
    if (!def.id || !LAYER_CATEGORIES.some(c => c.id === def.category)) throw new Error(`Invalid layer: ${def.id}`);
    if (!Number.isFinite(def.defaultOpacity) || def.defaultOpacity < 0 || def.defaultOpacity > 1) throw new Error(`Invalid opacity: ${def.id}`);
    this.definitions.set(def.id, def);
    for (const listener of this.listeners) listener();
  }
  registerLayers(defs: readonly LayerDef[]): void { for (const def of defs) this.registerLayer(def); }
  get(id: string): LayerDef | undefined { return this.definitions.get(id); }
  layers(): LayerDef[] {
    return LAYER_CATEGORIES.flatMap(c => [...this.definitions.values()].filter(d => d.category === c.id));
  }
  categories(): (typeof LAYER_CATEGORIES[number] & { layers: LayerDef[] })[] {
    return LAYER_CATEGORIES.map(c => ({ ...c, layers: this.layers().filter(d => d.category === c.id) })).filter(c => c.layers.length);
  }
  cacheRoutes(strategy: 'CacheFirst' | 'NetworkFirst' = 'CacheFirst'): RegExp[] {
    return [...new Set(this.layers().flatMap(d => d.cacheRoute && (d.cacheStrategy ?? 'CacheFirst') === strategy ? [d.cacheRoute] : []))];
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
export const layerRegistry = new LayerRegistry();
export const registerLayer = (def: LayerDef): void => layerRegistry.registerLayer(def);
export const registerLayers = (defs: readonly LayerDef[]): void => layerRegistry.registerLayers(defs);
export function layerSetting(state: LayerPreferences, def: LayerDef): LayerSetting {
  return state.layers[def.id] ?? { on: def.defaultOn ?? false, opacity: def.defaultOpacity };
}
export function categoryState(defs: readonly LayerDef[], state: LayerPreferences): 'true' | 'false' | 'mixed' {
  const toggles = defs.filter(d => !d.action);
  const count = toggles.filter(d => layerSetting(state, d).on).length;
  return count === 0 ? 'false' : count === toggles.length ? 'true' : 'mixed';
}
/** Turning a mixed category off remembers exactly the enabled set. */
export function toggleCategory(defs: readonly LayerDef[], state: LayerPreferences): Record<string, boolean> {
  const toggles = defs.filter(d => !d.action);
  const active = toggles.filter(d => layerSetting(state, d).on).map(d => d.id);
  const category = toggles[0]?.category;
  if (!category) return {};
  if (active.length) state.remembered[category] = active;
  const remembered = state.remembered[category];
  const restore = remembered?.some(id => toggles.some(d => d.id === id)) ? remembered : toggles.map(d => d.id);
  return Object.fromEntries(toggles.map(d => [d.id, active.length === 0 && restore.includes(d.id)]));
}
