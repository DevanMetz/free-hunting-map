import { PADUS_QUERY, PLSS_SECTION_QUERY, SMA_QUERY, parcelSourceAt, type ParcelSource } from '../src/map/apiSources';
import { pathLength } from '../src/map/geo';
import type { LngLat } from '../src/types';
import { actor, bboxCovered, cacheRequest, limitBinding, lineStringCoords, parseBbox, parseLatLng, parsePath, readCache, requireCoverage, upstream, V1Error, writeCache, type V1Ctx } from './v1Shared';

interface CatalogLayer { id: string; name: string; category: string; attribution: string; minzoom: number | null; maxzoom: number | null; bounds: number[] | null; coverage: number[][] | null; tiles: string[] | null }
function contains(box: number[] | null | undefined, lng: number, lat: number): boolean {
  return !!box && box.length === 4 && lng >= box[0]! && lng <= box[2]! && lat >= box[1]! && lat <= box[3]!;
}
export async function listLayers(ctx: V1Ctx): Promise<unknown> {
  const point = ctx.search.has('lat') || ctx.search.has('lng') ? parseLatLng(ctx.search) : null;
  const response = await ctx.env.ASSETS.fetch(new Request(new URL('/api-layers.json', ctx.url.origin)));
  if (!response.ok) throw new V1Error(502, 'upstream_unavailable', 'Layer catalog unavailable');
  const catalog = await response.json() as CatalogLayer[];
  if (!Array.isArray(catalog)) throw new V1Error(502, 'upstream_unavailable', 'Layer catalog unavailable');
  const layers = [];
  for (const layer of catalog) {
    const tiles = (layer.tiles ?? []).map(tile => tile.startsWith('/') ? `${ctx.url.origin}${tile}` : tile);
    const tilejson = [...new Set(tiles.flatMap(tile => {
      try {
        const match = /^\/tiles\/([^/]+)\/(v\d+)\//.exec(new URL(tile).pathname);
        return match ? [`${ctx.url.origin}/tiles/${match[1]}/${match[2]}.json`] : [];
      } catch { return []; }
    }))];
    const known = !!(layer.bounds?.length || layer.coverage?.length);
    if (point && known && !contains(layer.bounds, point.lng, point.lat) && !(layer.coverage ?? []).some(box => contains(box, point.lng, point.lat))) continue;
    layers.push({ id: layer.id, name: layer.name, category: layer.category, attribution: layer.attribution, minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: layer.bounds, coverage: known ? layer.coverage : 'unknown', tiles, tilejson });
  }
  return { layers };
}

const MANAGERS: Record<string, string> = { USFS: 'U.S. Forest Service', BLM: 'Bureau of Land Management', NPS: 'National Park Service', FWS: 'U.S. Fish and Wildlife Service', DOD: 'Department of Defense', SFW: 'State fish and wildlife', SDNR: 'State natural resources', SPR: 'State parks', SLB: 'State trust land' };
const DESIGNATION: Record<string, string> = { NF: 'National Forest', NP: 'National Park', NRA: 'National Recreation Area', NWR: 'National Wildlife Refuge', NM: 'National Monument', NS: 'National Seashore', NL: 'National Lakeshore', SP: 'State Park', SF: 'State Forest', WA: 'Wilderness Area', WMA: 'Wildlife Management Area', SRMA: 'State Resource Management Area' };
const ACCESS: Record<string, string> = { OA: 'open', RA: 'restricted', XA: 'closed', UK: 'unknown' };
const CATEGORIES = [
  { id: 'usfs', test: (p: Pad) => p.Mang_Name === 'USFS', guidance: 'National forest land. Generally open to hunting and dispersed camping. Forest orders can close areas or roads and limit camping. Check local rules.' },
  { id: 'blm', test: (p: Pad) => p.Mang_Name === 'BLM', guidance: 'Bureau of Land Management land. Generally open to hunting and dispersed camping, often limited to 14 days at one site. Check local rules.' },
  { id: 'nps', test: (p: Pad) => p.Mang_Name === 'NPS', guidance: 'National Park Service land. Hunting is usually prohibited, except in some national preserves and other units where it is authorized. Camping is usually in designated sites or by permit. Check local rules.' },
  { id: 'fws', test: (p: Pad) => p.Mang_Name === 'FWS', guidance: 'National wildlife refuge land. Hunting is allowed only where the refuge hunt plan permits it, often with refuge-specific rules. Camping is usually not allowed. Check local rules.' },
  { id: 'stateWildlife', test: (p: Pad) => p.Mang_Type === 'STAT' && (p.Mang_Name === 'SFW' || (p.Mang_Name === 'SDNR' && p.Des_Tp !== 'SP')), guidance: 'State fish and wildlife or natural resources land, such as wildlife areas and state forests. Usually open to hunting under state regulations; camping rules vary. Check local rules.' },
  { id: 'statePark', test: (p: Pad) => p.Mang_Type === 'STAT' && (p.Des_Tp === 'SP' || p.Mang_Name === 'SPR'), guidance: 'State park land. Hunting is often limited to certain parks, areas or seasons. Camping is usually in designated sites. Check local rules.' },
  { id: 'stateTrust', test: (p: Pad) => p.Mang_Name === 'SLB', guidance: 'State trust land, managed to earn revenue for schools and other beneficiaries. Access varies by state; some require a permit and some are closed. Check local rules.' },
  { id: 'dod', test: (p: Pad) => p.Mang_Name === 'DOD', guidance: 'Military land. Access is restricted. Where hunting is offered it usually requires base permits and check-in. Check local rules.' },
  { id: 'other', test: (p: Pad) => ['LOC', 'DIST', 'JNT', 'FED', 'STAT'].includes(p.Mang_Type), guidance: 'County, local and other public land. Access rules vary by owner. Check local rules.' },
] as const;
const PADUS_WHERE = "Mang_Name IN ('USFS','BLM','NPS','FWS','SLB','DOD') OR Mang_Type IN ('LOC','DIST','JNT','FED','STAT')";
const PADUS_FIELDS = 'Unit_Nm,Mang_Name,Mang_Type,Loc_Mang,Des_Tp,Pub_Access,Loc_Ds';

interface Pad { Unit_Nm: string; Mang_Name: string; Mang_Type: string; Loc_Mang: string; Des_Tp: string; Pub_Access: string; Loc_Ds: string }
type SourceState = 'ok' | 'no_hit' | 'not_covered' | 'error';

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function attrs(data: unknown): Record<string, unknown> | null {
  const features = (data as { features?: { attributes?: Record<string, unknown> }[] } | null)?.features;
  return Array.isArray(features) && features[0]?.attributes ? features[0].attributes : null;
}

function classify(raw: Record<string, unknown>): { category: string; guidance: string; record: Pad } | null {
  const record: Pad = { Unit_Nm: text(raw.Unit_Nm), Mang_Name: text(raw.Mang_Name), Mang_Type: text(raw.Mang_Type), Loc_Mang: text(raw.Loc_Mang), Des_Tp: text(raw.Des_Tp), Pub_Access: text(raw.Pub_Access), Loc_Ds: text(raw.Loc_Ds) };
  const category = CATEGORIES.find(item => item.test(record));
  return category ? { category: category.id, guidance: category.guidance, record } : null;
}

function publicLand(hit: { category: string; guidance: string; record: Pad }) {
  const { record, category, guidance } = hit;
  return {
    status: 'public' as const, category, unit: record.Unit_Nm || null,
    manager: MANAGERS[record.Mang_Name] || record.Loc_Mang || null, manager_type: record.Mang_Type || null,
    designation: DESIGNATION[record.Des_Tp] || record.Loc_Ds || record.Des_Tp || null,
    access: ACCESS[record.Pub_Access] ?? 'unknown', guidance,
  };
}

function fieldList(source: ParcelSource): string {
  return [...new Set([...source.fields.parcel_id, ...source.fields.owner, ...source.fields.address, ...source.fields.acres, ...source.fields.county])].join(',');
}

function joined(attributes: Record<string, unknown>, names: string[]): string | null {
  const parts = names.map(name => text(attributes[name])).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function parcelId(source: ParcelSource, attributes: Record<string, unknown>): string | null {
  const parts = source.fields.parcel_id.map(name => text(attributes[name])).filter(Boolean);
  if (!parts.length) return null;
  return source.fields.joinId ? parts.join(' ') : parts[0]!;
}

function acres(attributes: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = attributes[name];
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n)) return Math.round(n * 10) / 10;
  }
  return null;
}

async function settled<T>(task: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await task }; } catch { return { ok: false }; }
}

function pointQuery(url: string, lng: number, lat: number, outFields: string, where = '1=1') {
  return upstream(url, { f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields, returnGeometry: 'false', where, resultRecordCount: '1' });
}

export async function landPoint(ctx: V1Ctx): Promise<unknown> {
  const { lat, lng } = parseLatLng(ctx.search);
  requireCoverage(lng, lat);
  const include = includeSet(ctx.search.get('include'));
  const query = `lat=${lat}&lng=${lng}&include=${[...include].sort().join(',')}`;
  const request = cacheRequest(ctx.url.origin, '/land/point', query);
  const hit = await readCache(request);
  if (hit !== undefined) return hit;
  await limitBinding(ctx.env.RL_UPSTREAM, actor(ctx));
  const parcel = include.has('parcel') ? parcelSourceAt(lng, lat) : undefined;
  const [padus, sma, plss, parcelResult] = await Promise.all([
    settled(pointQuery(PADUS_QUERY, lng, lat, PADUS_FIELDS, PADUS_WHERE)),
    settled(pointQuery(SMA_QUERY, lng, lat, 'ADMIN_AGENCY_CODE,ADMIN_UNIT_NAME,ADMIN_UNIT_TYPE')),
    include.has('plss') ? settled(pointQuery(PLSS_SECTION_QUERY, lng, lat, 'FRSTDIVNO,PLSSID,FRSTDIVTXT')) : Promise.resolve(null),
    include.has('parcel') && parcel ? settled(pointQuery(parcel.query, lng, lat, fieldList(parcel))) : Promise.resolve(null),
  ]);
  const sources: Record<string, SourceState> = {
    padus: padus.ok ? (attrs(padus.value) ? 'ok' : 'no_hit') : 'error',
    blm_sma: sma.ok ? (attrs(sma.value) ? 'ok' : 'no_hit') : 'error',
  };
  const classified = padus.ok ? classify(attrs(padus.value) ?? {}) : null;
  if (padus.ok && !classified) sources.padus = 'no_hit';
  const smaAttr = sma.ok ? attrs(sma.value) : null;
  const plssValue = plssRecord(plss);
  if (plss) sources.plss = plssValue.state;
  const parcelValue = parcelRecord(parcelResult, parcel);
  if (include.has('parcel')) sources.parcel = !parcel ? 'not_covered' : parcelValue.state;
  const attribution = [
    sources.padus === 'ok' ? 'USGS GAP PAD-US 4.1' : '',
    sources.blm_sma === 'ok' || sources.plss === 'ok' ? 'BLM' : '',
    sources.parcel === 'ok' && parcel ? parcel.attribution : '',
  ].filter(Boolean);
  const value = {
    location: [lng, lat],
    public_land: classified ? publicLand(classified) : { status: 'no_public_land_record' },
    blm_surface: smaAttr ? { agency: text(smaAttr.ADMIN_AGENCY_CODE) || null, unit: text(smaAttr.ADMIN_UNIT_NAME) || null, type: text(smaAttr.ADMIN_UNIT_TYPE) || null } : null,
    ...(include.has('plss') ? { plss: plssValue.value } : {}),
    ...(include.has('parcel') ? { parcel: parcelValue.value } : {}),
    sources, attribution,
  };
  if (!Object.values(sources).includes('error')) await writeCache(request, value);
  return value;
}

function plssRecord(result: { ok: true; value: unknown } | { ok: false } | null): { state: SourceState; value: { township: string; section: string } | null } {
  if (!result) return { state: 'error', value: null };
  if (!result.ok) return { state: 'error', value: null };
  const raw = attrs(result.value);
  if (!raw) return { state: 'no_hit', value: null };
  const section = text(raw.FRSTDIVNO);
  const id = text(raw.PLSSID);
  const match = /^[A-Z]{2}\d{2}(\d{3})0([NS])(\d{3})0([EW])\d$/.exec(id);
  const township = match ? `T${Number(match[1])}${match[2]} R${Number(match[3])}${match[4]}` : id;
  if (!section && !township) return { state: 'no_hit', value: null };
  return { state: 'ok', value: { township, section } };
}

function parcelRecord(result: { ok: true; value: unknown } | { ok: false } | null, source: ParcelSource | undefined): { state: SourceState; value: { source: string; parcel_id: string | null; owner: string | null; acres: number | null; address: string | null; county: string | null } | null } {
  if (!source) return { state: 'not_covered', value: null };
  if (!result || !result.ok) return { state: 'error', value: null };
  const raw = attrs(result.value);
  if (!raw) return { state: 'no_hit', value: null };
  return { state: 'ok', value: { source: source.id, parcel_id: parcelId(source, raw), owner: joined(raw, source.fields.owner), acres: acres(raw, source.fields.acres), address: joined(raw, source.fields.address), county: joined(raw, source.fields.county) } };
}

function includeSet(value: string | null): Set<string> {
  if (value == null) return new Set(['parcel', 'plss']);
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.some(part => part !== 'parcel' && part !== 'plss')) throw new V1Error(400, 'invalid_request', 'Invalid include');
  return new Set(parts);
}

async function padusDistinct(geometry: string, geometryType: string): Promise<Record<string, unknown>[]> {
  const data = await upstream(PADUS_QUERY, {
    f: 'json', geometry, geometryType, inSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: PADUS_WHERE,
    outFields: PADUS_FIELDS, returnGeometry: 'false', returnDistinctValues: 'true', resultRecordCount: '100',
  }) as { features?: { attributes?: Record<string, unknown> }[] };
  const features = Array.isArray(data.features) ? data.features : [];
  const seen = new Set<string>();
  const units = [];
  for (const feature of features) {
    const hit = feature.attributes ? classify(feature.attributes) : null;
    if (!hit) continue;
    const land = publicLand(hit);
    const key = JSON.stringify([land.category, land.unit, land.manager, land.access]);
    if (seen.has(key)) continue;
    seen.add(key);
    units.push(land);
    if (units.length >= 100) break;
  }
  return units.sort((a, b) => (a.unit ?? '').localeCompare(b.unit ?? ''));
}

function unitsResponse(units: Record<string, unknown>[]) {
  return { type: 'FeatureCollection', features: units.map(properties => ({ type: 'Feature', geometry: null, properties })) };
}

export async function landArea(ctx: V1Ctx): Promise<unknown> {
  const box = parseBbox(ctx.search.get('bbox'), 0.5);
  bboxCovered(box);
  return cachedArea(ctx, '/land/area', `bbox=${box.join(',')}`, () => padusDistinct(box.join(','), 'esriGeometryEnvelope'));
}

export async function landPath(ctx: V1Ctx): Promise<unknown> {
  const coords = pathCoords(ctx);
  const key = `path=${coords.map(point => point.join(',')).join(';')}`;
  return cachedArea(ctx, '/land/path', key, () => padusDistinct(JSON.stringify({ paths: [coords], spatialReference: { wkid: 4326 } }), 'esriGeometryPolyline'));
}

function pathCoords(ctx: V1Ctx): LngLat[] {
  const body = ctx.body as { geometry?: unknown } | null;
  const coords = body && typeof body === 'object' && body.geometry ? lineStringCoords(body.geometry) : parsePath(ctx.search.get('path'));
  if (coords.length < 2 || coords.length > 500) throw new V1Error(400, 'invalid_request', 'Invalid path');
  for (const point of coords) requireCoverage(point[0], point[1]);
  if (pathLength(coords) > 100_000) throw new V1Error(400, 'invalid_request', 'Path is too long');
  return coords;
}

async function cachedArea(ctx: V1Ctx, path: string, query: string, load: () => Promise<Record<string, unknown>[]>): Promise<unknown> {
  const request = cacheRequest(ctx.url.origin, path, query);
  const hit = await readCache(request);
  if (hit !== undefined) return hit;
  await limitBinding(ctx.env.RL_UPSTREAM, actor(ctx));
  const value = unitsResponse(await load());
  await writeCache(request, value);
  return value;
}
