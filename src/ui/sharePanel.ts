import { forSharing } from '../organize/model';
import { useFeature } from '../usage';
import { parseTakeoutText, parseTakeoutZip } from '../share/takeout/parse';
import { importTakeout } from '../share/takeout/import';
import QRCode from 'qrcode';
import { iconSvg } from '../map/icons';
import { downloadFile, parseFileText, serialize, shareFile, type ExportFormat } from '../share/files';
import { encodeItemsToChunks, QrAssembler } from '../share/qr';
import { startScanner } from '../share/scanner';
import type { Item } from '../types';
import type { AppContext } from './context';
import { h, iconButton, toast } from './dom';
import { displayName } from './itemPanel';

const QR_CYCLE_MS = 1100;

export function openSharePanel(ctx: AppContext): void {
  const selected = new Set(ctx.items().map((i) => i.id));
  const picked = (): Item[] => ctx.items().filter((i) => selected.has(i.id)).map(i => forSharing(i, ctx.categories()));

  const list = h(
    'ul',
    { class: 'item-list selectable' },
    ...[...ctx.items()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) =>
        h(
          'li',
          {},
          h(
            'label',
            { class: 'item-row' },
            h('input', {
              type: 'checkbox',
              checked: true,
              onchange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) selected.add(item.id);
                else selected.delete(item.id);
              },
            }),
            item.kind === 'waypoint' ? h('span', { class: 'glyph', html: iconSvg(item.icon, 24) }) : h('span', { class: 'glyph track-glyph' }),
            h('span', { class: 'name' }, displayName(item)),
          ),
        ),
      ),
  );

  const requireSelection = (fn: (items: Item[]) => void) => () => {
    const items = picked();
    if (!items.length) return toast('Nothing selected');
    fn(items);
  };

  const fileInput = h('input', {
    type: 'file',
    accept: '.zip,.csv,.gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json',
    hidden: true,
    onchange: () => void importFiles(ctx, fileInput),
  });

  const body = h(
    'div',
    { class: 'share' },
    h(
      'div',
      { class: 'toolbar-row' },
      iconButton('qr', 'Show QR', requireSelection((items) => showQr(ctx, items))),
      iconButton('scan', 'Scan QR', () => openScanner(ctx)),
      exportButton('GPX', 'gpx', picked),
      exportButton('GeoJSON', 'geojson', picked),
      iconButton('upload', 'Import file', () => fileInput.click()),
      fileInput,
    ),
    ctx.items().length ? list : null,
  );
  ctx.sheet.open('share', 'Share', body);
}

function exportButton(label: string, format: ExportFormat, picked: () => Item[]): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'btn',
      title: `Export ${label}`,
      onclick: () => {
        const items = picked();
        if (!items.length) return toast('Nothing selected');
        useFeature(format === 'gpx' ? 'gpx_export' : 'geojson_export');
        const { name, mime, text } = serialize(items, format);
        void shareFile(name, mime, text).then((r) => {
          if (r === 'unsupported') downloadFile(name, mime, text);
        });
      },
    },
    label,
  );
}

async function importFiles(ctx: AppContext, input: HTMLInputElement): Promise<void> {
  for (const file of input.files ?? []) {
    let feature: 'takeout_import'|'gpx_import'|'geojson_import' = /\.(zip|csv)$/i.test(file.name) ? 'takeout_import' : /\.gpx$/i.test(file.name) ? 'gpx_import' : 'geojson_import';
    try {
      const text = /\.zip$/i.test(file.name) ? '' : await file.text();
      const takeout = /\.zip$/i.test(file.name)
        ? parseTakeoutZip(new Uint8Array(await file.arrayBuffer()))
        : /\.(csv|json|geojson)$/i.test(file.name) ? parseTakeoutText(file.name, text) : null;
      if (takeout) {
        feature='takeout_import';
        const r = await importTakeout(ctx.repo, takeout, `file:${file.name}`);
        useFeature(feature,'ok');
        toast(`${r.imported} imported · ${r.duplicates} duplicates · ${r.skipped} skipped`);
        continue;
      }
      const items = parseFileText(file.name, text);
      const r = await ctx.repo.importItems(items, `file:${file.name}`);
      useFeature(feature,'ok');
      toast(`${r.changed} new / ${r.received}`);
    } catch (e) {
      useFeature(feature,'fail');
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  input.value = '';
}

function showQr(ctx: AppContext, items: Item[]): void {
  useFeature('qr_share');
  const chunks = encodeItemsToChunks(items);
  const canvas = h('canvas', { class: 'qr', 'aria-label': 'QR code' });
  const counter = h('span', { class: 'counter' });
  let index = 0;
  let playing = chunks.length > 1;
  let timer = 0;

  const draw = (): void => {
    void QRCode.toCanvas(canvas, chunks[index]!, { errorCorrectionLevel: 'L', margin: 2, width: Math.min(360, window.innerWidth - 48) });
    counter.textContent = `${index + 1}/${chunks.length}`;
  };
  const step = (d: number): void => {
    index = (index + d + chunks.length) % chunks.length;
    draw();
  };
  const schedule = (): void => {
    clearInterval(timer);
    if (playing) timer = window.setInterval(() => step(1), QR_CYCLE_MS);
  };
  const playBtn = iconButton(playing ? 'pause' : 'play', 'Play / pause', () => {
    playing = !playing;
    playBtn.innerHTML = iconButton(playing ? 'pause' : 'play', '', () => {}).innerHTML;
    schedule();
  });

  const body = h(
    'div',
    { class: 'qr-view' },
    canvas,
    chunks.length > 1
      ? h('div', { class: 'row center' }, iconButton('prev', 'Previous', () => step(-1)), counter, playBtn, iconButton('next', 'Next', () => step(1)))
      : null,
  );
  draw();
  schedule();
  ctx.sheet.open('share-qr', 'QR', body, () => clearInterval(timer));
}

function openScanner(ctx: AppContext): void {
  const video = h('video', { class: 'scanner', playsinline: true, muted: true, 'aria-label': 'Camera' });
  const progress = h('div', { class: 'progress', role: 'status' });
  const bar = h('div', { class: 'bar' });
  const assembler = new QrAssembler();
  let stop: (() => void) | null = null;
  let done = false;

  const body = h('div', { class: 'scan-view' }, video, h('div', { class: 'meter' }, bar), progress);
  ctx.sheet.open('share-scan', 'Scan', body, () => stop?.());

  const onText = (text: string): void => {
    if (done) return;
    const r = assembler.add(text);
    if (r.status === 'progress') {
      progress.textContent = `${r.have}/${r.total}`;
      bar.style.width = `${(100 * r.have) / r.total}%`;
    } else if (r.status === 'complete') {
      done = true;
      bar.style.width = '100%';
      void ctx.repo.importItems(r.items, 'qr').then((res) => {
        toast(`${res.changed} new / ${res.received}`);
        ctx.sheet.close();
      });
    } else if (r.status === 'error') {
      progress.textContent = r.message;
    }
  };

  startScanner(video, onText)
    .then((s) => {
      if (ctx.sheet.current === 'share-scan') stop = s;
      else s();
    })
    .catch((e: unknown) => {
      progress.textContent = e instanceof Error ? e.message : 'Camera unavailable';
    });
}
