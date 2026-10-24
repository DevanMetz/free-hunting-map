import { registerLayer } from '../layerRegistry';
import { roadLineDef, roadRows, roadText as text } from '../roadLines';

const statuses: Record<string, string> = { closed: 'Closed', decom: 'Decommissioned', unauth: 'Unauthorized', decommissioned: 'Decommissioned', unauthorized: 'Unauthorized' };
registerLayer(roadLineDef({
  id: 'usfs-closed-roads', name: 'Closed forest roads', archive: 'usfs-closed-roads', sourceLayer: 'usfs',
  attribution: 'USDA Forest Service',
  classes: [
    { key: 'closed', label: 'Closed', color: '#cf2939', dash: [4, 2], filter: ['==', ['get', 's'], 'closed'] },
    { key: 'decom', label: 'Decommissioned', color: '#858580', dash: [0.5, 2], filter: ['in', ['get', 's'], ['literal', ['decom', 'decommissioned']]] },
    { key: 'unauth', label: 'Unauthorized', color: '#9446b5', dash: [3, 2], filter: ['in', ['get', 's'], ['literal', ['unauth', 'unauthorized']]] },
  ],
  details: p => ({ title: text(p.n) || 'Closed forest road', rows: roadRows([
    ['Status', statuses[text(p.s)] ?? text(p.s)], ['Name/number', text(p.n)], ['Maintenance level', text(p.ml)],
    ['Forest', text(p.f)], ['Source date/notes', text(p.d)],
  ]) }),
}));
