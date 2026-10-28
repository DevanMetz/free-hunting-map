import { UI_ICONS, type UiIcon } from './icons';

type Attrs = Record<string, string | number | boolean | undefined | EventListener>;

/** Tiny element builder: h('button', { class: 'x', onclick: fn }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Icon-only button; `label` becomes aria-label and title. */
export function iconButton(icon: UiIcon, label: string, onclick: () => void, extraClass = ''): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: `icon-btn ${extraClass}`.trim(),
    'aria-label': label,
    title: label,
    html: UI_ICONS[icon],
    onclick: () => onclick(),
  });
}

let toastTimer = 0;
export function toast(message: string, ms = 2600): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

export function fmtTime(d: Date | null, timeZone?: string): string {
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export async function copyText(text: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Could not copy');
  }
}
