import type { ImageAdjust } from '@layr/core';

export const NO_ADJUST: ImageAdjust = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0 };
export const isAdjusted = (a?: Partial<ImageAdjust>) => !!a && Object.values(a).some(v => typeof v === 'number' && v !== 0);

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** In-place RGBA pixel adjustment (DOM-free so it can be unit-tested). Each control runs -100..100, 0 is neutral. */
export function adjustPixels(d: Uint8ClampedArray, adj: Partial<ImageAdjust>) {
  const a = { ...NO_ADJUST, ...adj };
  const exp = Math.pow(2, (a.exposure / 100) * 2); // ±2 stops
  const con = 1 + a.contrast / 100;
  const sat = 1 + a.saturation / 100;
  const tr = 1 + (a.temperature / 100) * 0.3, tb = 1 - (a.temperature / 100) * 0.3; // warm adds red, removes blue
  const tg = 1 - (a.tint / 100) * 0.25; // positive tint → magenta (less green)
  const hi = (a.highlights / 100) * 90, lo = (a.shadows / 100) * 90;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * exp, g = d[i + 1] * exp, b = d[i + 2] * exp;
    r *= tr; g *= tg; b *= tb;
    r = (r - 128) * con + 128; g = (g - 128) * con + 128; b = (b - 128) * con + 128;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    if (hi || lo) {
      const l = Math.min(1, Math.max(0, (0.299 * r + 0.587 * g + 0.114 * b) / 255));
      const k = hi * smooth(0.5, 1, l) + lo * (1 - smooth(0, 0.5, l));
      r += k; g += k; b += k;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; // Uint8ClampedArray clamps
  }
}

const cache = new Map<string, HTMLCanvasElement>();
/** Adjusted copy of an image, cached by asset + settings (capped at 1600px on the long side). */
export function adjustedImage(img: HTMLImageElement, assetId: string, adj: Partial<ImageAdjust>): HTMLCanvasElement | null {
  const key = `${assetId}|${Object.entries(adj).sort().join(',')}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try { const data = ctx.getImageData(0, 0, w, h); adjustPixels(data.data, adj); ctx.putImageData(data, 0, 0); } catch { return null; }
  cache.set(key, cv); if (cache.size > 10) cache.delete(cache.keys().next().value as string);
  return cv;
}
