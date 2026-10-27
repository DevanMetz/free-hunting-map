import { useFeature } from '../usage';
import { formatDistance, pathLength, roundCoord } from '../map/geo';
import type { LngLat, Track, Waypoint, WaypointIcon } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';
import { iconPicker } from './itemDisplay';

/** An interactive map mode. The App routes map clicks to the active tool. */
export interface Tool {
  key: 'waypoint' | 'track' | 'measure';
  onMapClick(at: LngLat): void;
  /** Called when the tool is deactivated for any reason. */
  stop(): void;
}

export function waypointTool(ctx: AppContext, done: () => void): Tool {
  let icon: WaypointIcon = 'pin';

  const drop = async (coord: LngLat): Promise<void> => {
    const wp = await ctx.repo.create<Waypoint>({ kind: 'waypoint', name: '', note: '', icon, coord: roundCoord(coord) });
    done();
    useFeature('marker_add');
    ctx.openItem(wp);
  };

  const dropHere = (): void => {
    navigator.geolocation.getCurrentPosition(
      (p) => void drop([p.coords.longitude, p.coords.latitude]),
      (e) => toast(e.message || 'Location unavailable'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    );
  };

  const body = h(
    'div',
    { class: 'form' },
    iconPicker(icon, (i) => (icon = i)),
    h('div', { class: 'actions' }, iconButton('locate', 'Drop at my location', dropHere), h('span', { class: 'crosshair-hint', 'aria-hidden': 'true' })),
  );
  ctx.sheet.open('tool:waypoint', 'Drop pin', body, done);

  return {
    key: 'waypoint',
    onMapClick: (at) => void drop(at),
    stop: () => {},
  };
}

/** Polyline tool used for both drawing tracks and measuring. */
export function lineTool(ctx: AppContext, kind: 'track' | 'measure', done: () => void): Tool {
  const coords: LngLat[] = [];
  const color = kind === 'measure' ? '#ffd54f' : '#ff7043';
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' });

  const update = (): void => {
    ctx.map.setSketch(coords, color);
    const d = formatDistance(pathLength(coords));
    readout.replaceChildren(
      h('strong', {}, d.imperial),
      h('span', {}, d.feet),
      h('span', {}, d.metric),
    );
  };

  const undo = (): void => {
    coords.pop();
    update();
  };

  const save = async (): Promise<void> => {
    if (coords.length < 2) return toast('Add at least 2 points');
    const track = await ctx.repo.create<Track>({ kind: 'track', name: '', note: '', coords: [...coords], recorded: false });
    done();
    ctx.openItem(track);
  };

  const actions =
    kind === 'track'
      ? h('div', { class: 'actions' }, iconButton('undo', 'Undo', undo), h('button', { type: 'button', class: 'btn primary', onclick: () => void save() }, 'Save'))
      : h(
          'div',
          { class: 'actions' },
          iconButton('undo', 'Undo', undo),
          iconButton('trash', 'Clear', () => {
            coords.length = 0;
            update();
          }),
        );

  ctx.sheet.open(`tool:${kind}`, kind === 'track' ? 'Draw track' : 'Measure', h('div', { class: 'form' }, readout, actions), done);
  update();

  return {
    key: kind,
    onMapClick: (at) => {
      coords.push(roundCoord(at));
      update();
    },
    stop: () => ctx.map.setSketch([]),
  };
}
