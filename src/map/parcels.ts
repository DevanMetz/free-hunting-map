import type { Feature, FeatureCollection } from 'geojson';
import type { Map, GeoJSONSource } from 'maplibre-gl';
import { PARCELS_QUERY } from './sources';

type Bounds = readonly [number, number, number, number];
export function tileBounds(z: number, x: number, y: number): Bounds {
  const n = 2 ** z;
  const lat = (v: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  return [x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)];
}

export function tilesForBounds([w, s, e, n]: Bounds, z = 14): [number, number][] {
  const size = 2 ** z;
  const tx = (lng: number) => Math.floor((lng + 180) / 360 * size);
  const ty = (lat: number) => Math.max(0, Math.min(size - 1, Math.floor((1 - Math.asinh(Math.tan(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180)) / Math.PI) / 2 * size)));
  if (e < w) e += 360;
  const left = tx(w), right = Math.min(tx(e), left + size - 1), top = ty(n), bottom = ty(s);
  const cx = Math.floor((left + right) / 2), cy = Math.floor((top + bottom) / 2);
  const result: [number, number][] = [];
  // Center-out rings keep capped requests near the viewport center.
  for (let r = 0; result.length < 64 && r <= Math.max(right - left, bottom - top); r++) {
    for (let y = Math.max(top, cy - r); y <= Math.min(bottom, cy + r) && result.length < 64; y++) {
      for (let x = Math.max(left, cx - r); x <= Math.min(right, cx + r) && result.length < 64; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === r) result.push([((x % size) + size) % size, y]);
      }
    }
  }
  return result;
}

export function parcelQueryUrl(x: number, y: number, offset = 0, query = PARCELS_QUERY, fields = 'OWNERNME1,OWNERNME2,GISACRES,PARCELID,STATEID', orderField = 'OBJECTID', pageSize = 2000): string {
  const params = new URLSearchParams({
    where: '1=1', geometry: tileBounds(14, x, y).map(v => v.toFixed(6)).join(','),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: fields, returnGeometry: 'true',
    outSR: '4326', geometryPrecision: '6', orderByFields: orderField,
    resultOffset: String(offset), resultRecordCount: String(pageSize), f: 'geojson',
  });
  return `${query}?${params}`;
}

export function mergeParcelFeatures(tiles: Iterable<Feature[]>): FeatureCollection {
  const seen = new Set<string>();
  const features: Feature[] = [];
  for (const tile of tiles) for (const feature of tile) {
    const p = feature.properties;
    const id = String(p?.STATEID || p?.PARCELID || feature.id || JSON.stringify(feature.geometry));
    if (!seen.has(id)) { seen.add(id); features.push(feature); }
  }
  return { type: 'FeatureCollection', features };
}

export class ParcelLoader {
  private enabled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tiles = new globalThis.Map<string, Feature[]>();
  private pending = new Set<string>();
  private active = 0;
  constructor(private map: Map, private source = 'parcels', private query = PARCELS_QUERY, private fields?: string, private extent?: Bounds, private orderField = 'OBJECTID', private pageSize = 2000) {
    map.on('moveend', () => { this.failedThisView.clear(); this.schedule(); });
    map.on('remove', () => clearTimeout(this.timer));
  }
  setEnabled(on: boolean): void { this.enabled = on; this.failedThisView.clear(); this.refresh(); this.schedule(); }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 250);
  }
  private load(): void {
    if (!this.enabled || this.map.getZoom() < 13 || !this.map.getSource(this.source)) return;
    const b = this.map.getBounds();
    for (const [x, y] of tilesForBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])) {
      const bounds = tileBounds(14, x, y);
      if (this.extent && (bounds[2] < this.extent[0] || bounds[0] > this.extent[2] || bounds[3] < this.extent[1] || bounds[1] > this.extent[3])) continue;
      const key = `${x}/${y}`;
      const cached = this.tiles.get(key);
      if (cached) { this.tiles.delete(key); this.tiles.set(key, cached); continue; }
      if (this.pending.has(key) || this.failedThisView.has(key)) continue;
      if (this.active >= 4) break;
      this.pending.add(key); this.active++;
      void this.fetchTile(x, y).then(features => {
        this.tiles.set(key, features);
        while (this.tiles.size > 300) this.tiles.delete(this.tiles.keys().next().value!);
        this.refresh();
      }).catch(() => {}).finally(() => {
        this.pending.delete(key); this.active--;
        // Retry failures on the next move, without an offline retry loop.
        this.scheduleRemaining(key);
      });
    }
  }
  private failedThisView = new Set<string>();
  private scheduleRemaining(key: string): void {
    if (!this.tiles.has(key)) this.failedThisView.add(key);
    this.schedule();
  }
  private async fetchTile(x: number, y: number): Promise<Feature[]> {
    const features: Feature[] = [];
    for (let page = 0; page < Math.ceil(10000 / this.pageSize); page++) {
      if (!this.enabled || this.map.getZoom() < 13) throw new Error('Parcels paused');
      const response = await fetch(parcelQueryUrl(x, y, page * this.pageSize, this.query, this.fields, this.orderField, this.pageSize));
      if (!response.ok) throw new Error('Parcel request failed');
      const data = await response.json() as FeatureCollection & { exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } };
      if (!Array.isArray(data.features)) throw new Error('Invalid parcels');
      features.push(...data.features);
      if (!(data.exceededTransferLimit || data.properties?.exceededTransferLimit)) break;
    }
    return features;
  }
  refresh(): void {
    this.map.getSource<GeoJSONSource>(this.source)?.setData(mergeParcelFeatures(this.tiles.values()));
  }
}
