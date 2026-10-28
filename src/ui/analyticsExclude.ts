import { h } from './dom';

export function excludeDeviceSwitch(): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', onchange: () => {
    try {
      if (input.checked) localStorage.setItem('fhm_analytics_exclude','internal');
      else if (localStorage.getItem('fhm_analytics_exclude') === 'internal') localStorage.removeItem('fhm_analytics_exclude');
    } catch { input.checked = !input.checked; }
  } });
  try { input.checked = localStorage.getItem('fhm_analytics_exclude') === 'internal'; }
  catch { input.disabled = true; }
  return h('label', { class: 'toggle' }, input, 'Exclude this device');
}
