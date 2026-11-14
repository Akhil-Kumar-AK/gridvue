import type { SceneNode, TextCase, TextProps } from '@layr/core';

export interface TextLine { text: string; width: number; top: number; /** left inset (hanging list text, first-line indent) */ indent: number; /** list marker drawn at x = 0 on the first line of a list paragraph */ prefix?: string; /** last line of its paragraph (never justified) */ last: boolean }
export interface TextLayout { lines: TextLine[]; width: number; height: number; lineHeightPx: number }

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx2d(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

const smallCaps = (t: TextProps) => t.textCase === 'SMALL_CAPS' || t.textCase === 'SMALL_CAPS_FORCED';
export function fontString(t: TextProps): string {
  return `${t.italic ? 'italic ' : ''}${smallCaps(t) ? 'small-caps ' : ''}${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
}
export const lineHeightPx = (t: TextProps) => (t.lineHeight === 'AUTO' ? Math.round(t.fontSize * 1.2 * 100) / 100 : t.lineHeight);

/** Case change applied before layout (small caps is a font variant instead). */
export function caseText(s: string, mode: TextCase | undefined): string {
  if (mode === 'UPPER') return s.toUpperCase();
  if (mode === 'LOWER') return s.toLowerCase();
  if (mode === 'TITLE') return s.replace(/(^|[\s"'(\[{-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
  return s;
}
/** Apply the text properties that live on the canvas context (font, spacing, kerning). */
export function applyTextStyle(c: CanvasRenderingContext2D, t: TextProps) {
  c.font = fontString(t);
  (c as any).letterSpacing = `${t.letterSpacing}px`;
  (c as any).fontKerning = t.features?.kern === false ? 'none' : 'auto';
}

/** Lay out text. Wrapping is greedy by word; over-long words are broken by character. */
export function layoutText(t: TextProps, boxWidth: number, c: CanvasRenderingContext2D = ctx2d(), boxHeight?: number): TextLayout {
  applyTextStyle(c, t);
  const lh = lineHeightPx(t);
  const wrapOn = t.resize !== 'AUTO_WIDTH' && t.wrap !== 'NONE';
  const spacing = t.paragraphSpacing ?? 0;
  const lines: TextLine[] = [];
  let top = 0, counter = 0;
  const paras = t.characters.split('\n');
  paras.forEach((raw, pi) => {
    const para = caseText(raw, t.textCase);
    const prefix = t.listStyle === 'BULLET' ? '\u2022  ' : t.listStyle === 'NUMBER' && para.trim() ? `${++counter}. ` : t.listStyle === 'NUMBER' ? '' : '';
    const hang = prefix ? c.measureText(prefix).width : 0;
    const first = prefix ? 0 : t.paragraphIndent ?? 0;
    const pieces: string[] = [];
    if (!wrapOn || para === '') pieces.push(para);
    else {
      let line = '', limit = boxWidth - hang - first;
      for (const word of para.split(/(?<= )/)) {
        const trial = line + word;
        if (line && c.measureText(trial.trimEnd()).width > limit) { pieces.push(line.trimEnd()); line = word; limit = boxWidth - hang; } else line = trial;
        while (c.measureText(line.trimEnd()).width > limit && line.length > 1) {
          let i = line.length - 1;
          while (i > 1 && c.measureText(line.slice(0, i)).width > limit) i--;
          pieces.push(line.slice(0, i)); line = line.slice(i); limit = boxWidth - hang;
        }
      }
      pieces.push(line.trimEnd());
    }
    pieces.forEach((text, k) => {
      const indent = hang + (k === 0 ? first : 0);
      lines.push({ text, width: c.measureText(text).width, top: top + k * lh, indent, prefix: k === 0 && prefix ? prefix : undefined, last: k === pieces.length - 1 });
    });
    top += pieces.length * lh + (pi < paras.length - 1 ? spacing : 0);
  });
  if (t.truncate && boxHeight !== undefined && t.resize === 'FIXED') {
    const max = Math.max(1, Math.floor(boxHeight / lh));
    if (lines.length > max) {
      lines.length = max;
      const l = lines[max - 1], limit = boxWidth - l.indent;
      let s = l.text.trimEnd();
      while (s && c.measureText(s + '\u2026').width > limit) s = s.slice(0, -1).trimEnd();
      l.text = s + '\u2026'; l.width = c.measureText(l.text).width; l.last = true;
      top = max * lh;
    }
  }
  return { lines, width: Math.max(0, ...lines.map(l => l.width + l.indent)), height: Math.max(lh, top), lineHeightPx: lh };
}

/** Size a text node should have given its resize mode. Returns null if FIXED. */
export function autoTextSize(n: SceneNode): { width?: number; height: number } | null {
  const t = n.text;
  if (!t || t.resize === 'FIXED') return null;
  const l = layoutText(t, n.width);
  return t.resize === 'AUTO_WIDTH' ? { width: Math.max(1, Math.ceil(l.width) + 1), height: Math.max(l.height, 1) } : { height: Math.max(l.height, 1) };
}
