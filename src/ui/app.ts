import { Capacitor } from '@capacitor/core';
import { categoryOf, type TypeVisibility } from '../organize/model';
import { useFeature } from '../usage';
import type { CloudSync } from '../sync/cloud';
import { loadSettings, type Settings } from './settings';
import { Popup, type MapMouseEvent } from 'maplibre-gl';
import { layerRegistry, layerSetting } from '../map/layerRegistry';
import { formatLatLng, haversine, locationFromSearch, pathLength, shortDistance } from '../map/geo';
import { HuntMap, LAYER_TRACKS, LAYER_WAYPOINTS } from '../map/map';
import { WindPlume } from '../map/windPlume';
import { clearRecordingService, drainFixes, recordingSession } from '../map/hikeRecorder';
import { TrackRecorder } from '../map/recorder';
import type { Repo } from '../storage/repo';
import type { RecordingPoint } from '../storage/db';
import type { Category, Item, LngLat, Track } from '../types';
import type { AppContext } from './context';
import { mountBasemapSwitch } from './basemapSwitch';
import { mountQuickLook } from './quickLook';
import { copyText, h, iconButton, toast } from './dom';
import { UI_ICONS } from './icons';
import { Sheet } from './sheet';
import type { Tool } from './tools';

const RECORD_SAVE_INTERVAL = 30_000;

export class App implements AppContext {
  readonly sheet: Sheet;
  sync?: CloudSync;
  readonly map: HuntMap;
  private readonly windPlume: WindPlume;
  private trailFinder: Promise<import('../lidar/lab').TrailFinder> | undefined;
  private lidar3d: Promise<import('../lidar/view3d').Lidar3d> | undefined;
  private liveItems: Item[] = [];
  private liveCategories: Category[] = [];
  private reloadVersion = 0;
  private preferenceVersion = 0;
  private tool: Tool | null = null;
  private recorder: TrackRecorder;
  private recording: Track | null = null;
  private recordingSave: Promise<void> = Promise.resolve();
  private recordingBusy = false;
  private pendingPoints: RecordingPoint[] = [];
  private lastRecordingSnapshot = 0;
  private stoppedCoords: LngLat[] | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private wakeLockPending = false;
  private recordingStarted = 0;
  private recordingDistance = 0;
  private recordingTimer = 0;
  private latestNativeSeq = 0;
  private nativeSeqTimer = 0;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly recChip: HTMLElement;

  private constructor(
    readonly repo: Repo,
    private settings: Settings,
    root: HTMLElement,
  ) {
    const mapEl = h('div', { id: 'map' });
    const sheetEl = h('section', { id: 'sheet', class: 'sheet', hidden: true, 'aria-live': 'polite' });
    this.recChip = h('div', { class: 'rec-chip', hidden: true, role: 'timer', 'aria-label': 'Recording time and distance' });
    const toolbar = this.buildToolbar();
    const offlineChip = h('div', { class: 'offline-chip', role: 'status', hidden: navigator.onLine }, 'Offline');
    const updateConnection = () => { offlineChip.hidden = navigator.onLine; };
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    root.append(mapEl, toolbar, offlineChip, this.recChip, sheetEl, h('div', { id: 'toast', role: 'status' }));
    this.sheet = new Sheet(sheetEl);
    const linked = locationFromSearch(location.search);
    this.map = new HuntMap(mapEl, settings, linked ?? settings.view, !!linked);
    this.windPlume = new WindPlume(this.map.map, this.map.geolocate, repo, settings.windPlume);
    const controls = mapEl.querySelector<HTMLElement>('.maplibregl-ctrl-top-left');
    if (controls) mountBasemapSwitch(this, controls, () => this.persistSettings());
    root.append(this.buildCoordChip());
    mountQuickLook(this, root, () => this.openLazyPanel('conditions', 'Conditions', () => import('./conditionsPanel').then(m => () => m.openConditionsPanel(this))));
    this.recorder = new TrackRecorder(
      (coords, pos, nativeSeq) => this.onRecordedPoint(coords, pos, nativeSeq),
      (err) => toast(err.message || 'GPS error'),
      (message) => {
        this.stoppedCoords = [...this.recorder.coords];
        this.recChip.hidden = true;
        clearInterval(this.recordingTimer);
        this.setRecordIcon(true);
        this.syncToolbar();
        this.queueRecordingSave(true);
        toast(message);
      },
      seq => this.noteNativeSeq(seq),
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
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.recorder.markHidden(); this.persistNativeSeq(); this.queueRecordingSave(true); }
      else {
        this.updateRecordingTimer();
        void this.requestRecordingWakeLock();
        if (this.recorder.active) void this.recorder.catchUp().then(() => this.queueRecordingSave(true));
      }
    });
    window.addEventListener('pagehide', () => { this.persistNativeSeq(); this.queueRecordingSave(true); });
  }

  static async start(root: HTMLElement, repo: Repo, saved?: Partial<Settings>, initialItems?: Promise<[Item[], Category[]]>): Promise<App> {
    const app = new App(repo, loadSettings(saved), root);
    await app.reloadItems(initialItems);
    await app.resumeRecording();
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

  setWindPlume(on: boolean): void { this.map.setWindPlume(on); this.windPlume.setEnabled(on); }

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
    this.setWindPlume(saved.windPlume);
    this.map.setCenterOnLocation(saved.centerOnLocation);
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
      add('layers', 'layers', 'Layers', () => this.openLazyPanel('layers', 'Layers', () => import('./layersPanel').then(m => () => m.openLayersPanel(this, () => this.persistSettings(), () => this.openTrailFinder(), () => this.openLidar3d())))),
      add('tool:waypoint', 'pin', 'Drop pin', () => this.toggleTool('waypoint')),
      add('tool:track', 'track', 'Draw track', () => this.toggleTool('track')),
      add('trails', 'scan', 'Trail finder', () => this.openTrailFinder()),
      add('lidar3d', 'lidar3d', '3D lidar', () => this.openLidar3d()),
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

  private openLidar3d(): void {
    this.togglePanel('lidar3d', () => {
      this.sheet.open('lidar3d', '3D lidar', h('progress', { 'aria-label': 'Loading 3D lidar' }));
      void this.getLidar3d().then(view => {
        if (this.sheet.current === 'lidar3d') view.open();
      }).catch(err => toast(String(err)));
    });
  }

  private getLidar3d(): Promise<import('../lidar/view3d').Lidar3d> {
    return this.lidar3d ??= import('../lidar/view3d').then(m => m.createLidar3d(this));
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
      const active = key === 'record' ? this.recorder.needsStop || this.stoppedCoords !== null : this.sheet.current === key || this.tool?.key === key.replace('tool:', '');
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
      if (this.recorder.needsStop || this.stoppedCoords) {
        if (this.recorder.needsStop) {
          this.stoppedCoords = [...this.recorder.coords];
          void this.wakeLock?.release().catch(() => {});
          this.wakeLock = null;
          try {
            this.stoppedCoords = [...await this.recorder.stop()];
          } catch {
            this.setRecordIcon(true);
            this.syncToolbar();
            toast('Could not save recording. Tap stop to retry.');
            return;
          }
        }
        const coords = this.stoppedCoords!;
        const track = this.recording;
        this.persistNativeSeq();
        await this.recordingSave;
        await this.flushRecordingPoints();
        if (track) {
          if (coords.length < 2) await this.repo.remove(track.id);
          else {
            const saved = await this.repo.update(track, { coords, segments: [...this.recorder.segments] });
            this.openItem(saved);
          }
        }
        if (track) await this.repo.clearRecording(track.id, coords.length >= 2);
        if (Capacitor.getPlatform() === 'android') await clearRecordingService();
        this.recording = null;
        this.stoppedCoords = null;
        this.recChip.hidden = true;
        clearInterval(this.recordingTimer);
        this.recordingStarted = 0;
        this.recordingDistance = 0;
        this.setRecordIcon(false);
        this.syncToolbar();
        return;
      }
      if (!Capacitor.isNativePlatform() && !('geolocation' in navigator)) return toast('GPS unavailable');
      const name = `Track ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
      this.recording = await this.repo.create<Track>({ kind: 'track', name, note: '', coords: [], recorded: true });
      try {
        this.recordingStarted = await this.repo.beginRecording(this.recording.id);
        this.latestNativeSeq = 0;
        const android = Capacitor.getPlatform() === 'android';
        if (android) await this.repo.setMeta('recording.nativeSeq', { trackId: this.recording.id, seq: 0 });
        await this.recorder.start([], [], 0, 0, android ? { trackId: this.recording.id, since: 0 } : undefined);
      } catch (error) {
        this.stoppedCoords = [];
        try { await this.recorder.stop(); } catch { /* Start never armed the watcher. */ }
        if (Capacitor.getPlatform() === 'android') await clearRecordingService().catch(() => {});
        await this.repo.remove(this.recording.id);
        await this.repo.clearRecording(this.recording.id);
        this.recording = null;
        this.stoppedCoords = null;
        toast(error instanceof Error && error.message ? error.message : 'Could not start GPS');
        return;
      }
      useFeature('track_record');
      if (this.map.geolocate._watchState === 'OFF') this.map.geolocate.trigger();
      this.recChip.hidden = false;
      this.startRecordingTimer();
      this.setRecordIcon(true);
      this.syncToolbar();
      void this.requestRecordingWakeLock();
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

  private async requestRecordingWakeLock(): Promise<void> {
    if (Capacitor.isNativePlatform() || !this.recorder.active || document.hidden || this.wakeLock || this.wakeLockPending || !navigator.wakeLock) return;
    this.wakeLockPending = true;
    const track = this.recording;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!this.recorder.active || document.hidden || this.recording !== track) {
        await lock.release();
        return;
      }
      this.wakeLock = lock;
      lock.addEventListener('release', () => { if (this.wakeLock === lock) this.wakeLock = null; });
    } catch { /* Wake lock may be unavailable or denied. */ }
    finally { this.wakeLockPending = false; }
  }

  private startRecordingTimer(): void {
    clearInterval(this.recordingTimer);
    this.updateRecordingTimer();
    this.recordingTimer = window.setInterval(() => this.updateRecordingTimer(), 1000);
  }

  private updateRecordingTimer(): void {
    if (!this.recordingStarted) return;
    const seconds = Math.max(0, Math.floor((Date.now() - this.recordingStarted) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const tail = String(seconds % 60).padStart(2, '0');
    const elapsed = hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
    this.recChip.textContent = `${elapsed} · ${shortDistance(this.recordingDistance)}`;
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

  private async resumeRecording(): Promise<void> {
    try {
      if (Capacitor.getPlatform() === 'android') await this.recoverNativeRecording();
      const active = await this.repo.activeRecording();
      if (!active) return;
      const track = await this.repo.get(active.trackId);
      const points = await this.repo.recordingPoints(active.trackId);
      if (!track || track.deleted || track.kind !== 'track') {
        await this.repo.clearRecording(active.trackId);
        if (Capacitor.getPlatform() === 'android') await clearRecordingService().catch(() => {});
        return;
      }
      const coords = points.map(point => point.coord);
      const session = Capacitor.getPlatform() === 'android' ? await recordingSession() : null;
      const since = await this.nativeSince(track.id, points);
      if (coords.length < 2 && !session?.recording && (session ? (await drainFixes(since)).length : 0) === 0) {
        await this.repo.remove(track.id);
        await this.repo.clearRecording(track.id);
        if (session) await clearRecordingService().catch(() => {});
        return;
      }
      this.recording = track;
      const segments = points.filter(point => point.segmentStart).map(point => point.index);
      this.latestNativeSeq = since;
      try {
        await this.recorder.start(coords, segments, points.at(-1)?.t ?? 0, points.at(-1)?.acc ?? 0, session ? { trackId: track.id, since } : undefined);
      } catch {
        this.stoppedCoords = [...this.recorder.coords];
        toast('Could not resume GPS. Stop recording to save it.');
      }
      this.recChip.hidden = this.stoppedCoords !== null;
      this.recordingStarted = active.started;
      this.recordingDistance = pathLength(this.stoppedCoords ?? this.recorder.coords, this.recorder.segments);
      if (!this.stoppedCoords) this.startRecordingTimer();
      this.setRecordIcon(true);
      this.syncToolbar();
      void this.requestRecordingWakeLock();
      this.queueRecordingSave(true);
    } catch {
      toast('Could not resume recording');
    }
  }

  private async recoverNativeRecording(): Promise<void> {
    const status = await recordingSession();
    if (!status.trackId) return;
    if (await this.repo.activeRecording()) return;
    if (!status.recording) {
      await clearRecordingService();
      return;
    }
    const track = await this.repo.get(status.trackId);
    if (!track || track.deleted || track.kind !== 'track') {
      await clearRecordingService();
      return;
    }
    await this.repo.setMeta('active-recording', { trackId: status.trackId, started: status.startedAt, paused: false });
  }

  private async nativeSince(trackId: string, points: RecordingPoint[]): Promise<number> {
    const marker = await this.repo.getMeta<{ trackId: string; seq: number }>('recording.nativeSeq');
    const fromPoints = points.reduce((max, point) => Math.max(max, point.nativeSeq ?? 0), 0);
    return Math.max(fromPoints, marker?.trackId === trackId ? marker.seq : 0);
  }

  private noteNativeSeq(seq: number): void {
    if (seq <= this.latestNativeSeq) return;
    this.latestNativeSeq = seq;
    clearTimeout(this.nativeSeqTimer);
    this.nativeSeqTimer = window.setTimeout(() => this.persistNativeSeq(), 1000);
  }

  private persistNativeSeq(): void {
    clearTimeout(this.nativeSeqTimer);
    const track = this.recording;
    const seq = this.latestNativeSeq;
    if (!track || seq <= 0) return;
    this.recordingSave = this.recordingSave.then(() => this.repo.setMeta('recording.nativeSeq', { trackId: track.id, seq })).catch(() => {});
  }

  private onRecordedPoint(coords: LngLat[], pos: GeolocationPosition, nativeSeq?: number): void {
    if (coords.length > 1 && !this.recorder.segments.includes(coords.length - 1)) this.recordingDistance += haversine(coords[coords.length - 2]!, coords[coords.length - 1]!);
    this.updateRecordingTimer();
    const track = this.recording;
    if (!track) return;
    this.pendingPoints.push({ trackId: track.id, index: coords.length - 1, coord: coords[coords.length - 1]!,
      t: pos.timestamp, acc: pos.coords.accuracy, alt: pos.coords.altitude, altAcc: pos.coords.altitudeAccuracy, segmentStart: this.recorder.segments.includes(coords.length - 1), ...(nativeSeq ? { nativeSeq } : {}) });
    this.queueRecordingSave(Date.now() - this.lastRecordingSnapshot >= RECORD_SAVE_INTERVAL);
  }

  private async flushRecordingPoints(): Promise<void> {
    while (this.pendingPoints.length) {
      await this.repo.appendRecordingPoint(this.pendingPoints[0]!);
      this.pendingPoints.shift();
    }
  }

  private queueRecordingSave(snapshot: boolean): void {
    const track = this.recording;
    if (!track) return;
    const coords = snapshot ? [...this.recorder.coords] : null;
    const segments = snapshot ? [...this.recorder.segments] : [];
    if (snapshot) this.lastRecordingSnapshot = Date.now();
    this.recordingSave = this.recordingSave.then(async () => {
      await this.flushRecordingPoints();
      if (coords && coords.length >= 2) await this.repo.update(track, { coords, segments });
    }).catch(() => { toast('Could not save recording'); });
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
