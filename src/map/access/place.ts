import type { LngLat } from '../../types';

let armed = false;
let place: ((at: LngLat) => void) | undefined;
const listeners = new Set<() => void>();

function notify(): void { for (const listener of listeners) listener(); }

export function accessPlacementArmed(): boolean { return armed; }

export function onAccessPlacementChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAccessPlacementHandler(handler: ((at: LngLat) => void) | undefined): void {
  place = handler;
  if (!handler && armed) { armed = false; notify(); }
}

export function toggleAccessPlacement(): boolean {
  if (!place) return false;
  armed = !armed;
  notify();
  return armed;
}

export function cancelAccessPlacement(): void {
  if (!armed) return;
  armed = false;
  notify();
}

/** Returns true when this click places a pullout and should not identify the map. */
export function takeAccessPlacement(at: LngLat): boolean {
  if (!armed || !place) return false;
  armed = false;
  notify();
  place(at);
  return true;
}
