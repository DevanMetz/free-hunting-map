import type { LayerDef } from '../map/layerRegistry';

// Approximate state centers are used only to order the layer picker, never for boundaries.
const states: [string, string, number, number][] = [
  ['AL','Alabama',-86.8,32.8], ['AK','Alaska',-152,64], ['AZ','Arizona',-111.9,34.3], ['AR','Arkansas',-92.4,34.9],
  ['CA','California',-119.5,37.2], ['CO','Colorado',-105.5,39], ['CT','Connecticut',-72.7,41.6], ['DE','Delaware',-75.5,39],
  ['FL','Florida',-82,28.5], ['GA','Georgia',-83.5,32.7], ['HI','Hawaii',-157.5,20.8], ['ID','Idaho',-114.5,44.2],
  ['IL','Illinois',-89,40], ['IN','Indiana',-86.1,40], ['IA','Iowa',-93.5,42], ['KS','Kansas',-98,38.5],
  ['KY','Kentucky',-85.3,37.5], ['LA','Louisiana',-92.4,31], ['ME','Maine',-69,45.2], ['MD','Maryland',-76.7,39],
  ['MA','Massachusetts',-71.8,42.3], ['MI','Michigan',-85.4,44.3], ['MN','Minnesota',-94.5,46], ['MS','Mississippi',-89.7,32.7],
  ['MO','Missouri',-92.5,38.5], ['MT','Montana',-110.5,47], ['NE','Nebraska',-99.8,41.5], ['NV','Nevada',-116.9,39],
  ['NH','New Hampshire',-71.6,43.8], ['NJ','New Jersey',-74.6,40.1], ['NM','New Mexico',-106,34.5], ['NY','New York',-75.5,43],
  ['NC','North Carolina',-79.8,35.5], ['ND','North Dakota',-100.5,47.5], ['OH','Ohio',-82.8,40.4], ['OK','Oklahoma',-97.5,35.5],
  ['OR','Oregon',-120.5,44], ['PA','Pennsylvania',-77.8,40.9], ['RI','Rhode Island',-71.5,41.7], ['SC','South Carolina',-80.9,33.8],
  ['SD','South Dakota',-100,44.4], ['TN','Tennessee',-86,35.8], ['TX','Texas',-99,31], ['UT','Utah',-111.7,39.3],
  ['VT','Vermont',-72.7,44], ['VA','Virginia',-78.5,37.7], ['WA','Washington',-120.7,47.4], ['WV','West Virginia',-80.6,38.6],
  ['WI','Wisconsin',-89.8,44.6], ['WY','Wyoming',-107.5,43],
];
export type LayerState = typeof states[number];
export function layerState(def: LayerDef): LayerState | undefined {
  const suffix = /\(([A-Z]{2})\)$/.exec(def.name)?.[1];
  return states.find(([code, name]) => code === suffix || def.id.startsWith(`${name.toLowerCase().replace(/ /g, '-')}-`));
}
export function stateDistance(state: LayerState, center: [number, number]): number {
  return Math.hypot((state[2] - center[0]) * Math.cos(center[1] * Math.PI / 180), state[3] - center[1]);
}
