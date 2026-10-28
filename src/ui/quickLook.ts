import { loadConditions } from '../conditions/cache';
import { sunMoon } from '../conditions/astro';
import { compass, type Weather } from '../conditions/weather';
import { haversine } from '../map/geo';
import type { AppContext } from './context';
import { fmtTime, h } from './dom';

/** A map-center snapshot; never display cached weather from a distant location. */
export function mountQuickLook(ctx: AppContext, root: HTMLElement, open: () => void): void {
  const chip = h('button', { type: 'button', class: 'quick-look', title: 'Conditions', 'aria-label': 'Conditions' });
  chip.addEventListener('click', open);
  root.append(chip);
  let weather: Weather | null = null;
  let request = 0;
  let timer = 0;
  const render = () => {
    const [lng, lat] = ctx.map.view().center;
    const nearby = weather && haversine([weather.lng, weather.lat], [lng, lat]) < 20_000 ? weather : null;
    const sun = sunMoon(new Date(), lat, lng);
    const times = nearby ? `${fmtTime(sun.sunrise, nearby.timezone)}–${fmtTime(sun.sunset, nearby.timezone)}` : '—';
    const wind = nearby && Date.now() - nearby.fetchedAt < 24 * 60 * 60 * 1000
      ? `${Date.now() - nearby.fetchedAt >= 60 * 60 * 1000 ? '~' : ''}${compass(nearby.current.windDir)} ${Math.round(nearby.current.windSpeed)} mph` : '—';
    chip.textContent = `☀ ${times}  ·  🧭 ${wind}`;
    chip.setAttribute('aria-label', `Sunrise to sunset ${times}; wind from ${wind}. Open conditions`);
  };
  const load = async () => {
    const version = ++request;
    const [lng, lat] = ctx.map.view().center;
    try {
      const result = await loadConditions(ctx.repo, lat, lng);
      if (version !== request) return;
      weather = result.weather;
      render();
    } catch { if (version === request) render(); }
  };
  const moved = () => {
    render();
    const [lng, lat] = ctx.map.view().center;
    if (weather && haversine([weather.lng, weather.lat], [lng, lat]) < 10_000 && Date.now() - weather.fetchedAt < 60 * 60 * 1000) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void load(), 1000);
  };
  ctx.map.map.on('moveend', moved);
  window.addEventListener('online', moved);
  window.setInterval(moved, 60 * 60 * 1000);
  render();
  void load();
}
