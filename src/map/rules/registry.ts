import type { Feature, MultiPolygon, Polygon } from 'geojson';

/** Flat properties drawn by a hunting-rules layer. Another state fills the same keys. */
export interface RuleProperties {
  title: string;
  kind: 'entry' | 'closed' | 'municipal';
  rule: string;
  dates: string;
  entry: string;
  exceptions: string;
  authority: string;
  authorityUrl: string;
  mapUrl: string;
  sourceLabel: string;
  sourceUrl: string;
}

export interface AreaSource {
  id: string;
  state: string;
  minzoom: number;
  load(west: number, south: number, east: number, north: number, zoom: number, signal: AbortSignal): Promise<Feature<Polygon | MultiPolygon>[]>;
}

export interface SeasonHit {
  title: string;
  rows: [string, string][];
  links: { label: string; url: string }[];
}

export interface SeasonSource {
  id: string;
  state: string;
  seasons(lng: number, lat: number, signal: AbortSignal): Promise<SeasonHit | null>;
}

export interface WarningSource {
  id: string;
  warn(lng: number, lat: number, signal: AbortSignal): Promise<string[]>;
}

export const areaSources: AreaSource[] = [];
export const seasonSources: SeasonSource[] = [];
export const warningSources: WarningSource[] = [];

function add<T extends { id: string }>(list: T[], source: T): void {
  if (!list.some(item => item.id === source.id)) list.push(source);
}

export const registerAreaSource = (source: AreaSource): void => add(areaSources, source);
export const registerSeasonSource = (source: SeasonSource): void => add(seasonSources, source);
export const registerWarningSource = (source: WarningSource): void => add(warningSources, source);

export async function restrictionWarnings(lng: number, lat: number, signal: AbortSignal): Promise<string[]> {
  const lists = await Promise.all(warningSources.map(source => source.warn(lng, lat, signal).catch(() => [] as string[])));
  return lists.flat();
}
