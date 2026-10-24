import { registerLayer } from '../layerRegistry';
import { roadLineDef, roadRows, roadText as text } from '../roadLines';

registerLayer(roadLineDef({
  id: 'osm-tracks', name: 'OSM tracks', archive: 'osm-tracks', version: 'v2', sourceLayer: 'osm',
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
  classes: [
    { key: 'grade1', label: 'Grade 1', color: '#50301d', filter: ['==', ['get', 'g'], 1] },
    { key: 'grade2', label: 'Grade 2', color: '#85502b', filter: ['==', ['get', 'g'], 2] },
    { key: 'grade3', label: 'Grade 3', color: '#d77720', dash: [3, 2], filter: ['==', ['get', 'g'], 3] },
    { key: 'grade4', label: 'Grade 4', color: '#c4a06b', dash: [3, 2], filter: ['==', ['get', 'g'], 4] },
    { key: 'grade5', label: 'Grade 5', color: '#e8d8b4', dash: [0.5, 2], filter: ['==', ['get', 'g'], 5] },
    { key: 'unknown', label: 'Unknown', color: '#878787', dash: [3, 2], filter: ['!', ['in', ['get', 'g'], ['literal', [1, 2, 3, 4, 5]]]] },
  ],
  details(p) {
    const id = text(p.id), grade = Number(p.g);
    return { title: text(p.n) || 'OSM track', rows: roadRows([
      ['Grade', grade >= 1 && grade <= 5 ? String(grade) : 'Unknown'], ['Surface', text(p.s)],
      ['Access', text(p.a)], ['Name', text(p.n)], ['OSM way', id],
    ]), ...(/^\d+$/.test(id) ? { links: [{ label: 'OpenStreetMap', url: `https://www.openstreetmap.org/way/${id}` }] } : {}) };
  },
}));
