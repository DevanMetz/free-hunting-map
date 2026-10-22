import type { HuntMap } from '../map/map';
import type { Repo } from '../storage/repo';
import type { Item } from '../types';
import type { Sheet } from './sheet';

/** What panels get to work with. Keeps panels decoupled from the App class. */
export interface AppContext {
  repo: Repo;
  map: HuntMap;
  sheet: Sheet;
  /** Latest live items (kept in sync with the repo). */
  items(): Item[];
  /** Open the detail/edit panel for an item. */
  openItem(item: Item): void;
}
