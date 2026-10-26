import { addProtocol } from 'maplibre-gl';
import { filterCutsPixels } from './cutsFilter';

// Fetch the original URL so the existing service-worker cache remains authoritative.
addProtocol('cuts', async (request, abort) => {
  const match = /^cuts:\/\/(20\d\d)\/(\d+\/\d+\/\d+\.webp)$/.exec(request.url);
  if (!match || +match[1]! < 2002 || +match[1]! > 2025) throw new Error('Invalid cuts tile');
  const response = await fetch(`/tiles/cuts/v1/${match[2]}`, { signal: abort.signal });
  if (!response.ok) throw new Error(`Cuts tile request failed: ${response.status}`);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  if (response.status !== 204) {
    const bitmap = await createImageBitmap(await response.blob());
    try { context.drawImage(bitmap, 0, 0); } finally { bitmap.close(); }
    const image = context.getImageData(0, 0, 256, 256);
    filterCutsPixels(image.data, +match[1]!);
    context.putImageData(image, 0, 0);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas encoding failed')), 'image/png'));
  return { data: await blob.arrayBuffer() };
});
