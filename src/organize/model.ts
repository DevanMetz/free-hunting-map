import type { Category, Item, WaypointIcon } from '../types';
import { ICON_STYLE } from '../map/icons';

export interface TypeVisibility { showPins: boolean; showTrails: boolean; showRecordings: boolean }
export const VISIBLE_TYPES: TypeVisibility = { showPins: true, showTrails: true, showRecordings: true };
export type ItemType = 'pin' | 'trail' | 'recording' | 'trailcam';
export function itemType(item: Item): ItemType {
  return item.kind === 'track' ? item.recorded ? 'recording' : 'trail' : item.icon === 'trailcam' ? 'trailcam' : 'pin';
}
export function categoryOf(item: Item, categories: Category[]): Category | undefined {
  return categories.find(c => c.id === item.categoryId && !c.deleted);
}
export function effectiveIcon(item: Item, categories: Category[]): WaypointIcon {
  if (item.kind !== 'waypoint') return 'pin';
  return item.icon === 'pin' && !item.iconOverride ? categoryOf(item, categories)?.icon ?? item.icon : item.icon;
}
export function effectiveColor(item: Item, categories: Category[]): string {
  return item.color ?? categoryOf(item, categories)?.color ?? (item.kind === 'waypoint' ? ICON_STYLE[item.icon].color : item.recorded ? '#4fc3f7' : '#ff7043');
}
export function isVisible(item: Item, categories: Category[], types: Partial<TypeVisibility> = {}): boolean {
  const key = item.kind === 'waypoint' ? 'showPins' : item.recorded ? 'showRecordings' : 'showTrails';
  return !item.deleted && !item.hidden && !categoryOf(item, categories)?.hidden && types[key] !== false;
}
/** Share names rather than relying on another device having this category ID. */
export function forSharing(item: Item, categories: Category[]): Item {
  const { hidden: _hidden, categoryName: _name, ...rest } = item;
  const category = categoryOf(item, categories);
  return { ...rest, ...(category ? { categoryName: category.name } : {}) } as Item;
}
