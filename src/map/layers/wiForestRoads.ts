import { registerLayer } from '../layerRegistry';
import { roadLineDef, roadRows, roadText as text } from '../roadLines';

const sources: Record<string, string> = { bfroad: 'Bayfield County forest roads', bfaccess: 'Bayfield County forest access' };
registerLayer(roadLineDef({
  id: 'county-forest-roads', name: 'County forest roads', archive: 'wi-forest-roads', sourceLayer: 'wiforest',
  attribution: 'Bayfield County',
  classes: [
    { key: 'roads', label: 'Forest road', color: '#216c43', dash: [3, 2], filter: ['==', ['get', 't'], 'forest road'] },
    { key: 'atv', label: 'ATV/UTV trail', color: '#54802a', dash: [3, 2], filter: ['==', ['get', 't'], 'ATV/UTV trail'] },
    { key: 'foot', label: 'Non-motorized trail', color: '#298e7a', dash: [2, 2], filter: ['==', ['get', 't'], 'non-motorized trail'] },
  ],
  details: p => ({ title: text(p.n) || 'County forest road', rows: roadRows([
    ['Source', sources[text(p.src)] ?? text(p.src)], ['Name', text(p.n)], ['Type', text(p.t)], ['Owner/agency', text(p.o)],
  ]) }),
}));
