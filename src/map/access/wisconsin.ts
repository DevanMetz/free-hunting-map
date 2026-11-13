import type { Feature, Point } from 'geojson';
import { pointPages } from '../arcgisView';
import { text } from '../layers/arcgis';
import { WISCONSIN_BOUNDS } from '../sources';

const parking = 'https://dnrmaps.wi.gov/arcgis/rest/services/WM_LMS/WM_LMS_Conservation_Infrastructure_WTM_Int/MapServer/27';
const access = 'https://dnrmaps.wi.gov/arcgis2/rest/services/PR_Recreation/PR_Boat_Access_Shore_Fishing_WTM_Ext/MapServer/2';
const atlas = 'https://dnr.wisconsin.gov/topic/fl/RealEstate/PALApplication';

export interface AccessProperties {
  spotId: string;
  origin: 'parking' | 'access' | 'pullout';
  title: string;
  detail: string;
  water: string;
  county: string;
  owner: string;
  sourceLabel: string;
  sourceUrl: string;
  pulloutId: string;
}

function intersectsWisconsin(west: number, south: number, east: number, north: number): boolean {
  const [w, s, e, n] = WISCONSIN_BOUNDS;
  return east >= w && west <= e && north >= s && south <= n;
}

function point(feature: Feature<Point>, properties: AccessProperties): Feature<Point> {
  return { type: 'Feature', id: properties.spotId, geometry: feature.geometry, properties: { ...properties } };
}

export async function wisconsinAccessPoints(
  west: number, south: number, east: number, north: number, zoom: number, signal: AbortSignal,
): Promise<Feature<Point>[]> {
  if (zoom < 11 || !intersectsWisconsin(west, south, east, north)) return [];
  const [lots, sites] = await Promise.all([
    pointPages(parking, 'OBJECTID,PARKING_LOT_NAME,LMS_PARKING_TYPE_NAME,PARKING_LOT_DESC,LOCATION_DESC,PARKING_LOT_SIZE,INACTIVE_FLAG', 'OBJECTID', west, south, east, north, signal, "INACTIVE_FLAG<>'Y'"),
    pointPages(access, 'OBJECTID,LMS_BOAT_LANDING_NAME,LANDING_TYPE_CODE,RAMP_TYPE_CODE,WATERBODY_NAME_TEXT,COUNTY_NAME_TEXT,OWNERSHIP_NAME_TEXT,ABANDON_FLAG', 'OBJECTID', west, south, east, north, signal, "ABANDON_FLAG<>'Yes'"),
  ]);
  return [
    ...lots.map(feature => {
      const properties = feature.properties ?? {};
      const id = text(properties.OBJECTID);
      const detail = [text(properties.LMS_PARKING_TYPE_NAME), text(properties.PARKING_LOT_DESC), text(properties.LOCATION_DESC), text(properties.PARKING_LOT_SIZE)].filter(Boolean).join(' · ');
      return point(feature, {
        spotId: `wi-parking:${id}`, origin: 'parking', title: text(properties.PARKING_LOT_NAME) || 'DNR parking',
        detail, water: '', county: '', owner: '', sourceLabel: 'Wisconsin DNR parking', sourceUrl: atlas, pulloutId: '',
      });
    }),
    ...sites.map(feature => {
      const properties = feature.properties ?? {};
      const id = text(properties.OBJECTID);
      const detail = [text(properties.LANDING_TYPE_CODE), text(properties.RAMP_TYPE_CODE)].filter(Boolean).join(' · ');
      return point(feature, {
        spotId: `wi-access:${id}`, origin: 'access', title: text(properties.LMS_BOAT_LANDING_NAME) || 'Boat access',
        detail, water: text(properties.WATERBODY_NAME_TEXT), county: text(properties.COUNTY_NAME_TEXT),
        owner: text(properties.OWNERSHIP_NAME_TEXT), sourceLabel: 'Wisconsin DNR boat access', sourceUrl: atlas, pulloutId: '',
      });
    }),
  ];
}
