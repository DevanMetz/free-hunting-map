import { publicLandDefaults } from '../map/publicLands';
import { clampLabelScale } from '../map/labels';
import type { MapState, MapView } from '../map/map';

export interface Settings extends MapState {
  view: MapView;
}

export const DEFAULT_SETTINGS: Settings = {
  basemap: 'topo',
  publicLand: publicLandDefaults(),
  hillshade: false,
  parcels: false,
  water: false,
  deerUnits: false,
  labels: true,
  labelScale: 1,
  view: { center: [-98.5, 39.8], zoom: 3.5 },
};


export function loadSettings(saved?: Partial<Settings> & { publicLands?: boolean }): Settings {
  const { publicLands, ...current } = saved ?? {};
  return { ...DEFAULT_SETTINGS, ...current,
    publicLand: { ...publicLandDefaults(!current.publicLand && publicLands === true), ...current.publicLand },
    labelScale: clampLabelScale(current.labelScale) };
}
