import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { layerRegistry } from '../layerRegistry';
import '../builtinLayers';

it('allows registered raster service origins through the deployed connect policy', () => {
  const headers = readFileSync(new URL('../../../public/_headers', import.meta.url), 'utf8');
  const connect = headers.match(/connect-src ([^;]+)/)?.[1]?.split(/\s+/) ?? [];
  for (const def of layerRegistry.layers()) {
    for (const tile of def.source?.tiles ?? []) {
      const origin = new URL(tile).origin;
      const allowed = connect.some(rule => rule === origin || rule.includes('*.') &&
        origin.startsWith(rule.split('*.')[0]!) && new URL(origin).hostname.endsWith(`.${rule.split('*.')[1]}`));
      expect(allowed, `${def.id}: ${origin}`).toBe(true);
    }
  }
});
