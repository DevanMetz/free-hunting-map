/** Palette used by scripts/cuts/tile.py, with nearest-color estimates for blended overviews. */
const stops = [[100, 134, 155], [128, 182, 172], [232, 207, 120], [237, 146, 62], [239, 73, 56]];
export const cutsPalette = Array.from({ length: 25 }, (_, i) => {
  const segment = Math.min(3, Math.floor(i / 6));
  const t = (i - segment * 6) / 6;
  return stops[segment]!.map((value, channel) => Math.round(value + (stops[segment + 1]![channel]! - value) * t));
});

export function filterCutsPixels(pixels: Uint8ClampedArray, firstYear: number): void {
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    let closest = 0, distance = Infinity;
    for (let year = 0; year < cutsPalette.length; year++) {
      const color = cutsPalette[year]!;
      const d = (pixels[i]! - color[0]!) ** 2 + (pixels[i + 1]! - color[1]!) ** 2 + (pixels[i + 2]! - color[2]!) ** 2;
      if (d < distance) { distance = d; closest = year; }
    }
    if (2001 + closest < firstYear) pixels[i + 3] = 0;
  }
}
