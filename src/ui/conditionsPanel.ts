import { loadConditions } from '../conditions/cache';
import { sunMoon } from '../conditions/astro';
import { compass, weatherLabel, type Weather } from '../conditions/weather';
import { haversine } from '../map/geo';
import type { AppContext } from './context';
import { fmtDateTime, fmtTime, h, iconButton } from './dom';

export function openConditionsPanel(ctx: AppContext): void {
  const body = h('div', { class: 'conditions' }, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
  ctx.sheet.open('conditions', 'Conditions', body);

  const load = async (): Promise<void> => {
    const { center } = ctx.map.view();
    const [lng, lat] = center;
    const { weather, stale } = await loadConditions(ctx.repo, lat, lng);
    if (ctx.sheet.current !== 'conditions') return;
    // Sun/moon are computed locally, so they always reflect the current map center.
    const tz = weather && haversine([weather.lng, weather.lat], center) < 200_000 ? weather.timezone : undefined;
    const refresh = iconButton('refresh', 'Refresh', () => void load(), 'small');
    body.replaceChildren(
      weather ? weatherBlock(weather, stale, refresh) : h('div', { class: 'row center empty' }, 'Weather unavailable offline', refresh),
      astroBlock(lat, lng, tz),
    );
  };
  void load();
}

function arrow(fromDeg: number, size = 28): HTMLElement {
  // Arrow points where the wind is blowing TO.
  return h('span', {
    class: 'wind-arrow',
    style: `transform: rotate(${fromDeg + 180}deg); width:${size}px; height:${size}px`,
    'aria-hidden': 'true',
    html: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l6 14-6-3-6 3z"/></svg>',
  });
}

function weatherBlock(w: Weather, stale: boolean, refresh: HTMLElement): HTMLElement {
  const c = w.current;
  const asOf = h(
    'div',
    { class: `as-of${stale ? ' stale' : ''}` },
    `${stale ? 'Offline · ' : ''}${fmtDateTime(w.fetchedAt)} · `,
    h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'),
    refresh,
  );
  return h(
    'section',
    {},
    h(
      'div',
      { class: 'now' },
      h('div', { class: 'temp' }, `${Math.round(c.temp)}°`),
      h(
        'div',
        { class: 'wind', 'aria-label': `Wind from ${compass(c.windDir)} ${Math.round(c.windSpeed)} mph, gusts ${Math.round(c.windGust)}` },
        arrow(c.windDir, 36),
        h('div', {}, h('strong', {}, `${compass(c.windDir)} ${Math.round(c.windSpeed)}`), h('span', {}, ` mph · G ${Math.round(c.windGust)}`)),
      ),
      h('div', { class: 'sky' }, weatherLabel(c.code)),
    ),
    h(
      'table',
      { class: 'hourly' },
      h(
        'tbody',
        {},
        ...w.hourly.map((p) =>
          h(
            'tr',
            {},
            h('td', {}, hourLabel(p.time)),
            h('td', {}, `${Math.round(p.temp)}°`),
            h('td', { class: 'wind-cell' }, arrow(p.windDir, 16), `${compass(p.windDir)} ${Math.round(p.windSpeed)}`),
            h('td', {}, `G ${Math.round(p.windGust)}`),
            h('td', {}, p.precipProb === null ? '' : `${p.precipProb}%`),
          ),
        ),
      ),
    ),
    asOf,
  );
}

function hourLabel(localIso: string): string {
  // Open-Meteo returns local time without offset when timezone=auto.
  const hh = Number(localIso.slice(11, 13));
  return `${hh % 12 || 12}${hh < 12 ? 'a' : 'p'}`;
}

function astroBlock(lat: number, lng: number, tz: string | undefined): HTMLElement {
  const s = sunMoon(new Date(), lat, lng);
  const cell = (label: string, value: string, wide = false): HTMLElement =>
    h('div', { class: wide ? 'cell wide' : 'cell' }, h('span', {}, label), h('strong', {}, value));
  return h(
    'section',
    { class: 'astro' },
    h(
      'div',
      { class: 'grid' },
      cell('Legal light*', fmtTime(s.civilDawn, tz)),
      cell('Sunrise', fmtTime(s.sunrise, tz)),
      cell('Sunset', fmtTime(s.sunset, tz)),
      cell('Last light*', fmtTime(s.civilDusk, tz)),
      cell('Moonrise', fmtTime(s.moonrise, tz)),
      cell('Moonset', fmtTime(s.moonset, tz)),
      cell('Moon', `${s.moonPhase} · ${Math.round(s.moonIllumination * 100)}%`, true),
    ),
    h('div', { class: 'footnote' }, '*Civil twilight. Legal hours vary by state.'),
  );
}
