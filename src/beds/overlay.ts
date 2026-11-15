import type { Map } from 'maplibre-gl';
import type { BBox } from '../stands/load';

const SOURCE = 'bedding';
const LAYER = 'bedding';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

let mapRef: Map | null = null;
let opacity = 0.75;
let visible = false;
let url = BLANK;

interface ImageSource { updateImage(options: { url?: string; coordinates?: [number, number][] }): void }

export function installBedding(map: Map, beforeId?: string): void {
  mapRef = map;
  try {
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, {
        type: 'image',
        url: url === BLANK ? BLANK : url,
        coordinates: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]],
      });
    }
    if (!map.getLayer(LAYER)) {
      map.addLayer({
        id: LAYER,
        type: 'raster',
        source: SOURCE,
        paint: { 'raster-opacity': opacity, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
      }, beforeId);
    }
    map.setLayoutProperty(LAYER, 'visibility', visible ? 'visible' : 'none');
  } catch { /* style is mid-swap */ }
}

export function beddingVisible(on: boolean): void {
  visible = on;
  const map = mapRef;
  if (!map?.getLayer(LAYER)) return;
  try { map.setLayoutProperty(LAYER, 'visibility', on ? 'visible' : 'none'); } catch { /* style is mid-swap */ }
}

export function beddingOpacity(value: number): void {
  opacity = value;
  const map = mapRef;
  if (!map?.getLayer(LAYER)) return;
  try { map.setPaintProperty(LAYER, 'raster-opacity', value); } catch { /* style is mid-swap */ }
}

export function paintBedding(canvas: HTMLCanvasElement, box: BBox): void {
  const map = mapRef;
  const source = map?.getSource(SOURCE) as ImageSource | undefined;
  if (!source) return;
  url = canvas.toDataURL();
  const [west, south, east, north] = box;
  try {
    source.updateImage({
      url,
      coordinates: [[west, north], [east, north], [east, south], [west, south]],
    });
  } catch { /* style is mid-swap */ }
}

export function shadeCanvas(mask: Uint8Array, cols: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const image = ctx.createImageData(cols, rows);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const offset = i * 4;
    image.data[offset] = 196;
    image.data[offset + 1] = 122;
    image.data[offset + 2] = 44;
    image.data[offset + 3] = 168;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
