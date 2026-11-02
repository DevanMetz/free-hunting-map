import type { GeolocateControl, Map as MLMap } from 'maplibre-gl';

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
type Geolocate = GeolocateControl & { _dotElement?: HTMLElement; _watchState?: string };

const COMPASS_FRESH_MS = 3000;
const GPS_FRESH_MS = 15000;
const MIN_GPS_SPEED = 1;

const norm = (deg: number): number => ((deg % 360) + 360) % 360;
const delta = (from: number, to: number): number => ((to - from + 540) % 360) - 180;

function screenAngle(): number {
  const angle = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
  return Number.isFinite(angle) ? angle : 0;
}

/** Heading cone on the GeolocateControl dot, driven by the compass or GPS course. */
export class HeadingIndicator {
  private cone: HTMLElement | null = null;
  private listening = false;
  private compass: { deg: number; at: number } | null = null;
  private gps: { deg: number; at: number } | null = null;
  private shown: number | null = null;
  private frame = 0;
  private visible = false;

  constructor(private readonly map: MLMap, private readonly geolocate: Geolocate) {
    const container = map.getContainer();
    // Capture phase so the iOS permission request runs inside the user's tap.
    container.addEventListener('click', event => {
      if ((event.target as Element | null)?.closest?.('.maplibregl-ctrl-geolocate')) this.requestPermission();
    }, true);
    geolocate.on('geolocate', (e: { coords?: GeolocationCoordinates }) => this.onPosition(e.coords));
    geolocate.on('trackuserlocationstart', () => this.start());
    geolocate.on('trackuserlocationend', () => { if (geolocate._watchState === 'OFF') this.stop(); });
    geolocate.on('error', () => { if (geolocate._watchState === 'OFF') this.stop(); else this.schedule(); });
    map.on('rotate', () => this.schedule());
  }

  private requestPermission(): void {
    const ctor = globalThis.DeviceOrientationEvent as OrientationCtor | undefined;
    if (!ctor?.requestPermission) return;
    ctor.requestPermission().then(state => { if (state === 'granted' && this.geolocate._watchState !== 'OFF') this.listen(true); }).catch(() => {});
  }

  private start(): void {
    const ctor = globalThis.DeviceOrientationEvent as OrientationCtor | undefined;
    // iOS needs the permission prompt first; it calls listen() once granted.
    if (ctor && !ctor.requestPermission) this.listen(true);
  }

  private stop(): void {
    this.listen(false);
    this.compass = null;
    this.gps = null;
    this.shown = null;
    this.schedule();
  }

  private listen(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    const absolute = 'ondeviceorientationabsolute' in window;
    const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    if (on) window.addEventListener(type, this.onOrientation as EventListener);
    else window.removeEventListener(type, this.onOrientation as EventListener);
  }

  private readonly onOrientation = (event: OrientationEvent): void => {
    let heading: number | null = null;
    if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
      heading = event.webkitCompassHeading;
    } else if ((event.absolute || event.type === 'deviceorientationabsolute') && event.alpha !== null) {
      heading = 360 - event.alpha;
    }
    if (heading === null || !Number.isFinite(heading)) return;
    const deg = norm(heading + screenAngle());
    this.compass = { deg, at: performance.now() };
    // Skip frames for sub-degree sensor noise.
    if (!this.visible || this.shown === null || Math.abs(delta(this.shown, deg)) > 0.5) this.schedule();
  };

  private onPosition(coords?: GeolocationCoordinates): void {
    if (coords && coords.heading !== null && Number.isFinite(coords.heading) && (coords.speed ?? 0) > MIN_GPS_SPEED) {
      this.gps = { deg: norm(coords.heading), at: performance.now() };
    }
    this.schedule();
  }

  private target(): number | null {
    const now = performance.now();
    if (this.compass && now - this.compass.at < COMPASS_FRESH_MS) return this.compass.deg;
    if (this.gps && now - this.gps.at < GPS_FRESH_MS) return this.gps.deg;
    return null;
  }

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.render);
  }

  private ensureCone(): HTMLElement | null {
    const dot = this.geolocate._dotElement;
    if (!dot) return null;
    if (!this.cone || this.cone.parentElement !== dot) {
      this.cone = document.createElement('div');
      this.cone.className = 'fhm-heading-cone';
      this.cone.style.display = 'none';
      dot.appendChild(this.cone);
    }
    return this.cone;
  }

  private readonly render = (): void => {
    this.frame = 0;
    const cone = this.ensureCone();
    const target = this.target();
    if (!cone) return;
    if (target === null || this.geolocate._watchState === 'OFF') {
      this.shown = null;
      if (this.visible) { cone.style.display = 'none'; this.visible = false; }
      return;
    }
    let settling = false;
    if (this.shown === null) this.shown = target;
    else {
      const d = delta(this.shown, target);
      if (Math.abs(d) > 0.3) { this.shown = norm(this.shown + d * 0.25); settling = true; }
      else this.shown = target;
    }
    cone.style.transform = `rotate(${(this.shown - this.map.getBearing()).toFixed(1)}deg)`;
    if (!this.visible) { cone.style.display = ''; this.visible = true; }
    if (settling) this.schedule();
  };
}
