import type { MapState, MapView } from '../map/map';

export interface Settings extends MapState {
  view: MapView;
}

export const DEFAULT_SETTINGS: Settings = {
  basemap: 'topo',
  publicLands: false,
  hillshade: false,
  parcels: false,
  water: false,
  deerUnits: false,
  labels: true,
  labelScale: 1,
  view: { center: [-98.5, 39.8], zoom: 3.5 },
};

