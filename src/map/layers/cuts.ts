import { registerLayer, type LayerDef } from '../layerRegistry';
import { CUTS_ATTR, CUTS_BOUNDS, CUTS_TILES } from '../sources';

export const cutsLayer: LayerDef = {
  id: 'logging-cuts', name: 'Logging cuts', category: 'vegetation', defaultOpacity: 0.85,
  attribution: CUTS_ATTR,
  variants: [{ id: '2001', label: '2001–2025', tiles: [CUTS_TILES] },
    ...Array.from({ length: 24 }, (_, i) => {
      const year = 2002 + i;
      return { id: String(year), label: `${year}–2025`, tiles: [`cuts://${year}/{z}/{x}/{y}.webp`] };
    })],
  defaultVariant: '2001',
  source: { kind: 'raster', tiles: [CUTS_TILES], tileSize: 256, minzoom: 5, maxzoom: 13, bounds: CUTS_BOUNDS },
  cacheRoute: /\/tiles\/cuts\/v[1-9]\d*\/\d+\/\d+\/\d+\.webp$/,
  cacheStrategy: 'CacheFirst',
  legend: [
    { color: '#64869b', label: '2001' }, { color: '#80b6ac', label: '2007' },
    { color: '#e8cf78', label: '2013' }, { color: '#ed923e', label: '2019' },
    { color: '#ef4938', label: '2025' },
  ],
};
registerLayer(cutsLayer);
