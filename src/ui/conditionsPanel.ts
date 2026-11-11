import { loadConditions } from '../conditions/cache';
import { sunMoon } from '../conditions/astro';
import { compass, weatherLabel, type DailyForecast, type Weather, type WeatherPoint } from '../conditions/weather';
import { haversine } from '../map/geo';
import type { AppContext } from './context';
import { fmtDateTime, fmtTime, h, iconButton } from './dom';

export function openConditionsPanel(ctx: AppContext): void {
  const body = h('div', { class: 'conditions' }, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
  ctx.sheet.open('conditions', 'Conditions', body);
  let weather: Weather | null = null;
  let stale = false;
  let center: [number, number] = [0, 0];
  let selected = '';
  let focusDate = '';

  const render = (): void => {
    if (ctx.sheet.current !== 'conditions') return;
    const [lng, lat] = center;
    const tz = weather && haversine([weather.lng, weather.lat], center) < 200_000 ? weather.timezone : undefined;
    const days = weather?.daily ?? [];
    if (days.length && !days.some((day) => day.date === selected)) selected = days[0]!.date;
    const day = days.find((item) => item.date === selected) ?? null;
    const refresh = iconButton('refresh', 'Refresh', () => void load());
    const pendingFocus = focusDate;
    focusDate = '';
    const today = weather?.current.time.slice(0, 10) ?? '';
    const selectDay = (date: string): void => {
      selected = date;
      focusDate = date;
      render();
    };
    const nodes: Node[] = [
      weather
        ? h(
            'section',
            {},
            nowBlock(weather),
            days.length
              ? h(
                  'div',
                  { class: 'day-strip', role: 'group', 'aria-label': 'Daily forecast' },
                  ...days.map((item) => dayButton(item, item.date === today, item.date === day?.date, lat, lng, tz, () => selectDay(item.date))),
                )
              : null,
          )
        : h('div', { class: 'row center empty' }, 'Weather unavailable offline', refresh),
      astroBlock(lat, lng, tz, day ? new Date(`${day.date}T12:00:00`) : new Date()),
    ];
    if (weather) {
      const hours = hoursFor(weather, day?.date ?? null);
      nodes.push(h('section', {}, hours.length ? hourlyTable(hours) : null, asOf(weather, stale, refresh)));
    }
    body.replaceChildren(...nodes);
    if (pendingFocus) body.querySelector<HTMLButtonElement>(`button[data-date="${pendingFocus}"]`)?.focus();
    const strip = body.querySelector<HTMLElement>('.day-strip');
    const selectedEl = strip?.querySelector<HTMLElement>('.selected');
    if (strip && selectedEl) revealDay(strip, selectedEl);
  };

  const load = async (): Promise<void> => {
    center = ctx.map.view().center;
    const [lng, lat] = center;
    const result = await loadConditions(ctx.repo, lat, lng);
    if (ctx.sheet.current !== 'conditions') return;
    weather = result.weather;
    stale = result.stale;
    render();
  };
  void load();
}

function revealDay(strip: HTMLElement, day: HTMLElement): void {
  const stripBox = strip.getBoundingClientRect();
  const dayBox = day.getBoundingClientRect();
  if (dayBox.left < stripBox.left) strip.scrollLeft -= stripBox.left - dayBox.left;
  else if (dayBox.right > stripBox.right) strip.scrollLeft += dayBox.right - stripBox.right;
}

function nowBlock(w: Weather): HTMLElement {
  const c = w.current;
  return h(
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
  );
}

function dayButton(
  day: DailyForecast,
  today: boolean,
  selected: boolean,
  lat: number,
  lng: number,
  tz: string | undefined,
  onSelect: () => void,
): HTMLButtonElement {
  const sun = sunMoon(new Date(`${day.date}T12:00:00`), lat, lng);
  const name = today ? 'Today' : weekday(day.date);
  const high = deg(day.high);
  const low = deg(day.low);
  const wind = Number.isFinite(day.windDir) && Number.isFinite(day.windSpeed)
    ? `${compass(day.windDir)} ${Math.round(day.windSpeed)}`
    : '—';
  const gust = Number.isFinite(day.windGust) ? `G ${Math.round(day.windGust)}` : '';
  const pop = day.precipProb === null || !Number.isFinite(day.precipProb) ? '' : `${Math.round(day.precipProb)}%`;
  const rise = fmtTime(sun.sunrise, tz);
  const set = fmtTime(sun.sunset, tz);
  const light = fmtTime(sun.civilDawn, tz);
  const last = fmtTime(sun.civilDusk, tz);
  return h(
    'button',
    {
      type: 'button',
      class: selected ? 'day selected' : 'day',
      'data-date': day.date,
      'aria-pressed': selected ? 'true' : 'false',
      'aria-label': `${name}, high ${high}, low ${low}, wind from ${wind} mph${gust ? `, gusts ${Math.round(day.windGust)}` : ''}${pop ? `, ${pop} precipitation` : ''}, sunrise ${rise}, sunset ${set}, legal light ${light} to ${last}`,
      onclick: onSelect,
    },
    h('span', { class: 'day-name' }, name),
    h('span', { class: 'temps' }, h('span', { class: 'hi' }, high), h('span', { class: 'lo' }, low)),
    h('span', { class: 'wind-cell' }, Number.isFinite(day.windDir) ? arrow(day.windDir, 14) : null, wind),
    h('span', { class: 'meta' }, gust || null, pop || null),
    h('span', { class: 'light' }, h('span', {}, compactTime(sun.sunrise, tz)), h('span', {}, compactTime(sun.sunset, tz))),
  );
}

function hoursFor(w: Weather, date: string | null): WeatherPoint[] {
  if (!date || !w.daily?.length) return w.hourly;
  const onDay = w.hourly.filter((point) => point.time.slice(0, 10) === date);
  if (date !== w.current.time.slice(0, 10)) return onDay;
  const hour = w.current.time.slice(0, 13);
  const upcoming = onDay.filter((point) => point.time.slice(0, 13) >= hour);
  return upcoming.length ? upcoming : onDay;
}

function hourlyTable(points: WeatherPoint[]): HTMLElement {
  return h(
    'table',
    { class: 'hourly' },
    h(
      'tbody',
      {},
      ...points.map((p) =>
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
  );
}

function asOf(w: Weather, stale: boolean, refresh: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: `as-of${stale ? ' stale' : ''}` },
    `${stale ? 'Offline · ' : ''}${fmtDateTime(w.fetchedAt)} · `,
    h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo'),
    refresh,
  );
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

function hourLabel(localIso: string): string {
  // Open-Meteo returns local time without offset when timezone=auto.
  const hh = Number(localIso.slice(11, 13));
  return `${hh % 12 || 12}${hh < 12 ? 'a' : 'p'}`;
}

function weekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(utc);
  return `${name} ${day}`;
}

function deg(n: number): string {
  return Number.isFinite(n) ? `${Math.round(n)}°` : '—';
}

function compactTime(d: Date | null, timeZone?: string): string {
  if (!d) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(d);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  const period = parts.find((part) => part.type === 'dayPeriod')?.value.toLowerCase().startsWith('a') ? 'a' : 'p';
  return `${hour}:${minute}${period}`;
}

function astroBlock(lat: number, lng: number, tz: string | undefined, date: Date): HTMLElement {
  const s = sunMoon(date, lat, lng);
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
