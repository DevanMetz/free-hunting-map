import type { MapMouseEvent } from 'maplibre-gl';
import { clampLabelScale } from '../map/labels';
import { pathLength, shortDistance } from '../map/geo';
import { HuntMap, LAYER_TRACKS, LAYER_WAYPOINTS, type MapState, type MapView } from '../map/map';
import { TrackRecorder } from '../map/recorder';
import type { Repo } from '../storage/repo';
import type { Item, LngLat, Track } from '../types';
import { openConditionsPanel } from './conditionsPanel';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';
import { UI_ICONS } from './icons';
import { openItemPanel } from './itemPanel';
import { openLayersPanel } from './layersPanel';
import { openListPanel } from './listPanel';
import { openSharePanel } from './sharePanel';
import { Sheet } from './sheet';
import { lineTool, waypointTool, type Tool } from './tools';

interface Settings extends MapState {
  view: MapView;
}

const DEFAULT_SETTINGS: Settings = {
  basemap: 'topo',
  publicLands: false,
  labels: true,
  labelScale: 1,
  view: { center: [-98.5, 39.8], zoom: 3.5 },
};

const RECORD_SAVE_EVERY = 5;

export class App implements AppContext {
  readonly sheet: Sheet;
  readonly map: HuntMap;
  private liveItems: Item[] = [];
  private tool: Tool | null = null;
  private recorder: TrackRecorder;
  private recording: Track | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly recChip: HTMLElement;

  private constructor(
    readonly repo: Repo,
    private settings: Settings,
    root: HTMLElement,
  ) {
    const mapEl = h('div', { id: 'map' });
    const sheetEl = h('section', { id: 'sheet', class: 'sheet', hidden: true, 'aria-live': 'polite' });
    this.recChip = h('div', { class: 'rec-chip', hidden: true, role: 'status' });
    const toolbar = this.buildToolbar();
    root.append(mapEl, toolbar, this.recChip, sheetEl, h('div', { id: 'toast', role: 'status' }));

    this.sheet = new Sheet(sheetEl);
    this.map = new HuntMap(mapEl, { basemap: settings.basemap, publicLands: settings.publicLands, labels: settings.labels, labelScale: settings.labelScale }, settings.view);
    this.recorder = new TrackRecorder(
      (coords) => void this.onRecordedPoint(coords),
      (err) => toast(err.message || 'GPS error'),
    );

    this.map.map.on('click', (e) => this.onMapClick(e));
    this.map.map.on('moveend', () => this.persistSettings());
    for (const layer of [LAYER_WAYPOINTS, LAYER_TRACKS]) {
      this.map.map.on('mouseenter', layer, () => (this.map.map.getCanvas().style.cursor = 'pointer'));
      this.map.map.on('mouseleave', layer, () => (this.map.map.getCanvas().style.cursor = ''));
    }
    repo.addEventListener('change', () => void this.reloadItems());
    document.addEventListener('sheet-closed', () => this.syncToolbar());
  }

  static async start(root: HTMLElement, repo: Repo): Promise<App> {
    const saved = await repo.getMeta<Partial<Settings>>('settings');
    const app = new App(repo, { ...DEFAULT_SETTINGS, ...saved, labelScale: clampLabelScale(saved?.labelScale) }, root);
    await app.reloadItems();
    return app;
  }

  items(): Item[] {
    return this.liveItems;
  }

  openItem(item: Item): void {
    this.setTool(null);
    openItemPanel(this, item);
    this.syncToolbar();
  }

  private async reloadItems(): Promise<void> {
    this.liveItems = await this.repo.list();
    this.map.setItems(this.liveItems);
  }

  private buildToolbar(): HTMLElement {
    const add = (key: string, icon: keyof typeof UI_ICONS, label: string, fn: () => void): HTMLButtonElement => {
      const b = iconButton(icon, label, fn);
      this.buttons.set(key, b);
      return b;
    };
    return h(
      'nav',
      { class: 'toolbar', 'aria-label': 'Tools' },
      add('layers', 'layers', 'Layers', () => this.togglePanel('layers', () => openLayersPanel(this, () => this.persistSettings()))),
      add('tool:waypoint', 'pin', 'Drop pin', () => this.toggleTool('waypoint')),
      add('tool:track', 'track', 'Draw track', () => this.toggleTool('track')),
      add('record', 'record', 'Record GPS track', () => void this.toggleRecording()),
      add('tool:measure', 'measure', 'Measure', () => this.toggleTool('measure')),
      add('list', 'list', 'Saved', () => this.togglePanel('list', () => openListPanel(this))),
      add('share', 'share', 'Share', () => this.togglePanel('share', () => openSharePanel(this))),
      add('conditions', 'weather', 'Conditions', () => this.togglePanel('conditions', () => openConditionsPanel(this))),
    );
  }

  private togglePanel(key: string, open: () => void): void {
    if (this.sheet.current === key) {
      this.sheet.close();
      return;
    }
    this.setTool(null);
    open();
    this.syncToolbar();
  }

  private toggleTool(key: Tool['key']): void {
    if (this.tool?.key === key) {
      this.sheet.close();
      return;
    }
    this.setTool(null);
    const done = (): void => this.setTool(null);
    this.tool = key === 'waypoint' ? waypointTool(this, done) : lineTool(this, key, done);
    document.body.dataset.tool = key;
    this.syncToolbar();
  }

  private setTool(tool: Tool | null): void {
    if (this.tool && this.tool !== tool) {
      const old = this.tool;
      this.tool = null;
      old.stop();
    }
    this.tool = tool;
    if (!tool) delete document.body.dataset.tool;
    this.syncToolbar();
  }

  private syncToolbar(): void {
    for (const [key, btn] of this.buttons) {
      const active = key === 'record' ? this.recorder.active : this.sheet.current === key || this.tool?.key === key.replace('tool:', '');
      btn.classList.toggle('active', Boolean(active));
      btn.setAttribute('aria-pressed', String(Boolean(active)));
    }
  }

  private onMapClick(e: MapMouseEvent): void {
    const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (this.tool) {
      this.tool.onMapClick(at);
      return;
    }
    const { x, y } = e.point;
    const r = 10;
    const layers = [LAYER_WAYPOINTS, LAYER_TRACKS].filter((l) => this.map.map.getLayer(l));
    const hit = this.map.map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers })[0];
    const id = hit?.properties?.id as string | undefined;
    const item = id ? this.liveItems.find((i) => i.id === id) : undefined;
    if (item) this.openItem(item);
  }

  private async toggleRecording(): Promise<void> {
    if (this.recorder.active) {
      const coords = this.recorder.stop();
      const track = this.recording;
      this.recording = null;
      void this.wakeLock?.release().catch(() => {});
      this.wakeLock = null;
      this.recChip.hidden = true;
      this.setRecordIcon(false);
      if (track) {
        if (coords.length < 2) await this.repo.remove(track.id);
        else {
          const saved = await this.repo.update(track, { coords: [...coords] });
          this.openItem(saved);
        }
      }
      this.syncToolbar();
      return;
    }
    if (!('geolocation' in navigator)) return toast('GPS unavailable');
    const name = `Track ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    this.recording = await this.repo.create<Track>({ kind: 'track', name, note: '', coords: [], recorded: true });
    this.recorder.start();
    if (this.map.geolocate._watchState === 'OFF') this.map.geolocate.trigger();
    this.wakeLock = await navigator.wakeLock?.request('screen').catch(() => null) ?? null;
    this.recChip.hidden = false;
    this.recChip.textContent = shortDistance(0);
    this.setRecordIcon(true);
    this.syncToolbar();
  }

  private setRecordIcon(recording: boolean): void {
    const b = this.buttons.get('record');
    if (b) b.innerHTML = UI_ICONS[recording ? 'stop' : 'record'];
  }

  private async onRecordedPoint(coords: LngLat[]): Promise<void> {
    this.recChip.textContent = shortDistance(pathLength(coords));
    if (this.recording && coords.length % RECORD_SAVE_EVERY === 0) {
      this.recording = await this.repo.update(this.recording, { coords: [...coords] });
    }
  }

  private persistTimer = 0;
  private persistSettings(): void {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      this.settings = { ...this.map.mapState, view: this.map.view() };
      void this.repo.setMeta('settings', this.settings);
    }, 400);
  }
}
