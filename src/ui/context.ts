import type { TypeVisibility } from '../organize/model';
import type { CloudSync } from '../sync/cloud';
import type { HuntMap } from '../map/map';
import type { Repo } from '../storage/repo';
import type { Category, Item } from '../types';
import type { Sheet } from './sheet';

/** What panels get to work with. Keeps panels decoupled from the App class. */
export interface AppContext {
  repo: Repo;
  sync?: CloudSync;
  map: HuntMap;
  sheet: Sheet;
  /** Latest live items (kept in sync with the repo). */
  items(): Item[];
  categories(): Category[];
  visibility(): TypeVisibility;
  setTypeVisibility(patch: Partial<TypeVisibility>): Promise<void>;
  revealItem(item: Item): Promise<Item>;
  /** Open the detail/edit panel for an item. */
  openItem(item: Item): void;
}
