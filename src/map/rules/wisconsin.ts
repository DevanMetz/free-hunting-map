import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { attributesAt, httpsUrl, polygonPages, polygonWhere } from '../arcgisView';
import { text } from '../layers/arcgis';
import { WISCONSIN_BOUNDS } from '../sources';
import { registerAreaSource, registerSeasonSource, registerWarningSource, type RuleProperties } from './registry';

const closures = 'https://dnrmaps.wi.gov/arcgis2/rest/services/WM_PROP_MGMT/WM_CLOSED_RESTRICTED_AREAS_WTM_Ext/MapServer/0';
const municipalities = 'https://dnrmaps.wi.gov/arcgis/rest/services/DW_Map_Dynamic/EN_Municipality_Boundary_WTM_Ext/MapServer/0';
const deer = 'https://dnrmaps.wi.gov/arcgis/rest/services/WM_CWD/WM_DMU_MSU_DMZ_Ext/MapServer/2';
const seasonsUrl = 'https://dnr.wisconsin.gov/topic/hunt/dates';
const closureInfo = 'https://dnr.wisconsin.gov/topic/fl/RealEstate/PALApplication';
const franklinCode = 'https://ecode360.com/8431892';
const closureFields = 'OBJECTID,PROP_NAME,RESTRICTIONS,CLOSED,EXCEPTIONS,PUBLIC_ENTRY,AUTHORITY_REF,AUTHORITY_URL,PROP_URL';

const FRANKLIN_WHERE = "MCD_FIPS_CODE='27300' AND MCD_NAME='Franklin' AND MCD_TYPE_CODE='C'";
const FRANKLIN_RULE = 'Firearm discharge is prohibited, except shotgun hunting on the WDNR Big Muskego Lake Wildlife Area lands west of South 116th Street described in Ordinance 2010-2016.';
const FRANKLIN_BOW = 'Bow hunting is prohibited within 100 yards of an occupied building unless the owner allows it, on city property, within 1,700 feet of a signed hospital or school, within 660 feet of a city park, and from a highway or within 50 feet of the roadway center.';

const ENTRY: Record<string, string> = {
  Y: 'Public entry allowed',
  L: 'Limited public entry',
  N: 'No public entry',
};

export function inWisconsin(lng: number, lat: number): boolean {
  const [west, south, east, north] = WISCONSIN_BOUNDS;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

function intersectsWisconsin(west: number, south: number, east: number, north: number): boolean {
  const [w, s, e, n] = WISCONSIN_BOUNDS;
  return east >= w && west <= e && north >= s && south <= n;
}

function closureKind(restrictions: string, entry: string): RuleProperties['kind'] {
  if (entry === 'N' || /no entry|no public access|closed to public/i.test(restrictions)) return 'entry';
  return 'closed';
}

function ruleFeature(feature: Feature<Polygon | MultiPolygon>, properties: RuleProperties, id: string): Feature<Polygon | MultiPolygon> {
  return { type: 'Feature', id, geometry: feature.geometry, properties: { ...properties } };
}

function closureProperties(attributes: Record<string, unknown>): RuleProperties {
  const restrictions = text(attributes.RESTRICTIONS);
  const entry = text(attributes.PUBLIC_ENTRY);
  return {
    title: text(attributes.PROP_NAME) || 'Closed area',
    kind: closureKind(restrictions, entry),
    rule: restrictions,
    dates: text(attributes.CLOSED),
    entry: ENTRY[entry] ?? '',
    exceptions: text(attributes.EXCEPTIONS),
    authority: text(attributes.AUTHORITY_REF),
    authorityUrl: httpsUrl(attributes.AUTHORITY_URL),
    mapUrl: httpsUrl(attributes.PROP_URL),
    sourceLabel: 'Wisconsin DNR closed areas',
    sourceUrl: closureInfo,
  };
}

function closureSentence(properties: Pick<RuleProperties, 'title' | 'rule' | 'dates' | 'entry'>): string {
  const entry = properties.entry === 'Public entry allowed' ? '' : properties.entry;
  return [`Restricted: ${properties.title}`, properties.rule, properties.dates, entry].filter(Boolean).join('. ');
}

let franklin: Feature<Polygon | MultiPolygon>[] | null = null;

async function franklinAreas(signal: AbortSignal): Promise<Feature<Polygon | MultiPolygon>[]> {
  if (franklin) return franklin;
  const features = await polygonWhere(municipalities, 'MCD_NAME,MCD_FIPS_CODE,MCD_TYPE_CODE', FRANKLIN_WHERE, signal);
  const mapped = features.map(feature => ruleFeature(feature, {
    title: 'City of Franklin',
    kind: 'municipal',
    rule: FRANKLIN_RULE,
    dates: 'Year-round',
    entry: '',
    exceptions: FRANKLIN_BOW,
    authority: 'Franklin § 183-75',
    authorityUrl: franklinCode,
    mapUrl: '',
    sourceLabel: 'City of Franklin ordinance',
    sourceUrl: franklinCode,
  }, 'franklin-27300'));
  if (mapped.length) franklin = mapped;
  return mapped;
}

registerAreaSource({
  id: 'wisconsin-closures',
  state: 'WI',
  minzoom: 6,
  async load(west, south, east, north, zoom, signal) {
    if (!intersectsWisconsin(west, south, east, north) || zoom < 6) return [];
    const [areas, city] = await Promise.all([
      polygonPages(closures, closureFields, 'OBJECTID', west, south, east, north, zoom, signal),
      franklinAreas(signal).catch(() => [] as Feature<Polygon | MultiPolygon>[]),
    ]);
    return [
      ...areas.map(feature => ruleFeature(feature, closureProperties(feature.properties ?? {}), `closure-${feature.id ?? feature.properties?.OBJECTID}`)),
      ...city,
    ];
  },
});

registerWarningSource({
  id: 'wisconsin-closures',
  async warn(lng, lat, signal) {
    if (!inWisconsin(lng, lat)) return [];
    const [areas, city] = await Promise.all([
      attributesAt(closures, closureFields, lng, lat, signal).catch(() => [] as Record<string, unknown>[]),
      attributesAt(municipalities, 'MCD_NAME,MCD_FIPS_CODE', lng, lat, signal, FRANKLIN_WHERE).catch(() => [] as Record<string, unknown>[]),
    ]);
    const lines = areas.map(attributes => closureSentence(closureProperties(attributes)));
    if (city.length) lines.push(`Restricted: City of Franklin. ${FRANKLIN_RULE}`);
    return lines;
  },
});

/** Statewide 2026 dates from the Wisconsin DNR season table. Metro dates apply only when the DMU service names a metro sub-unit. */
export function wisconsinDeerRows(attributes: Record<string, unknown>): [string, string][] {
  const metro = text(attributes.METRO_SUBUNIT_NAME);
  const rows: [string, string][] = [
    ['Unit', text(attributes.DEER_MGMT_UNIT_ID)],
    ['Zone', text(attributes.DEER_MANAGEMENT_ZONE)],
  ];
  if (metro) rows.push(['Metro', metro]);
  rows.push(
    ['Archery and crossbow', metro ? 'Sep 12, 2026 - Jan 31, 2027' : 'Sep 12, 2026 - Jan 3, 2027, or Jan 31, 2027 where extended'],
    ['Youth and disabled gun', 'Oct 10-11, 2026'],
    ['Gun', metro ? 'Nov 21 - Dec 9, 2026' : 'Nov 21-29, 2026'],
    ['Muzzleloader', 'Nov 30 - Dec 9, 2026'],
    ['Antlerless only', 'Dec 10-13, 2026'],
  );
  return rows.filter(([, value]) => value);
}

registerSeasonSource({
  id: 'wisconsin-deer',
  state: 'WI',
  async seasons(lng, lat, signal) {
    if (!inWisconsin(lng, lat)) return null;
    const [attributes] = await attributesAt(deer, 'DEER_MANAGEMENT_ZONE,DEER_MGMT_UNIT_ID,DEER_MGMT_UNIT_NAME,METRO_SUBUNIT_NAME', lng, lat, signal);
    if (!attributes) return null;
    const unit = text(attributes.DEER_MGMT_UNIT_NAME) || text(attributes.DEER_MGMT_UNIT_ID);
    return {
      title: unit ? `Deer ${unit}` : 'Deer season',
      rows: wisconsinDeerRows(attributes),
      links: [{ label: 'Wisconsin deer season dates', url: seasonsUrl }],
    };
  },
});
