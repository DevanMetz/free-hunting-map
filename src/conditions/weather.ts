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

/** One location-local calendar day from Open-Meteo `daily`. */
export interface DailyForecast {
  /** YYYY-MM-DD in the forecast timezone. */
  date: string;
  high: number;
  low: number;
  /** Dominant direction the wind blows from, degrees. */
  windDir: number;
  /** Maximum sustained wind, mph. */
  windSpeed: number;
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
  /**
   * Present on 7-day forecasts. Absent on the short fetch used by the wind
   * plume and on forecasts cached before daily data was stored.
   */
  daily?: DailyForecast[];
}

const VARS = 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code';
const DAILY_VARS = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,wind_gusts_10m_max';

/** Days requested for the conditions panel, including today. */
export const FORECAST_DAYS = 7;

export function weatherUrl(lat: number, lng: number, hours = 8, days = 0): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: VARS,
    hourly: `${VARS},precipitation_probability`,
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  });
  // A day count replaces the short hourly window so each day has its hours.
  if (days > 0) {
    q.set('forecast_days', String(days));
    q.set('daily', DAILY_VARS);
  } else {
    q.set('forecast_hours', String(hours));
  }
  return `${OPEN_METEO_URL}?${q}`;
}

export async function fetchWeather(lat: number, lng: number, signal?: AbortSignal, days = 0): Promise<Weather> {
  const res = await fetch(weatherUrl(lat, lng, 8, days), signal ? { signal } : {});
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

interface RawDaily {
  time?: unknown;
  temperature_2m_max?: unknown[];
  temperature_2m_min?: unknown[];
  precipitation_probability_max?: (number | null)[];
  wind_speed_10m_max?: unknown[];
  wind_direction_10m_dominant?: unknown[];
  wind_gusts_10m_max?: unknown[];
  weather_code?: unknown[];
}

function parseDaily(raw: unknown): DailyForecast[] {
  if (!raw || typeof raw !== 'object') return [];
  const d = raw as RawDaily;
  if (!Array.isArray(d.time)) return [];
  return d.time.map((date, i) => ({
    date: String(date),
    high: Number(d.temperature_2m_max?.[i]),
    low: Number(d.temperature_2m_min?.[i]),
    windSpeed: Number(d.wind_speed_10m_max?.[i]),
    windDir: Number(d.wind_direction_10m_dominant?.[i]),
    windGust: Number(d.wind_gusts_10m_max?.[i]),
    precipProb: d.precipitation_probability_max?.[i] ?? null,
    code: Number(d.weather_code?.[i]),
  }));
}

export function parseWeather(json: unknown, lat: number, lng: number, fetchedAt: number): Weather {
  const j = json as { timezone?: string; current?: RawBlock; hourly?: RawBlock; daily?: unknown };
  if (!j.current || !j.hourly || !Array.isArray(j.hourly.time)) throw new Error('Unexpected Open-Meteo response');
  const c = j.current;
  const h = j.hourly;
  const at = <T,>(v: T | T[], i: number): T => (Array.isArray(v) ? (v[i] as T) : v);
  const daily = parseDaily(j.daily);
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
    ...(daily.length ? { daily } : {}),
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
