import type { GeoJSONSource, GeolocateControl, Map } from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Repo } from '../storage/repo';
import type { LngLat } from '../types';
import { fetchWeather, type Weather } from '../conditions/weather';
import { destination } from './fov';
import { haversine } from './geo';

const SOURCE = 'ohm-wind-plume';
const MAX_AGE = 90 * 60_000;
const LOCATION_AGE = 60_000;
const REFRESH = 10 * 60_000;
const CACHE = 'wind-plume:last';
type Geolocate = GeolocateControl & { _watchState?: string };

/** Geographic downwind overlay; all failures leave the map usable offline. */
export class WindPlume {
  private position: { coord: LngLat; at: number } | null = null;
  private weather: Weather | null = null;
  private lastAttempt = 0;
  private attemptPoint: LngLat | null = null;
  private fetching = false;
  private enabled: boolean;

  constructor(private map: Map, private geolocate: Geolocate, private repo: Repo, enabled: boolean) {
    this.enabled = enabled;
    geolocate.on('geolocate', e => {
      this.position = { coord: [e.coords.longitude, e.coords.latitude], at: Date.now() };
      this.update();
    });
    geolocate.on('trackuserlocationend', () => {
      if (geolocate._watchState === 'OFF') { this.position = null; this.render(); }
    });
    geolocate.on('error', () => this.render());
    map.on('style.load', () => this.render());
    const timer = window.setInterval(() => this.update(), 15_000);
    map.on('remove', () => clearInterval(timer));
    void repo.getMeta<Weather>(CACHE).then(w => { if (!this.weather && w) { this.weather = w; this.render(); } }).catch(() => {});
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; this.update(); }

  private update(): void {
    this.render();
    const pos = this.position;
    if (!this.enabled || !pos || Date.now() - pos.at > LOCATION_AGE || this.geolocate._watchState === 'OFF' || this.fetching) return;
    if (Date.now() - this.lastAttempt < REFRESH && this.attemptPoint && haversine(pos.coord, this.attemptPoint) < 500) return;
    this.fetching = true;
    this.lastAttempt = Date.now();
    this.attemptPoint = pos.coord;
    void fetchWeather(pos.coord[1], pos.coord[0], AbortSignal.timeout(10_000)).then(weather => {
      const c = weather.current;
      if (![c.windSpeed, c.windDir, c.windGust].every(Number.isFinite) || c.windSpeed < 0) return;
      this.weather = weather;
      void this.repo.setMeta(CACHE, weather).catch(() => {});
      this.render();
    }).catch(() => {}).finally(() => { this.fetching = false; });
  }

  private render(): void {
    if (!this.map.isStyleLoaded()) return;
    if (!this.map.getSource(SOURCE)) {
      this.map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this.map.addLayer({ id: SOURCE, type: 'fill', source: SOURCE, paint: { 'fill-color': '#f79032', 'fill-opacity': ['get', 'opacity'] } });
    }
    const features: FeatureCollection<Polygon>['features'] = [];
    const pos = this.position, w = this.weather;
    if (this.enabled && pos && Date.now() - pos.at < LOCATION_AGE && this.geolocate._watchState !== 'OFF' && w && Date.now() - w.fetchedAt < MAX_AGE && haversine(pos.coord, [w.lng, w.lat]) < 10_000 && [w.current.windSpeed, w.current.windDir, w.current.windGust].every(Number.isFinite)) {
      const bearing = w.current.windDir + 180;
      const spread = w.current.windSpeed < 3 ? 60 : 35;
      const length = Math.min(600, 200 + Math.max(0, w.current.windSpeed) * 20);
      const point = (angle: number, distance: number): LngLat => {
        const p = destination(pos.coord, angle, distance);
        if (p[0] - pos.coord[0] > 180) p[0] -= 360;
        if (p[0] - pos.coord[0] < -180) p[0] += 360;
        return p;
      };
      // Nested sectors create a soft fade without animation or extra layers.
      for (const [fraction, opacity] of [[1, 0.035], [0.75, 0.04], [0.5, 0.05], [0.25, 0.06]]) {
        const start = point(bearing, 4);
        const arc = Array.from({ length: 17 }, (_, i) => point(bearing - spread / 2 + spread * i / 16, length * fraction!));
        features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[start, ...arc, start]] }, properties: { opacity } });
      }
    }
    this.map.getSource<GeoJSONSource>(SOURCE)?.setData({ type: 'FeatureCollection', features });
  }
}
