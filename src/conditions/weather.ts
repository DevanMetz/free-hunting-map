/** Open-Meteo forecast client (https://open-meteo.com, no API key, CC BY 4.0 data). */

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export interface WeatherPoint {
  time: string;
  temp: number;
  windSpeed: number;
  windDir: number;
  windGust: number;
  precipProb: number | null;
  code: number;
}

export interface Weather {
  lat: number;
  lng: number;
  fetchedAt: number;
  timezone: string;
  current: WeatherPoint;
  hourly: WeatherPoint[];
}

const VARS = 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code';

export function weatherUrl(lat: number, lng: number, hours = 8): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: VARS,
    hourly: `${VARS},precipitation_probability`,
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
    forecast_hours: String(hours),
  });
  return `${OPEN_METEO_URL}?${q}`;
}

export async function fetchWeather(lat: number, lng: number, signal?: AbortSignal): Promise<Weather> {
  const res = await fetch(weatherUrl(lat, lng), signal ? { signal } : {});
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return parseWeather(await res.json(), lat, lng, Date.now());
}

interface RawBlock {
  time: string | string[];
  temperature_2m: number | number[];
  wind_speed_10m: number | number[];
  wind_direction_10m: number | number[];
  wind_gusts_10m: number | number[];
  weather_code: number | number[];
  precipitation_probability?: (number | null)[];
}

export function parseWeather(json: unknown, lat: number, lng: number, fetchedAt: number): Weather {
  const j = json as { timezone?: string; current?: RawBlock; hourly?: RawBlock };
  if (!j.current || !j.hourly || !Array.isArray(j.hourly.time)) throw new Error('Unexpected Open-Meteo response');
  const c = j.current;
  const h = j.hourly;
  const at = <T,>(v: T | T[], i: number): T => (Array.isArray(v) ? (v[i] as T) : v);
  return {
    lat,
    lng,
    fetchedAt,
    timezone: j.timezone ?? 'UTC',
    current: {
      time: String(c.time),
      temp: Number(c.temperature_2m),
      windSpeed: Number(c.wind_speed_10m),
      windDir: Number(c.wind_direction_10m),
      windGust: Number(c.wind_gusts_10m),
      precipProb: null,
      code: Number(c.weather_code),
    },
    hourly: (h.time as string[]).map((time, i) => ({
      time,
      temp: at(h.temperature_2m, i),
      windSpeed: at(h.wind_speed_10m, i),
      windDir: at(h.wind_direction_10m, i),
      windGust: at(h.wind_gusts_10m, i),
      precipProb: h.precipitation_probability?.[i] ?? null,
      code: at(h.weather_code, i),
    })),
  };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Direction the wind blows FROM, as a compass point. */
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

/** WMO weather interpretation codes (Open-Meteo docs). */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return '—';
}
