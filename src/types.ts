/** Domain model shared by storage, sync, share and UI. */

export const WAYPOINT_ICONS = ['pin', 'stand', 'blood', 'rub', 'scrape', 'deer', 'bed', 'camp', 'truck', 'trailcam'] as const;
export type WaypointIcon = (typeof WAYPOINT_ICONS)[number];
export type SightingSex = 'buck' | 'doe' | 'unknown';
export type BedAnimal = 'buck' | 'doe' | 'group';
export type BedTerrain = 'hill' | 'flat' | 'farm' | 'piedmont' | 'mountain';

export interface BedDetails {
  animal?: BedAnimal;
  /** When the bed was found, epoch ms. */
  bedAt?: number;
  /** Downhill aspect, degrees. */
  aspect?: number;
  /** Relative slope position, 0 at the pool and 100 at the peak. */
  position?: number;
  /** Positive openness, degrees. */
  openness?: number;
  /** Relief within 25 m, degrees. */
  steepness?: number;
  terrain?: BedTerrain;
}

/** [longitude, latitude] — GeoJSON order everywhere. */
export type LngLat = [number, number];

/** Compass directions a pin hunts well on. */
export const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type WindDir = (typeof WIND_DIRS)[number];

/** Fields every syncable item carries. See src/sync/merge.ts for conflict rules. */
export interface ItemMeta {
  /** Stable UUID, never changes, shared across devices. */
  id: string;
  /** Epoch ms when first created. */
  createdAt: number;
  /** Hybrid-logical-clock timestamp (epoch ms, strictly increasing per device). */
  updatedAt: number;
  /** Device that made the latest write. Tiebreaker for equal updatedAt. */
  deviceId: string;
  /** Tombstone: deleted items are kept so deletes propagate. */
  deleted: boolean;
}

export interface Category extends ItemMeta {
  kind: 'category';
  name: string;
  color?: string;
  icon?: WaypointIcon;
  hidden: boolean;
  sort?: number;
}

export interface ItemOrganization {
  categoryId?: string;
  /** Portable category name used by file/QR imports; Repo resolves it to a local ID. */
  categoryName?: string;
  hidden?: boolean;
  color?: string;
  iconOverride?: boolean;
}

export interface FieldOfView { bearing: number; angle: number; range: number }

export interface Waypoint extends ItemMeta, ItemOrganization {
  kind: 'waypoint';
  name: string;
  note: string;
  icon: WaypointIcon;
  coord: LngLat;
  sourceUrl?: string;
  fov?: FieldOfView;
  camera?: string;
  setAt?: number;
  checkedAt?: number;
  /** Deer sighting. Omitted for other pins. */
  sex?: SightingSex;
  /** When a deer was seen, epoch ms. */
  seenAt?: number;
  /** Resized JPEG data URL. Kept out of file and QR exports. */
  photo?: string;
  /** Directions the wind blows from when this pin hunts well. */
  winds?: WindDir[];
  /** Logged deer bed. Omitted for other pins. */
  bed?: BedDetails;
}

export interface Track extends ItemMeta, ItemOrganization {
  kind: 'track';
  name: string;
  note: string;
  coords: LngLat[];
  /** Indices of points that begin a new recording segment. */
  segments?: number[];
  /** True when recorded from GPS rather than drawn. */
  recorded: boolean;
}

export type Item = Waypoint | Track;
export type ItemKind = Item['kind'];
