// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { openIdentifyPanel } from './identifyPanel';
import { trailDetails } from '../map/trails';
import { Sheet } from './sheet';

it('renders trail information as accessible plain text with only populated rows', () => {
  const root = document.createElement('section');
  const sheet = new Sheet(root);
  openIdentifyPanel(sheet, 'public-trails', trailDetails({ name: '<img src=x>', type: 'bike', uses: 'Hike, Bike', agency: 'BLM', src: 'blm_gtlf', date: '2026-10-24' }));
  expect(root.hidden).toBe(false); expect(sheet.current).toBe('public-trails');
  expect(root.querySelector('h2')?.textContent).toBe('<img src=x>'); expect(root.querySelector('img')).toBeNull();
  expect([...root.querySelectorAll('dt')].map(row => row.textContent)).toEqual(['Type', 'Allowed uses', 'Agency', 'Source']);
  expect([...root.querySelectorAll('dd')].map(row => row.textContent)).toEqual(['Bike trail', 'Hike, Bike', 'BLM', 'BLM Ground Transportation · 2026-10-24']);
  root.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(); expect(root.hidden).toBe(true);
});
