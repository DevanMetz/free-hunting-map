import { wisconsinAccessPoints } from '../access/wisconsin';
import { registerAccessLayer } from './accessLayer';

const atlas = 'https://dnr.wisconsin.gov/topic/fl/RealEstate/PALApplication';
registerAccessLayer({
  id: 'wisconsin-parking',
  name: 'Parking and access (WI)',
  attribution: `<a href="${atlas}">Wisconsin Department of Natural Resources</a>`,
  cacheRoute: /^https:\/\/dnrmaps\.wi\.gov\/(?:arcgis\/rest\/services\/WM_LMS\/WM_LMS_Conservation_Infrastructure_WTM_Int\/MapServer\/27|arcgis2\/rest\/services\/PR_Recreation\/PR_Boat_Access_Shore_Fishing_WTM_Ext\/MapServer\/2)\/query\?/,
  load: wisconsinAccessPoints,
  userPullouts: true,
  swatch: '#2f6f4e',
  legend: [
    { color: '#2f6f4e', label: 'DNR parking' },
    { color: '#3d7ea6', label: 'Boat access' },
    { color: '#d39234', label: 'Pullout' },
  ],
});
