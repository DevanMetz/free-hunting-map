import { aspectSpan } from '../beds/profile';

/** Compass arc. North is up. The wedge is the kept aspect, clockwise from the first handle. */
export function aspectDial(
  start: number,
  end: number,
  onChange: (start: number, end: number) => void,
): SVGSVGElement & { set(start: number, end: number): void } {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 160');
  svg.setAttribute('class', 'aspect-dial');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('aria-label', 'Aspect');
  svg.tabIndex = 0;
  const ring = document.createElementNS(svg.namespaceURI, 'circle');
  ring.setAttribute('cx', '80');
  ring.setAttribute('cy', '80');
  ring.setAttribute('r', '58');
  ring.setAttribute('class', 'ring');
  const wedge = document.createElementNS(svg.namespaceURI, 'path');
  wedge.setAttribute('class', 'wedge');
  const north = document.createElementNS(svg.namespaceURI, 'text');
  north.setAttribute('x', '80');
  north.setAttribute('y', '18');
  north.setAttribute('text-anchor', 'middle');
  north.textContent = 'N';
  const handleA = handle();
  const handleB = handle();
  svg.append(ring, wedge, north, handleA, handleB);
  let currentStart = start;
  let currentEnd = end;
  let drag: 'start' | 'end' | null = null;

  const draw = (): void => {
    const span = Math.round(aspectSpan(currentStart, currentEnd));
    wedge.setAttribute('d', sector(currentStart, currentEnd));
    place(handleA, currentStart);
    place(handleB, currentEnd);
    svg.setAttribute('aria-valuemin', '0');
    svg.setAttribute('aria-valuemax', '360');
    svg.setAttribute('aria-valuenow', String(Math.round(currentStart)));
    svg.setAttribute('aria-valuetext', `${Math.round(currentStart)} to ${Math.round(currentEnd)}, ${span}°`);
  };

  const pointer = (event: PointerEvent): number => {
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    return (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  };

  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const angle = pointer(event);
    drag = delta(angle, currentStart) <= delta(angle, currentEnd) ? 'start' : 'end';
    if (drag === 'start') currentStart = angle;
    else currentEnd = angle;
    draw();
    onChange(currentStart, currentEnd);
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const angle = pointer(event);
    if (drag === 'start') currentStart = angle;
    else currentEnd = angle;
    draw();
    onChange(currentStart, currentEnd);
  });
  const stop = (): void => { drag = null; };
  svg.addEventListener('pointerup', stop);
  svg.addEventListener('pointercancel', stop);
  svg.addEventListener('keydown', event => {
    const step = event.shiftKey ? 15 : 5;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const sign = event.key === 'ArrowRight' ? step : -step;
    if (event.altKey) currentEnd = (currentEnd + sign + 360) % 360;
    else currentStart = (currentStart + sign + 360) % 360;
    draw();
    onChange(currentStart, currentEnd);
    event.preventDefault();
  });
  draw();
  return Object.assign(svg, {
    set(nextStart: number, nextEnd: number) {
      if (drag) return;
      currentStart = nextStart;
      currentEnd = nextEnd;
      draw();
    },
  });
}

function handle(): SVGCircleElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  node.setAttribute('r', '7');
  node.setAttribute('class', 'handle');
  return node;
}

function place(node: SVGCircleElement, deg: number): void {
  const point = polar(deg, 58);
  node.setAttribute('cx', String(point.x));
  node.setAttribute('cy', String(point.y));
}

function sector(start: number, end: number): string {
  const span = aspectSpan(start, end);
  const from = polar(start, 58);
  const to = polar(end, 58);
  const large = span > 180 ? 1 : 0;
  return `M 80 80 L ${from.x.toFixed(1)} ${from.y.toFixed(1)} A 58 58 0 ${large} 1 ${to.x.toFixed(1)} ${to.y.toFixed(1)} Z`;
}

function polar(deg: number, radius: number): { x: number; y: number } {
  const rad = ((deg % 360) + 360) % 360 * Math.PI / 180;
  return { x: 80 + Math.sin(rad) * radius, y: 80 - Math.cos(rad) * radius };
}

function delta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
