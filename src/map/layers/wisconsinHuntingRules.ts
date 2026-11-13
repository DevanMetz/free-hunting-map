import { registerRulesLayer } from './rulesLayer';
import '../rules/wisconsin';

const atlas = 'https://dnr.wisconsin.gov/topic/hunt/dates';
registerRulesLayer({
  id: 'wisconsin-hunting-rules',
  name: 'Hunting rules (WI)',
  state: 'WI',
  attribution: `<a href="${atlas}">Wisconsin Department of Natural Resources</a>`,
  cacheRoute: /^https:\/\/dnrmaps\.wi\.gov\/(?:arcgis2\/rest\/services\/WM_PROP_MGMT\/WM_CLOSED_RESTRICTED_AREAS_WTM_Ext\/MapServer\/0|arcgis\/rest\/services\/(?:DW_Map_Dynamic\/EN_Municipality_Boundary_WTM_Ext\/MapServer\/0|WM_CWD\/WM_DMU_MSU_DMZ_Ext\/MapServer\/2))\/query\?/,
});
