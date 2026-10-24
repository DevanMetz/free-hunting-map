import type { WaypointIcon } from '../types';

/** Waypoint glyphs: 24x24 SVG path data drawn white on a colored disc. */
export const ICON_STYLE: Record<WaypointIcon, { color: string; path: string; title: string }> = {
  trailcam: { color: '#7c9663', title: 'Trail cam', path: 'M6 3h12v18H6zM9 5h6v3H9zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12a2 2 0 1 1 0 4 2 2 0 0 1 0-4z' },
  pin: { color: '#e87826', title: 'Pin', path: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z' },
  stand: {
    color: '#8d6e3f',
    title: 'Stand',
    path: 'M7 5h10v3H7zM8 8h2v11H8zM14 8h2v11h-2zM10 11h4v1.6h-4zM10 15h4v1.6h-4z',
  },
  blood: { color: '#c62828', title: 'Blood', path: 'M12 4c3 4.2 5 7.1 5 9.5a5 5 0 0 1-10 0C7 11.1 9 8.2 12 4z' },
  rub: {
    color: '#6d8b3a',
    title: 'Rub',
    path: 'M11 4h2v16h-2zM13 7l4-3 1 1.4-5 3.6zM11 11l-4-3-1 1.4 5 3.6zM13 13l3.5-2.2.9 1.4-4.4 2.8z',
  },
  camp: { color: '#2e7d6b', title: 'Camp', path: 'M12 4l8 15H4zM12 11l-3 8h6z' },
  truck: {
    color: '#3f6fb5',
    title: 'Truck',
    path: 'M3 8h10v8H3zM13 10h4l3 3v3h-7zM6 15.5a2 2 0 1 0 0 .01zM16.5 15.5a2 2 0 1 0 0 .01z',
  },
};

export function iconSvg(icon: WaypointIcon, size = 40, overrideColor?: string): string {
  const { color: defaultColor, path } = ICON_STYLE[icon];
  const color = overrideColor ?? defaultColor;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-2 -2 28 28">` +
    `<circle cx="12" cy="12" r="12.5" fill="${color}" stroke="#fff" stroke-width="2"/>` +
    `<path d="${path}" fill="#fff" fill-rule="evenodd"/></svg>`
  );
}

/** Rasterize an icon for map.addImage. */
export function loadIconImage(icon: WaypointIcon, size = 40, color?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(icon, size, color))}`;
  });
}
