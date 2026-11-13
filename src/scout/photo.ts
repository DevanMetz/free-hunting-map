/** Shrink a trail-cam or sighting photo to a JPEG data URL that fits a sync record. */
export async function shrinkPhoto(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  try {
    for (const size of [960, 720, 480]) {
      for (const quality of [0.7, 0.5, 0.35]) {
        const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', quality));
        if (!blob || blob.size > 120_000) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return `data:image/jpeg;base64,${btoa(binary)}`;
      }
    }
  } finally {
    bitmap.close();
  }
  return null;
}
