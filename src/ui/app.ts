import { categoryOf, type TypeVisibility } from '../organize/model';
import { useFeature } from '../usage';
import type { CloudSync } from '../sync/cloud';
import { loadSettings, type Settings } from './settings';
import { Popup, type MapMouseEvent } from 'maplibre-gl';
import { layerRegistry, layerSetting } from '../map/layerRegistry';
import { formatLatLng, locationFromSearch, pathLength, shortDistance } from '../map/geo';
import { HuntMap, LAYER_TRACKS, LAYER_WAYPOINTS } from '../map/map';
import { TrackRecorder } from '../map/recorder';
import type { Repo } from '../storage/repo';
import type { Category, Item, LngLat, Track } from '../types';
import type { AppContext } from './context';
import { mountBasemapSwitch } from './basemapSwitch';
import { mountQuickLook } from './quickLook';
import { copyText, h, iconButton, toast } from './dom';
import { UI_ICONS } from './icons';
import { Sheet } from './sheet';
import type { Tool } from './tools';

const RECORD_SAVE_EVERY = 5;

export class App implements AppContext {
  readonly sheet: Sheet;
  sync?: CloudSync;
  readonly map: HuntMap;
  private trailFinder: Promise<import('../lidar/lab').TrailFinder> | undefined;
  private liveItems: Item[] = [];
  private liveCategories: Category[] = [];
  private reloadVersion = 0;
  private preferenceVersion = 0;
  private tool: Tool | null = null;
  private recorder: TrackRecorder;
  private recording: Track | null = null;
  private recordingSave: Promise<void> = Promise.resolve();
  private recordingBusy = false;
  private stoppedCoords: LngLat[] | null = null;
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
    const offlineChip = h('div', { class: 'offline-chip', role: 'status', hidden: navigator.onLine }, 'Offline');
    const updateConnection = () => { offlineChip.hidden = navigator.onLine; };
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    root.append(mapEl, toolbar, offlineChip, this.recChip, sheetEl, h('div', { id: 'toast', role: 'status' }));
    this.sheet = new Sheet(sheetEl);
    const linked = locationFromSearch(location.search);
    this.map = new HuntMap(mapEl, settings, linked ?? settings.view);
    const controls = mapEl.querySelector<HTMLElement>('.maplibregl-ctrl-top-left');
    if (controls) mountBasemapSwitch(this, controls, () => this.persistSettings());
    root.append(this.buildCoordChip());
    mountQuickLook(this, root, () => this.openLazyPanel('conditions', 'Conditions', () => import('./conditionsPanel').then(m => () => m.openConditionsPanel(this))));
    this.recorder = new TrackRecorder(
      (coords) => void this.onRecordedPoint(coords),
      (err) => toast(err.message || 'GPS error'),
    );

    this.map.map.on('click', (e) => {
      if (!document.querySelector('[data-lidar-drawing]')) this.onMapClick(e);
    });
    this.map.map.on('moveend', () => this.persistSettings());
    this.map.map.on('move', () => this.scheduleCoordChip());
    for (const layer of [LAYER_WAYPOINTS, LAYER_TRACKS]) {
      this.map.map.on('mouseenter', layer, () => (this.map.map.getCanvas().style.cursor = 'pointer'));
      this.map.map.on('mouseleave', layer, () => (this.map.map.getCanvas().style.cursor = ''));
    }
    repo.addEventListener('change', () => void this.reloadItems());
    repo.addEventListener('preferences', () => void this.applyPreferences());
    document.addEventListener('sheet-closed', () => this.syncToolbar());
  }

  static async start(root: HTMLElement, repo: Repo, saved?: Partial<Settings>, initialItems?: Promise<[Item[], Category[]]>): Promise<App> {
    const app = new App(repo, loadSettings(saved), root);
    await app.reloadItems(initialItems);
    void app.startAccount(root);
    return app;
  }

  private async startAccount(root: HTMLElement): Promise<void> {
    try {
      const [{ CloudSync }, { accountControl }] = await Promise.all([
        import('../sync/cloud'), import('./accountPanel'),
      ]);
      const sync = this.sync = new CloudSync(this.repo);
      const toolbar = root.querySelector<HTMLElement>('.toolbar')!;
      // Keep the mobile iframe outside the bottom rail's compositor bounds.
      const desktop = window.matchMedia('(min-width: 760px)');
      let account: HTMLElement | undefined;
      let lifetime: AbortController | undefined;
      const placeAccount = () => {
        lifetime?.abort();
        account?.remove();
        lifetime = new AbortController();
        account = accountControl(sync, lifetime.signal);
        (desktop.matches ? toolbar : root).append(account);
      };
      desktop.addEventListener('change', placeAccount);
      placeAccount();
      await sync.start();
    } catch (err) {
      console.error('Account sync could not start:', err);
    }
  }

  items(): Item[] {
    return this.liveItems;
  }

  categories(): Category[] { return this.liveCategories; }
  visibility(): TypeVisibility {
    const { showPins, showTrails, showRecordings } = this.map.mapState;
    const savedOn = this.map.mapState.layers['my-items']?.on !== false;
    return { showPins: savedOn && showPins, showTrails: savedOn && showTrails, showRecordings: savedOn && showRecordings };
  }
  async setTypeVisibility(patch: Partial<TypeVisibility>): Promise<void> {
    this.preferenceVersion++;
    if (Object.values(patch).some(Boolean) && this.map.mapState.layers['my-items']?.on === false) this.map.setLayer('my-items', true);
    this.map.setTypeVisibility(patch);
    const state = { ...this.map.mapState, view: this.map.view() };
    const saved = await this.repo.getMeta<Partial<Settings>>('settings');
    await this.repo.setMeta('settings', { ...saved, ...state });
  }
  async revealItem(item: Item): Promise<Item> {
    const current = await this.repo.get(item.id) ?? item;
    const category = categoryOf(current, await this.repo.categories());
    if (category?.hidden) await this.repo.updateCategory(category, { hidden: false });
    const key = current.kind === 'waypoint' ? 'showPins' : current.recorded ? 'showRecordings' : 'showTrails';
    if (!this.visibility()[key]) await this.setTypeVisibility({ [key]: true });
    return current.hidden ? this.repo.update(current, { hidden: false }) : current;
  }

  openItem(item: Item): void {
    this.setTool(null);
    const loading = h('progress', { 'aria-label': 'Loading item' });
    this.sheet.open('item', item.name || (item.kind === 'waypoint' ? 'Pin' : 'Track'), loading);
    this.syncToolbar();
    void import('./itemPanel').then(({ openItemPanel }) => {
      if (loading.isConnected) openItemPanel(this, item);
    }).catch(err => {
      if (loading.isConnected) this.sheet.close();
      toast(String(err));
    });
  }

  private async reloadItems(initialItems?: Promise<[Item[], Category[]]>): Promise<void> {
    const version = ++this.reloadVersion;
    const [items, categories] = await (initialItems ?? Promise.all([this.repo.list(), this.repo.categories()]));
    if (version !== this.reloadVersion) return;
    this.liveItems = items;
    this.liveCategories = categories;
    this.map.setItems(this.liveItems, categories);
    // Restoring the trail finder is independent of displaying saved map items.
    // Do not hold startup (and community reconciliation) on this extra read.
    if (!this.trailFinder) void this.repo.listLidarRuns().then(runs => {
      if (runs.length) return this.getTrailFinder();
    }).catch(err => toast(String(err)));
  }

  private async applyPreferences(): Promise<void> {
    const version = ++this.preferenceVersion;
    const saved = loadSettings(await this.repo.getMeta<Partial<Settings>>('settings'));
    if (version !== this.preferenceVersion) return;
    const current = this.map.mapState;
    if (current.basemap !== saved.basemap) this.map.setBasemap(saved.basemap);
    this.map.setLabels(saved.labels);
    this.map.setLabelScale(saved.labelScale);
    for (const [id, value] of Object.entries(saved.layers)) {
      this.map.setLayerVariant(id, value.variant);
      this.map.setLayer(id, value.on);
      this.map.setLayerOpacity(id, value.opacity);
    }
    this.map.setLayerOrder(saved.layerOrder ?? []);
    for (const [id, collapsed] of Object.entries(saved.collapsed)) this.map.setCategoryCollapsed(id, collapsed);
    for (const [id, ids] of Object.entries(saved.remembered)) this.map.setCategoryRemembered(id, ids);
    this.map.setTypeVisibility(saved);
  }

  private coordFrame = 0;
  private readonly coordChip = h('button', { type: 'button', class: 'coord-chip', title: 'Coordinates' });

  private buildCoordChip(): HTMLButtonElement {
    this.buttons.set('goto', this.coordChip);
    this.coordChip.addEventListener('click', () => this.openLazyPanel('goto', 'Search land or coordinates', () => import('./goTo').then(m => () => m.openGoTo(this))));
    this.updateCoordChip();
    return this.coordChip;
  }

  private scheduleCoordChip(): void {
    if (this.coordFrame) return;
    this.coordFrame = requestAnimationFrame(() => {
      this.coordFrame = 0;
      this.updateCoordChip();
    });
  }

  private updateCoordChip(): void {
    const label = formatLatLng(this.map.view().center);
    this.coordChip.textContent = label;
    this.coordChip.setAttribute('aria-label', `Coordinates ${label}`);
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
      add('layers', 'layers', 'Layers', () => this.openLazyPanel('layers', 'Layers', () => import('./layersPanel').then(m => () => m.openLayersPanel(this, () => this.persistSettings(), () => this.openTrailFinder())))),
      add('tool:waypoint', 'pin', 'Drop pin', () => this.toggleTool('waypoint')),
      add('tool:track', 'track', 'Draw track', () => this.toggleTool('track')),
      add('trails', 'scan', 'Trail finder', () => this.openTrailFinder()),
      add('record', 'record', 'Record GPS track', () => void this.toggleRecording()),
      add('tool:measure', 'measure', 'Measure', () => this.toggleTool('measure')),
      add('list', 'list', 'Organize', () => this.openLazyPanel('list', 'Organize', () => import('./listPanel').then(m => () => m.openListPanel(this)))),
      add('share', 'share', 'Share', () => this.openLazyPanel('share', 'Share', () => import('./sharePanel').then(m => () => m.openSharePanel(this)))),
      add('conditions', 'weather', 'Conditions', () => this.openLazyPanel('conditions', 'Conditions', () => import('./conditionsPanel').then(m => () => m.openConditionsPanel(this)))),
    );
  }

  private openTrailFinder(): void {
    this.togglePanel('trails', () => {
      this.sheet.open('trails', 'Trail finder', h('progress', { 'aria-label': 'Loading trail finder' }));
      void this.getTrailFinder().then(f => {
        if (this.sheet.current === 'trails') f.open();
      }).catch(err => toast(String(err)));
    });
  }

  private getTrailFinder(): Promise<import('../lidar/lab').TrailFinder> {
    return this.trailFinder ??= import('../lidar/lab').then(m => m.createTrailFinder(this));
  }

  private openLazyPanel(key: string, title: string, load: () => Promise<() => void>): void {
    this.togglePanel(key, () => {
      const loading = h('progress', { 'aria-label': `Loading ${title}` });
      this.sheet.open(key, title, loading);
      void load().then(open => {
        if (this.sheet.current === key && loading.isConnected) open();
      }).catch(err => {
        if (loading.isConnected) this.sheet.close();
        toast(String(err));
      });
    });
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
    const title = key === 'waypoint' ? 'Drop pin' : key === 'track' ? 'Draw track' : 'Measure';
    this.openLazyPanel(`tool:${key}`, title, async () => {
      const { waypointTool, lineTool } = await import('./tools');
      return () => {
        const done = (): void => this.setTool(null);
        this.tool = key === 'waypoint' ? waypointTool(this, done) : lineTool(this, key, done);
        document.body.dataset.tool = key;
        this.syncToolbar();
      };
    });
  }

  private setTool(tool: Tool | null): void {
    this.identifyRequest?.abort();
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
      const active = key === 'record' ? this.recorder.active || this.stoppedCoords !== null : this.sheet.current === key || this.tool?.key === key.replace('tool:', '');
      btn.classList.toggle('active', Boolean(active));
      btn.setAttribute('aria-pressed', String(Boolean(active)));
    }
  }

  private inspectPopup: Popup | null = null;
  private identifyRequest: AbortController | null = null;

  private onMapClick(e: MapMouseEvent): void {
    this.identifyRequest?.abort();
    this.inspectPopup?.remove();
    this.inspectPopup = null;
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
    if (item) { this.openItem(item); return; }
    void this.identifyLayers(e, at);
  }

  private async identifyLayers(e: MapMouseEvent, at: LngLat): Promise<void> {
    const request = new AbortController();
    this.identifyRequest = request;
    const state = this.map.mapState;
    const enabled = layerRegistry.layers().filter(def => def.identify && layerSetting(state, def).on &&
      (def.minzoom === undefined || this.map.map.getZoom() >= def.minzoom) &&
      (def.maxzoom === undefined || this.map.map.getZoom() < def.maxzoom));
    if (!enabled.length) return;
    const content = h('div', { class: 'inspect-content' });
    const sections = new Map<number, HTMLElement>();
    const coordText = formatLatLng(at);
    const coords = h('div', { class: 'inspect-coords' }, h('span', { class: 'mono' }, coordText), iconButton('copy', 'Copy coordinates', () => {
      void copyText(coordText);
    }));
    const popup = new Popup({ closeButton: true, className: 'inspect-popup', maxWidth: '320px' });
    this.inspectPopup = popup;
    popup.on('close', () => request.abort());
    enabled.forEach((def, order) => {
      void def.identify!(...at, request.signal, this.map.map, e.point).then(async result => {
        if (!result || request.signal.aborted || this.inspectPopup !== popup || !layerSetting(this.map.mapState, def).on) return;
        const { identifyContent } = await import('./identifyPanel');
        if (request.signal.aborted || this.inspectPopup !== popup || !layerSetting(this.map.mapState, def).on) return;
        sections.set(order, h('section', {}, result.title ? h('strong', {}, result.title) : null, identifyContent(result)));
        content.replaceChildren(coords, ...[...sections].sort(([a], [b]) => a - b).map(([, section]) => section));
        if (!popup.isOpen()) {
          popup.setLngLat(at).setDOMContent(content).addTo(this.map.map);
          const close = popup.getElement()?.querySelector<HTMLButtonElement>('.maplibregl-popup-close-button');
          close?.setAttribute('aria-label', 'Close');
          close?.setAttribute('title', 'Close');
        }
      }).catch(() => {});
    });
  }

  private async toggleRecording(): Promise<void> {
    if (this.recordingBusy) return;
    this.recordingBusy = true;
    const button = this.buttons.get('record');
    if (button) button.disabled = true;
    try {
      if (this.recorder.active || this.stoppedCoords) {
        if (this.recorder.active) {
          this.stoppedCoords = [...this.recorder.stop()];
          void this.wakeLock?.release().catch(() => {});
          this.wakeLock = null;
        }
        const coords = this.stoppedCoords!;
        const track = this.recording;
        await this.recordingSave;
        if (track) {
          if (coords.length < 2) await this.repo.remove(track.id);
          else {
            const saved = await this.repo.update(track, { coords });
            this.openItem(saved);
          }
        }
        this.recording = null;
        this.stoppedCoords = null;
        this.recChip.hidden = true;
        this.setRecordIcon(false);
        this.syncToolbar();
        return;
      }
      if (!('geolocation' in navigator)) return toast('GPS unavailable');
      const name = `Track ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
      this.recording = await this.repo.create<Track>({ kind: 'track', name, note: '', coords: [], recorded: true });
      try {
        this.recorder.start();
      } catch {
        this.stoppedCoords = [];
        await this.repo.remove(this.recording.id);
        this.recording = null;
        this.stoppedCoords = null;
        toast('Could not start GPS');
        return;
      }
      useFeature('track_record');
      if (this.map.geolocate._watchState === 'OFF') this.map.geolocate.trigger();
      this.recChip.hidden = false;
      this.recChip.textContent = shortDistance(0);
      this.setRecordIcon(true);
      this.syncToolbar();
      const track = this.recording;
      void navigator.wakeLock?.request('screen').then(lock => {
        if (this.recorder.active && this.recording === track) this.wakeLock = lock;
        else void lock.release().catch(() => {});
      }).catch(() => {});
    } catch {
      if (this.stoppedCoords) {
        this.setRecordIcon(true);
        this.syncToolbar();
        toast('Could not save recording. Tap stop to retry.');
      } else toast('Could not start recording');
    } finally {
      this.recordingBusy = false;
      if (button) button.disabled = false;
    }
  }

  private setRecordIcon(recording: boolean): void {
    const b = this.buttons.get('record');
    if (b) {
      b.innerHTML = UI_ICONS[recording ? 'stop' : 'record'];
      const label = recording ? 'Stop GPS recording' : 'Record GPS track';
      b.setAttribute('aria-label', label);
      b.title = label;
    }
  }

  private onRecordedPoint(coords: LngLat[]): void {
    this.recChip.textContent = shortDistance(pathLength(coords));
    const track = this.recording;
    if (track && coords.length % RECORD_SAVE_EVERY === 0) {
      const snapshot = [...coords];
      this.recordingSave = this.recordingSave.then(async () => {
        await this.repo.update(track, { coords: snapshot });
      }).catch(() => { toast('Could not save recording'); });
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
