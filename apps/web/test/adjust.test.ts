import { describe, expect, it } from 'vitest';
import { adjustPixels, isAdjusted } from '../src/engine/adjust';

const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);
describe('image adjustments', () => {
  it('leaves pixels alone at zero', () => { const d = px(120, 80, 200); adjustPixels(d, {}); expect([...d]).toEqual([120, 80, 200, 255]); expect(isAdjusted({ exposure: 0 })).toBe(false); expect(isAdjusted({ tint: 5 })).toBe(true); });
  it('exposure brightens and darkens', () => { const up = px(100, 100, 100), dn = px(100, 100, 100); adjustPixels(up, { exposure: 50 }); adjustPixels(dn, { exposure: -50 }); expect(up[0]).toBeGreaterThan(100); expect(dn[0]).toBeLessThan(100); });
  it('saturation -100 gives grey; +100 spreads channels', () => { const g = px(255, 0, 0); adjustPixels(g, { saturation: -100 }); expect(Math.abs(g[0] - g[1])).toBeLessThan(2); const v = px(150, 100, 100), v0 = [...v]; adjustPixels(v, { saturation: 100 }); expect(v[0] - v[1]).toBeGreaterThan(v0[0] - v0[1]); });
  it('contrast pushes values away from mid grey', () => { const hi = px(180, 180, 180), lo = px(80, 80, 80); adjustPixels(hi, { contrast: 60 }); adjustPixels(lo, { contrast: 60 }); expect(hi[0]).toBeGreaterThan(180); expect(lo[0]).toBeLessThan(80); });
  it('temperature warms (red up, blue down); tint moves green', () => { const d = px(128, 128, 128); adjustPixels(d, { temperature: 80 }); expect(d[0]).toBeGreaterThan(d[2]); const m = px(128, 128, 128); adjustPixels(m, { tint: 80 }); expect(m[1]).toBeLessThan(m[0]); });
  it('highlights only touch bright pixels, shadows only dark ones', () => { const bright = px(240, 240, 240), dark = px(20, 20, 20); adjustPixels(bright, { highlights: -80 }); adjustPixels(dark, { highlights: -80 }); expect(bright[0]).toBeLessThan(240); expect(dark[0]).toBe(20); const d2 = px(20, 20, 20), b2 = px(240, 240, 240); adjustPixels(d2, { shadows: 80 }); adjustPixels(b2, { shadows: 80 }); expect(d2[0]).toBeGreaterThan(20); expect(b2[0]).toBe(240); });
});
