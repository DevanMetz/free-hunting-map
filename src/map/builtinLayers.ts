import './layers/idahoParcels';
import './layers/oregonParcels';
import './layers/newYorkParcels';
import './layers/coloradoParcels';
import './layers/utahParcels';
import './layers/northDakotaParcels';
import './layers/montanaParcels';
import './layers/washingtonParcels';
import './layers/floridaParcels';
import './layers/arkansasParcels';
import './layers/tennesseeParcels';
import './layers/nebraskaParcels';
import './layers/westVirginiaParcels';
import './layers/marylandParcels';
import './layers/delawareParcels';
import './layers/indianaParcels';
import './layers/newJerseyParcels';
import './layers/maineParcels';
import './layers/connecticutParcels';
import './layers/massachusettsParcels';
import './layers/vermontParcels';
import './layers/minnesotaParcels';
import './layers/northCarolinaParcels';
import './layers/ohioParcels';
import './layers/communityHikes';
import './layers/lidar';
import './layers/historicAerials';
import './layers/historicTopo';
import './layers/hazards';
import './layers/agriculture';
import './layers/cuts';
import './layers/vegetation';
import './layers/trails';
import './layers/tigerRoads';
import './layers/usfsClosedRoads';
import './layers/osmTracks';
import './layers/wiForestRoads';
import './layers/community';
import { registerLayers, type IdentifyResult } from './layerRegistry';
import { PUBLIC_LANDS, publicLandExportUrl } from './publicLands';
import { identifyDeer, identifyPublicLand, parcelContent } from './inspect';
import { CACHE_ROUTES } from './cacheRoutes';
import { DEER_EXPORT, DEER_ATTR, NHD_TILES, NHD_ATTR, NWI_EXPORT, NWI_ATTR, PARCELS_ATTR, HILLSHADE_ATTR, HILLSHADE_EXPORT, PADUS_ATTR, SLOPE_EXPORT, ASPECT_EXPORT } from './sources';

// Terrain legend swatches verified against paired Map PNG / Degrees F32 exports (2026-10-24).
const result = (lines: string[]): IdentifyResult | null => lines.length ? { title: lines[0], rows: lines.slice(1).map(line => ['', line]) } : null;
registerLayers([
  ...PUBLIC_LANDS.map(c => ({
    id: `padus-${c.id}`, category: 'land' as const, name: c.label, swatch: c.color, info: c.info,
    defaultOpacity: 1, minzoom: 5, attribution: PADUS_ATTR, cacheRoute: CACHE_ROUTES.padus,
    source: { kind: 'raster' as const, tiles: [publicLandExportUrl(c)], tileSize: 256, minzoom: 5 },
    identify: async (lng: number, lat: number, signal: AbortSignal) => result(await identifyPublicLand(lng, lat, [c.id], signal)),
  })),
  {
    id: 'parcels', category: 'land', name: 'Parcels (WI)', swatch: '#b0306a', defaultOpacity: 0.8,
    minzoom: 13, attribution: PARCELS_ATTR, cacheRoute: CACHE_ROUTES.parcels, layerIds: ['parcels-fill', 'parcels-line'],
    install(map, ctx) {
      if (map.getSource('parcels')) return;
      map.addSource('parcels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: PARCELS_ATTR });
      map.addLayer({ id: 'parcels-fill', type: 'fill', source: 'parcels', minzoom: 13, paint: { 'fill-opacity': 0 } }, ctx.beforeId);
      map.addLayer({ id: 'parcels-line', type: 'line', source: 'parcels', minzoom: 13, paint: {
        'line-color': ctx.basemap === 'satellite' ? '#ffd400' : '#b0306a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.6],
      } }, ctx.beforeId);
    },
    setVisible(map, on, ctx) {
      for (const id of ['parcels-fill', 'parcels-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      ctx.setParcelsEnabled(on);
    },
    setOpacity(map, opacity) { map.setPaintProperty('parcels-line', 'line-opacity', opacity); },
    async identify(_lng, _lat, _signal, map, point) {
      if (!map.getLayer('parcels-fill')) return null;
      const feature = map.queryRenderedFeatures(point, { layers: ['parcels-fill'] })[0];
      return feature ? result(parcelContent(feature.properties)) : null;
    },
  },
  { id: 'deer-units', category: 'land', name: 'Deer units (WI DNR)', defaultOpacity: 0.8, minzoom: 6,
    attribution: DEER_ATTR, source: { kind: 'raster', tiles: [DEER_EXPORT] }, cacheRoute: CACHE_ROUTES.deer,
    identify: async (lng, lat, signal) => result(await identifyDeer(lng, lat, signal)) },
  { id: 'water-nhd', category: 'water', name: 'Streams & lakes', swatch: '#509ccc', defaultOpacity: 1,
    attribution: NHD_ATTR, source: { kind: 'raster', tiles: [NHD_TILES], maxzoom: 16 }, cacheRoute: CACHE_ROUTES.nhd },
  { id: 'water-nwi', category: 'water', name: 'Wetlands', swatch: '#609d71', defaultOpacity: 0.7, minzoom: 11,
    attribution: NWI_ATTR, source: { kind: 'raster', tiles: [NWI_EXPORT], maxzoom: 16 }, cacheRoute: CACHE_ROUTES.nwi },
  { id: 'hillshade', category: 'terrain', name: 'Hillshade', defaultOpacity: 0.55, minzoom: 11,
    attribution: HILLSHADE_ATTR, source: { kind: 'raster', tiles: [HILLSHADE_EXPORT], minzoom: 11, maxzoom: 17 }, cacheRoute: CACHE_ROUTES.hillshade },
  { id: 'slope', category: 'terrain', name: 'Slope', defaultOpacity: 0.65, minzoom: 10,
    legend: [{ color: '#d1d1d1', label: '0°' }, { color: '#fffac2', label: '5°' }, { color: '#ffff00', label: '10°' },
      { color: '#ffbe00', label: '15°' }, { color: '#fda133', label: '20°' }, { color: '#fe7200', label: '30°' }, { color: '#a24a1b', label: '>30°' }],
    attribution: HILLSHADE_ATTR, source: { kind: 'raster', tiles: [SLOPE_EXPORT], maxzoom: 17 }, cacheRoute: CACHE_ROUTES.hillshade },
  { id: 'aspect', category: 'terrain', name: 'Aspect', defaultOpacity: 0.65, minzoom: 11,
    legend: [{ color: 'linear-gradient(90deg,#84d800 50%,#a0d21e 50%)', label: 'N' }, { color: '#00aa41', label: 'NE' },
      { color: '#0068be', label: 'E' }, { color: '#6900a0', label: 'SE' }, { color: '#c8009c', label: 'S' },
      { color: '#ff5064', label: 'SW' }, { color: '#ffaa46', label: 'W' }, { color: '#fafa00', label: 'NW' }],
    attribution: HILLSHADE_ATTR, source: { kind: 'raster', tiles: [ASPECT_EXPORT], maxzoom: 17 }, cacheRoute: CACHE_ROUTES.hillshade },
  { id: 'my-items', category: 'mydata', name: 'Saved items', defaultOpacity: 1, defaultOn: true, attribution: '',
    install() {},
    setVisible(map, on) {
      for (const id of ['ohm-fov-fill', 'ohm-fov-line', 'ohm-tracks-casing', 'ohm-tracks', 'ohm-waypoints']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    },
    setOpacity(map, opacity) {
      if (map.getLayer('ohm-fov-fill')) map.setPaintProperty('ohm-fov-fill', 'fill-opacity', opacity * 0.22);
      if (map.getLayer('ohm-fov-line')) map.setPaintProperty('ohm-fov-line', 'line-opacity', opacity);
      if (map.getLayer('ohm-tracks')) map.setPaintProperty('ohm-tracks', 'line-opacity', opacity);
      if (map.getLayer('ohm-tracks-casing')) map.setPaintProperty('ohm-tracks-casing', 'line-opacity', opacity * 0.45);
      if (map.getLayer('ohm-waypoints')) map.setPaintProperty('ohm-waypoints', 'icon-opacity', opacity);
    },
  },
  { id: 'trail-finder', category: 'trailfinder', name: 'Find trails', defaultOpacity: 1, attribution: HILLSHADE_ATTR, action: 'trailfinder' },
]);

import './layers/land';
import './layers/wilderness';
import './layers/kansasWiha';
import './layers/water';
import './layers/terrain';

import './layers/northDakotaPlots';
import './layers/nebraskaOfw';

import './layers/montanaDistricts';

import './layers/montanaBlockManagement';

import './layers/coloradoBigGameUnits';
import './layers/coloradoBighornUnits';
import './layers/coloradoMountainGoatUnits';

import './layers/idahoGameUnits';

import './layers/wyomingDeerAreas';

import './layers/coloradoWalkIn';
import './layers/coloradoPublicProperties';

import './layers/oregonWildlifeUnits';

import './layers/newMexicoGameUnits';
import './layers/arizonaGameUnits';

import './layers/washingtonGameUnits';

import './layers/nevadaHuntUnits';

import './layers/utahCwmu';

import './layers/texasWma';

import './layers/californiaDeerZones';

import './layers/michiganDeerUnits';
import './layers/michiganTurkeyUnits';
import './layers/michiganElkUnits';
import './layers/michiganBearUnits';
import './layers/michiganWaterfowlUnits';
import './layers/michiganPheasantUnits';
import './layers/michiganSharpTailedGrouseUnits';
import './layers/michiganParkHunting';
import './layers/michiganWildlifeProperties';
import './layers/michiganHunterAccess';

import './layers/pennsylvaniaWildlifeUnits';

import './layers/virginiaWma';

import './layers/floridaWma';

import './layers/tennesseeHuntingLands';

import './layers/ohioDnrLands';

import './layers/arkansasWma';
import './layers/kentuckyPublicHunting';
import './layers/iowaPublicHunting';

import './layers/missouriConservationAreas';

import './layers/wisconsinVpa';

import './layers/northCarolinaGameLands';

import './layers/alabamaWma';

import './layers/southCarolinaWma';

import './layers/louisianaManagedLands';
import './layers/georgiaPublicProperties';
import './layers/georgiaDesignatedAreas';
import './layers/westVirginiaWma';
import './layers/newHampshireWildlifeUnits';

import './layers/montanaWma';
import './layers/newMexicoDesignatedAreas';

import './layers/usgsTopoQuads';

import './layers/usfsRecreation';

import './layers/blmRecreation';

import './layers/nationalWildlifeRefuges';

import './layers/michiganTimberSales';

import './layers/michiganCommercialForest';

import './layers/michiganCompletedTreatments';

import './layers/michiganForestCampgrounds';
import './layers/michiganParkCampgrounds';
import './layers/michiganManagedParking';
import './layers/michiganManagedBridges';

import './layers/michiganFishingAccess';

import './layers/michiganBoatingAccess';

import './layers/oklahomaShootingRanges';
import './layers/oklahomaCampingAreas';

import './layers/oklahomaWildlifeAreas';

import './layers/oklahomaFoodPlots';

import './layers/iowaWaterAccess';

import './layers/iowaCampgrounds';

import './layers/iowaTrailAccess';

import './layers/iowaRecreationParking';

import './layers/pennsylvaniaShootingRanges';

import './layers/pennsylvaniaGameAccess';

import './layers/pennsylvaniaDuckZones';

import './layers/pennsylvaniaGooseZones';

import './layers/pennsylvaniaWaterAccess';

import './layers/pennsylvaniaForestTrailAccess';

import './layers/kentuckyElkRegulatedAreas';

import './layers/kentuckyHuntingEntrances';

import './layers/kentuckyBoatAccess';

import './layers/kentuckyFishingAccess';

import './layers/northCarolinaGameParking';

import './layers/northCarolinaGameCamping';

import './layers/northCarolinaShootingRanges';
import './layers/northCarolinaFishingAreas';
