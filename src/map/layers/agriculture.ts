import { registerLayer } from '../layerRegistry';
import { rasterIdentify, rasterTiles } from './raster';

// Catalog verified 2026-10-24: OBJECTID 40 = 2025_10m_cdls, Year = 2025.
const CDL = 'https://pdi.scinet.usda.gov/image/rest/services/CDL_WM/ImageServer';
const options = { mosaicRule: JSON.stringify({ where: 'Year = 2025' }), time: '1735689600000',
  renderingRule: JSON.stringify({ rasterFunction: 'croptypes' }), noData: '0' };
registerLayer({
  id: 'cropland', category: 'agriculture', name: 'Crops (2025)', defaultOpacity: 0.65, minzoom: 9, maxzoom: 18,
  attribution: '<a href="https://www.nass.usda.gov/Research_and_Science/Cropland/Release/">USDA NASS CDL 2025</a>',
  cacheRoute: /^https:\/\/pdi\.scinet\.usda\.gov\/image\/rest\/services\/CDL_WM\/ImageServer\/(?:exportImage|rasterAttributeTable)\?/,
  source: { kind: 'raster', tiles: [rasterTiles(CDL, options)], minzoom: 9, maxzoom: 16 },
  legend: [
    { color: '#ffd300', label: 'Corn' },
    { color: '#267000', label: 'Soybeans' },
    { color: '#ffa5e2', label: 'Alfalfa' },
    { color: '#a5f28c', label: 'Other hay' },
    { color: '#a57000', label: 'Winter wheat' },
    { color: '#d8b56b', label: 'Spring wheat' },
    { color: '#a05989', label: 'Oats' },
    { color: '#ac007c', label: 'Rye' },
    { color: '#e8ffbf', label: 'Pasture/grass' },
    { color: '#bfbf77', label: 'Fallow' },
    { color: '#93cc93', label: 'Forest' },
    { color: '#7eb1b1', label: 'Wetlands' },
    { color: '#4b70a3', label: 'Water' },
  ],
  identify: rasterIdentify(CDL, 'Crops', 'Crop', options, { rasterFunction: 'croptypes', nameField: 'Class_Name' }, '2025'),
});
