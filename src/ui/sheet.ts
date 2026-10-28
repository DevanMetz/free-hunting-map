import { h, iconButton } from './dom';

/**
 * Single bottom sheet (side panel on wide screens). Opening replaces content;
 * the previous panel's onClose runs first so tools can clean up.
 */
export class Sheet {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly body: HTMLElement;
  private onClose: (() => void) | null = null;
  current: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.titleEl = h('h2', { class: 'sheet-title' });
    this.body = h('div', { class: 'sheet-body' });
    root.append(h('header', { class: 'sheet-head' }, this.titleEl, iconButton('close', 'Close', () => this.close())), this.body);
    document.addEventListener('keydown', this.onEscape);
  }

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || !this.root.isConnected || this.root.hidden) return;
    if (document.querySelector('dialog[open], .land-info:not([hidden])')) return;
    this.close();
  };

  open(key: string, title: string, content: HTMLElement, onClose?: () => void): void {
    this.runOnClose();
    this.current = key;
    this.titleEl.textContent = title;
    this.body.replaceChildren(content);
    this.onClose = onClose ?? null;
    this.root.hidden = false;
    this.root.dataset.panel = key;
  }

  /** Swap content without running onClose (e.g. step within a panel). */
  replace(content: HTMLElement, title?: string): void {
    if (title !== undefined) this.titleEl.textContent = title;
    this.body.replaceChildren(content);
  }

  setTitle(title: string): void {
    this.titleEl.textContent = title;
  }

  close(): void {
    const returnFocus = this.root.contains(document.activeElement);
    this.runOnClose();
    this.current = null;
    this.root.hidden = true;
    this.body.replaceChildren();
    document.dispatchEvent(new Event('sheet-closed'));
    if (returnFocus) document.querySelector<HTMLElement>('#map canvas')?.focus();
  }

  private runOnClose(): void {
    const fn = this.onClose;
    this.onClose = null;
    fn?.();
  }
}
