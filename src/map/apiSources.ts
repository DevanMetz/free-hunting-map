/** Upstream endpoints for the read-only agent API. No Capacitor or DOM imports. */

export const ELEVATION_ROOT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
export const PADUS_QUERY = 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0/query';
export const SMA_QUERY = 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_without_PriUnk/MapServer/1/query';
export const PLSS_SECTION_QUERY = 'https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query';

export interface ParcelFields {
  /** First non-empty value, unless `joinId` is set. */
  parcel_id: string[];
  owner: string[];
  address: string[];
  acres: string[];
  county: string[];
  joinId?: boolean;
}

export interface ParcelSource {
  id: string;
  name: string;
  query: string;
  extent: [number, number, number, number];
  fields: ParcelFields;
  attribution: string;
}

/**
 * Point-query services verified 2026-11-10. Ohio and Florida timed out twice
 * and are omitted here; their map layers are unchanged.
 */
export const PARCEL_SOURCES: ParcelSource[] = [
  { id: 'wisconsin-parcels', name: 'Parcels (WI)', query: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0/query', extent: [-92.89, 42.49, -86.25, 47.31], attribution: 'Wisconsin Statewide Parcels V12 (SCO)', fields: { parcel_id: ['PARCELID', 'STATEID'], owner: ['OWNERNME1', 'OWNERNME2'], address: [], acres: ['GISACRES'], county: [] } },
  { id: 'arkansas-parcels', name: 'Parcels (AR)', query: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/MapServer/6/query', extent: [-94.7, 33.0, -89.6, 36.6], attribution: 'Arkansas GIS Office', fields: { parcel_id: ['parcelid'], owner: ['ownername'], address: ['adrlabel'], acres: ['taxarea'], county: ['county'] } },
  { id: 'colorado-parcels', name: 'Parcels (CO)', query: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0/query', extent: [-109.1, 36.9, -102.0, 41.1], attribution: 'State of Colorado', fields: { parcel_id: ['parcel_id'], owner: ['owner', 'owner2'], address: ['situsAdd', 'sitAddCty'], acres: ['landAcres'], county: ['countyName'] } },
  { id: 'connecticut-parcels', name: 'Parcels (CT)', query: 'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/ArcGIS/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0/query', extent: [-73.8, 40.9, -71.7, 42.1], attribution: 'Connecticut GIS Office and municipalities', fields: { parcel_id: ['Parcel_ID'], owner: ['Owner', 'Co_Owner'], address: ['Location', 'Town_Name'], acres: ['Land_Acres'], county: [] } },
  { id: 'delaware-parcels', name: 'Parcels (DE)', query: 'https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0/query', extent: [-75.8, 38.45, -75.04, 39.85], attribution: 'Delaware FirstMap and counties', fields: { parcel_id: ['PIN'], owner: [], address: [], acres: ['ACRES'], county: ['COUNTY'] } },
  { id: 'idaho-parcels', name: 'Parcels (ID)', query: 'https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7/query', extent: [-117.3, 41.9, -111, 49.1], attribution: 'Idaho ITS and participating counties', fields: { parcel_id: ['PARCEL_ID'], owner: ['OWNER1', 'OWNER2'], address: ['SITE_ADD'], acres: ['ASR_ACRES'], county: ['County'] } },
  { id: 'indiana-parcels', name: 'Parcels (IN)', query: 'https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0/query', extent: [-88.1, 37.77, -84.78, 41.77], attribution: 'Indiana Geographic Information Office', fields: { parcel_id: ['parcel_id', 'state_parcel_id'], owner: [], address: ['prop_add', 'prop_city'], acres: [], county: [] } },
  { id: 'maine-parcels', name: 'Parcels (ME organized towns)', query: 'https://gis.maine.gov/mapservices/rest/services/dep/MaineDEP_Parcels_NDW_NWI_NHD/MapServer/0/query', extent: [-71.2, 42.9, -66.9, 47.5], attribution: 'Maine GeoLibrary and municipalities', fields: { parcel_id: ['MAP_BK_LOT'], owner: [], address: ['PROP_LOC', 'TOWN'], acres: [], county: ['COUNTY'] } },
  { id: 'maryland-parcels', name: 'Parcels (MD)', query: 'https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query', extent: [-79.5, 37.85, -75.0, 39.75], attribution: 'State of Maryland: MD iMAP, MDP, SDAT', fields: { parcel_id: ['ACCTID'], owner: [], address: ['ADDRESS'], acres: ['ACRES', 'POLYACRES'], county: [] } },
  { id: 'massachusetts-parcels', name: 'Parcels (MA)', query: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/ArcGIS/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0/query', extent: [-73.6, 41.2, -69.8, 42.9], attribution: 'MassGIS and Massachusetts municipalities', fields: { parcel_id: ['PROP_ID', 'LOC_ID'], owner: ['OWNER1'], address: ['SITE_ADDR', 'CITY'], acres: [], county: [] } },
  { id: 'minnesota-parcels', name: 'Parcels (MN, participating counties)', query: 'https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_mngeo/plan_parcels_open/FeatureServer/1/query', extent: [-97.3, 43.4, -89.4, 49.5], attribution: 'MnGeo and participating counties', fields: { parcel_id: ['county_pin'], owner: ['owner_name', 'owner_more'], address: [], acres: ['acres_deed', 'acres_poly'], county: ['co_name'] } },
  { id: 'montana-parcels', name: 'Parcels (MT)', query: 'https://gisservice.mt.gov/arcgis/rest/services/msdi_cadastral_map_v1/MapServer/1/query', extent: [-116.1, 44.3, -103.9, 49.1], attribution: 'Montana State Library and Department of Revenue', fields: { parcel_id: ['PARCELID'], owner: ['OwnerName'], address: ['AddressLine1', 'CityStateZip'], acres: ['GISAcres'], county: [] } },
  { id: 'nebraska-parcels', name: 'Parcels (NE)', query: 'https://giscat.ne.gov/enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0/query', extent: [-104.1, 39.9, -95.3, 43.1], attribution: 'Nebraska Office of the CIO', fields: { parcel_id: ['Parcel_ID', 'State_PID'], owner: [], address: ['Situs_Address'], acres: ['GIS_Acres'], county: [] } },
  { id: 'new-jersey-parcels', name: 'Parcels (NJ)', query: 'https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0/query', extent: [-75.6, 38.8, -73.8, 41.4], attribution: 'New Jersey Office of GIS', fields: { parcel_id: ['PCLBLOCK', 'PCLLOT', 'PCLQCODE'], owner: [], address: ['PROP_LOC', 'MUN_NAME'], acres: ['CALC_ACRE'], county: ['COUNTY'], joinId: true } },
  { id: 'new-york-parcels', name: 'Parcels (NY)', query: 'https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1/query', extent: [-79.8, 40.4, -71.8, 45.1], attribution: 'NYS Geospatial Services and contributing counties', fields: { parcel_id: ['PRINT_KEY'], owner: ['PRIMARY_OWNER', 'ADD_OWNER'], address: ['PARCEL_ADDR', 'MUNI_NAME'], acres: ['ACRES'], county: ['COUNTY_NAME'] } },
  { id: 'north-carolina-parcels', name: 'Parcels (NC)', query: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/1/query', extent: [-84.4, 33.8, -75.3, 36.6], attribution: 'NC OneMap', fields: { parcel_id: ['parno'], owner: ['ownname', 'ownname2'], address: ['siteadd'], acres: ['gisacres'], county: ['cntyname'] } },
  { id: 'north-dakota-parcels', name: 'Parcels (ND)', query: 'https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0/query', extent: [-104.1, 45.9, -96.5, 49.1], attribution: 'North Dakota GIS Hub and counties', fields: { parcel_id: ['GISID'], owner: ['Ownership'], address: [], acres: ['CalculatedAcres'], county: ['CountyName'] } },
  { id: 'oregon-parcels', name: 'Parcels (OR)', query: 'https://gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_View_WGS84/FeatureServer/2/query', extent: [-124.7, 41.9, -116.4, 46.4], attribution: 'Oregon Water Resources Department and participating counties', fields: { parcel_id: ['maptaxlot'], owner: [], address: ['site_address'], acres: ['taxlot_acre'], county: ['county_name'] } },
  { id: 'tennessee-parcels', name: 'Parcels (TN)', query: 'https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0/query', extent: [-90.4, 34.9, -81.6, 36.8], attribution: 'Tennessee Comptroller of the Treasury', fields: { parcel_id: ['PARCELID'], owner: ['OWNER', 'OWNER2'], address: ['ADDRESS'], acres: ['DEEDAC'], county: ['COUNTY_NAME'] } },
  { id: 'utah-parcels', name: 'Parcels (UT)', query: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0/query', extent: [-114.1, 36.9, -109.0, 42.1], attribution: 'State of Utah, SGID', fields: { parcel_id: ['PARCEL_ID'], owner: [], address: ['PARCEL_ADD', 'PARCEL_CITY'], acres: [], county: ['County'] } },
  { id: 'vermont-parcels', name: 'Parcels (VT)', query: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0/query', extent: [-73.5, 42.7, -71.4, 45.1], attribution: 'Vermont municipalities and VCGI', fields: { parcel_id: ['PARCID', 'SPAN'], owner: ['OWNER1', 'OWNER2'], address: ['TOWN'], acres: ['ACRESGL'], county: [] } },
  { id: 'washington-parcels', name: 'Parcels (WA)', query: 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query', extent: [-124.9, 45.5, -116.9, 49.1], attribution: 'Washington State Geoportal and county assessors', fields: { parcel_id: ['ORIG_PARCEL_ID'], owner: [], address: ['SITUS_ADDRESS', 'SITUS_CITY_NM'], acres: [], county: [] } },
  { id: 'west-virginia-parcels', name: 'Parcels (WV)', query: 'https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0/query', extent: [-82.7, 37.15, -77.7, 40.7], attribution: 'West Virginia GIS Technical Center', fields: { parcel_id: ['GISPID'], owner: ['FullOwnerName'], address: ['FullPhysicalAddress'], acres: ['CALC_ACRE'], county: [] } },
];

export function parcelSourceAt(lng: number, lat: number): ParcelSource | undefined {
  return PARCEL_SOURCES.find(source => lng >= source.extent[0] && lng <= source.extent[2] && lat >= source.extent[1] && lat <= source.extent[3]);
}
