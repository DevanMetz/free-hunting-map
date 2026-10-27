import { PUBLIC_LANDS } from '../map/publicLands';
import { clampLabelScale } from '../map/labels';
import { layerRegistry, layerVariant } from '../map/layerRegistry';
import type { MapState, MapView } from '../map/map';

export interface Settings extends MapState { view: MapView }
export const DEFAULT_SETTINGS: Settings = {
  basemap: 'topo', layers: {}, collapsed: {}, remembered: {},
  labels: true, labelScale: 1, view: { center: [-98.5, 39.8], zoom: 3.5 },
  showPins: true, showTrails: true, showRecordings: true,
};
type LegacySettings = Partial<Settings> & {
  publicLands?: boolean; publicLand?: Record<string, boolean>;
  trails?: boolean; hillshade?: boolean; parcels?: boolean; water?: boolean; deerUnits?: boolean;
};
export function loadSettings(saved: LegacySettings = {}): Settings {
  const state: Settings = { ...DEFAULT_SETTINGS,
    basemap: saved.basemap ?? DEFAULT_SETTINGS.basemap,
    showPins: saved.showPins !== false, showTrails: saved.showTrails !== false, showRecordings: saved.showRecordings !== false,
    labels: saved.labels ?? true, labelScale: clampLabelScale(saved.labelScale),
    view: saved.view ?? { ...DEFAULT_SETTINGS.view, center: [...DEFAULT_SETTINGS.view.center] },
    layers: {}, layerOrder: Array.isArray(saved.layerOrder) ? [...new Set(saved.layerOrder.filter((id): id is string => typeof id === 'string' && id.length <= 120))].slice(0, 1000) : [], collapsed: { ...saved.collapsed },
    remembered: Object.fromEntries(Object.entries(saved.remembered ?? {}).map(([id, ids]) => [id, [...ids]])),
  };
  const legacy = {
    ...Object.fromEntries(PUBLIC_LANDS.map(c => [`padus-${c.id}`, saved.publicLand ? saved.publicLand[c.id] === true : saved.publicLands === true])),
    'public-trails': saved.trails === true,
    hillshade: saved.hillshade === true, parcels: saved.parcels === true,
    'water-nhd': saved.water === true, 'water-nwi': saved.water === true, 'deer-units': saved.deerUnits === true,
  };
  for (const def of layerRegistry.layers()) if (!def.action) state.layers[def.id] = {
    ...(def.variants ? { variant: layerVariant(def)!.id } : {}),
    on: legacy[def.id as keyof typeof legacy] ?? def.defaultOn ?? false, opacity: def.defaultOpacity,
  };
  for (const [id, value] of Object.entries(saved.layers ?? {})) {
    if (value && typeof value.on === 'boolean') state.layers[id] = {
      ...(layerRegistry.get(id)?.variants ? { variant: layerVariant(layerRegistry.get(id)!, value.variant)!.id } : {}),
      on: value.on, opacity: typeof value.opacity === 'number' && Number.isFinite(value.opacity)
        ? Math.max(0, Math.min(1, value.opacity)) : layerRegistry.get(id)?.defaultOpacity ?? 1,
    };
  }
  return state;
}
