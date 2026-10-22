import jsQR from 'jsqr';

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/**
 * Scans QR codes from the rear camera into `video`. Uses the native
 * BarcodeDetector when available, otherwise jsQR on a canvas.
 * Returns a stop function that releases the camera.
 */
export async function startScanner(video: HTMLVideoElement, onText: (text: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();

  const detector = await nativeDetector();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let running = true;
  let busy = false;

  const tick = async (): Promise<void> => {
    if (!running) return;
    if (!busy && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
      busy = true;
      try {
        if (detector) {
          for (const code of await detector.detect(video)) onText(code.rawValue);
        } else if (ctx) {
          const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) onText(code.data);
        }
      } catch {
        // Ignore per-frame failures; keep scanning.
      }
      busy = false;
    }
    requestAnimationFrame(() => void tick());
  };
  void tick();

  return () => {
    running = false;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
}

async function nativeDetector(): Promise<DetectorLike | null> {
  const BD = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): DetectorLike; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
    return formats.includes('qr_code') ? new BD({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}
