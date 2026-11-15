import { selectionBox, SECTION_TITLE_H, SHAPE_POLY, boxOfPoints, centerOf, cornersOf, cubicAt, flattenRoute, itemBox, polyMid, rotateAround, routeConnector, sidePoint, strokePoints, tableSize, timerLeft, voteTotal, votesUsed, type BoardData, type Box, type JamItem, type Pt, type Side } from '@layr/core';

export const INK = '#1e1e1e';
export const FONT = 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif';
export const MONO = '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
export const VOTE = '#7c5cff';
export const ACCENT = '#0d99ff';
export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const ink = (c: string | undefined, dark: boolean) => { const v = c ?? INK; return dark && v.toLowerCase() === INK ? '#f2f2f2' : v; };

// ---------- images ----------
const imgCache = new Map<string, HTMLImageElement>();
export function getImage(src: string, onLoad: () => void): HTMLImageElement | null {
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.onload = onLoad; im.src = src; imgCache.set(src, im); }
  return im.complete && im.naturalWidth ? im : null;
}

// ---------- text ----------
let measureCtx: CanvasRenderingContext2D | null = null;
export function mctx(): CanvasRenderingContext2D { if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!; return measureCtx; }
export const fontOf = (it: JamItem, size = it.fontSize ?? 16) => `${it.italic ? 'italic ' : ''}${it.bold ? '700' : it.kind === 'sticky' ? '600' : '500'} ${size}px ${FONT}`;
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const t = line + word;
      if (ctx.measureText(t).width <= maxW || !line.trim()) {
        if (ctx.measureText(t).width > maxW && !line) { // break a very long word
          let chunk = ''; for (const ch of word) { if (ctx.measureText(chunk + ch).width > maxW && chunk) { out.push(chunk); chunk = ch; } else chunk += ch; } line = chunk;
        } else line = t;
      } else { out.push(line.trimEnd()); line = word.trimStart(); }
    }
    out.push(line.trimEnd());
  }
  return out;
}
/** Size a free-standing text item: grows with content until the user fixes its width. */
export function fitText(it: JamItem, text = it.text ?? ''): { w: number; h: number } {
  const c = mctx(); const size = it.fontSize ?? 20; c.font = fontOf(it, size);
  const lh = size * 1.3;
  if (!it.fixedW) { const lines = text.split('\n'); const w = Math.min(640, Math.max(40, ...lines.map(l => c.measureText(l || ' ').width)) + 8); const wr = wrapLines(c, text, w - 8); return { w, h: Math.max(lh, wr.length * lh) + 4 }; }
  return { w: it.w, h: Math.max(lh, wrapLines(c, text, it.w - 8).length * lh) + 4 };
}
export function fitFont(ctx: CanvasRenderingContext2D, it: JamItem, text: string, maxW: number, maxH: number, start: number) {
  let size = start;
  for (; size > 9; size -= 1) { ctx.font = fontOf(it, size); if (wrapLines(ctx, text, maxW).length * size * 1.3 <= maxH) break; }
  ctx.font = fontOf(it, size); return { size, lines: wrapLines(ctx, text, maxW) };
}

// ---------- shape geometry ----------
export function shapePath(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  if (kind === 'ellipse') { ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return; }
  if (kind === 'round') { ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.22); return; }
  if (kind === 'cylinder') { const e = Math.min(h * 0.18, w * 0.25); ctx.moveTo(x, y + e); ctx.ellipse(x + w / 2, y + e, w / 2, e, 0, Math.PI, 0); ctx.lineTo(x + w, y + h - e); ctx.ellipse(x + w / 2, y + h - e, w / 2, e, 0, 0, Math.PI); ctx.closePath(); return; }
  if (kind === 'speech') { const r = Math.min(w, h) * 0.18, bh = h * 0.82; ctx.roundRect(x, y, w, bh, r); ctx.moveTo(x + w * 0.2, y + bh - 1); ctx.lineTo(x + w * 0.16, y + h); ctx.lineTo(x + w * 0.42, y + bh - 1); return; }
  const poly = SHAPE_POLY[kind as keyof typeof SHAPE_POLY] ?? SHAPE_POLY.rect!;
  poly.forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h))); ctx.closePath();
}
const dashOf = (d: string | undefined, w: number) => (d === 'dashed' ? [w * 4, w * 3] : d === 'dotted' ? [w, w * 2.2] : []);

// ---------- drawing ----------
export interface RenderOpts {
  dark: boolean; dpr: number; selection: ReadonlySet<string>; hover: string | null; editing: string | null; now: number; meId: string;
  chrome: boolean; marquee: Box | null; guides: { x?: number; y?: number }[]; onImage: () => void;
  connectHint: string | null; draft: JamItem | null; hideEditingText: boolean;
}
export const boardBg = (dark: boolean) => (dark ? '#1b1b1d' : '#f4f4f5');

export function drawBoard(ctx: CanvasRenderingContext2D, board: BoardData, cam: { x: number; y: number; zoom: number }, w: number, h: number, o: RenderOpts) {
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  ctx.fillStyle = boardBg(o.dark); ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, board.grid, cam, w, h, o.dark);
  ctx.setTransform(o.dpr * cam.zoom, 0, 0, o.dpr * cam.zoom, -cam.x * cam.zoom * o.dpr, -cam.y * cam.zoom * o.dpr);
  const view: Box = { x: cam.x - 40, y: cam.y - 60, w: w / cam.zoom + 80, h: h / cam.zoom + 100 };
  const draw = (it: JamItem) => {
    const b = itemBox(board, it);
    if (b.x > view.x + view.w || b.y > view.y + view.h || b.x + b.w < view.x || b.y + b.h < view.y) return;
    ctx.save();
    if (it.kind !== 'connector' && it.kind !== 'stroke' && it.rot) { const c = centerOf(it); ctx.translate(c.x, c.y); ctx.rotate((it.rot * Math.PI) / 180); ctx.translate(-c.x, -c.y); }
    drawItem(ctx, board, it, cam.zoom, o);
    ctx.restore();
  };
  for (const id of board.order) { const it = board.items[id]; if (it) draw(it); }
  if (o.draft) draw(o.draft);
  if (o.chrome) {
    for (const id of o.selection) { const it = board.items[id]; if (!it || it.kind === 'connector') continue; outline(ctx, it, ACCENT, 1.5 / cam.zoom); }
    if (o.hover && !o.selection.has(o.hover) && board.items[o.hover]) outline(ctx, board.items[o.hover], ACCENT, 1.5 / cam.zoom, 0.6);
    if (o.connectHint && board.items[o.connectHint]) outline(ctx, board.items[o.connectHint], '#7c5cff', 3 / cam.zoom);
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    drawHandles(ctx, board, cam, o);
    ctx.strokeStyle = '#ff3d71'; ctx.lineWidth = 1;
    for (const g of o.guides) { ctx.beginPath(); if (g.x !== undefined) { const sx = (g.x - cam.x) * cam.zoom; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); } if (g.y !== undefined) { const sy = (g.y - cam.y) * cam.zoom; ctx.moveTo(0, sy); ctx.lineTo(w, sy); } ctx.stroke(); }
    if (o.marquee) { const m = o.marquee; ctx.fillStyle = 'rgba(13,153,255,.1)'; ctx.strokeStyle = ACCENT; ctx.fillRect((m.x - cam.x) * cam.zoom, (m.y - cam.y) * cam.zoom, m.w * cam.zoom, m.h * cam.zoom); ctx.strokeRect((m.x - cam.x) * cam.zoom, (m.y - cam.y) * cam.zoom, m.w * cam.zoom, m.h * cam.zoom); }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, grid: BoardData['grid'], cam: { x: number; y: number; zoom: number }, w: number, h: number, dark: boolean) {
  if (grid === 'none') return;
  let step = 24; while (step * cam.zoom < 14) step *= 2;
  const s = step * cam.zoom, ox = -((cam.x * cam.zoom) % s), oy = -((cam.y * cam.zoom) % s);
  ctx.fillStyle = ctx.strokeStyle = dark ? 'rgba(255,255,255,.34)' : 'rgba(0,0,0,.34)';
  if (grid === 'dots') { const r = Math.max(1.6, Math.min(2.6, cam.zoom * 1.8)); for (let x = ox; x < w; x += s) for (let y = oy; y < h; y += s) ctx.fillRect(x - r / 2, y - r / 2, r, r); }
  else { ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); for (let x = ox; x < w; x += s) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, h); } for (let y = oy; y < h; y += s) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(w, Math.round(y) + .5); } ctx.stroke(); ctx.globalAlpha = 1; }
}

function outline(ctx: CanvasRenderingContext2D, it: JamItem, color: string, lw: number, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = lw;
  if (it.kind === 'stroke') { ctx.setLineDash([4 / 1, 3]); ctx.lineWidth = lw; const b = { x: it.x - 4, y: it.y - 4, w: it.w + 8, h: it.h + 8 }; ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore(); return; }
  if (it.rot) { const c = centerOf(it); ctx.translate(c.x, c.y); ctx.rotate((it.rot * Math.PI) / 180); ctx.translate(-c.x, -c.y); }
  const top = it.kind === 'section' ? SECTION_TITLE_H : 0;
  ctx.strokeRect(it.x - 1, it.y - 1 - top, it.w + 2, it.h + 2 + top); ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, board: BoardData, it: JamItem, zoom: number, o: RenderOpts) {
  const editing = o.editing === it.id && o.hideEditingText;
  switch (it.kind) {
    case 'sticky': {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
      ctx.fillStyle = it.color ?? '#ffe066'; ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 5); ctx.fill(); ctx.restore();
      if (!editing && it.text) { ctx.fillStyle = '#1e1e1e'; ctx.textBaseline = 'top'; const pad = Math.max(10, it.w * 0.07); const f = fitFont(ctx, it, it.text, it.w - pad * 2, it.h - pad * 2, it.fontSize ?? 18); const lh = f.size * 1.3, th = f.lines.length * lh; const al = it.align ?? 'left'; ctx.textAlign = al; const tx = al === 'left' ? it.x + pad : al === 'center' ? it.x + it.w / 2 : it.x + it.w - pad; f.lines.forEach((l, i) => { const y = it.y + pad + Math.max(0, (it.h - pad * 2 - th) / 2) + i * lh; ctx.fillText(l, tx, y); decorate(ctx, it, l, tx, y, f.size, al, '#1e1e1e'); }); ctx.textAlign = 'left'; }
      if (it.author && zoom > 0.55) { ctx.font = `500 11px ${FONT}`; ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.textBaseline = 'alphabetic'; ctx.fillText(it.author, it.x + 10, it.y + it.h - 8); }
      badge(ctx, board, it, o, zoom); break;
    }
    case 'shape': {
      const lw = it.strokeW ?? 2; ctx.save();
      shapePath(ctx, it.shape!, it.x, it.y, it.w, it.h);
      ctx.fillStyle = it.color ?? '#fff'; ctx.fill();
      if (lw > 0) { ctx.strokeStyle = it.stroke ?? INK; ctx.lineWidth = lw; ctx.setLineDash(dashOf(it.dash, lw)); ctx.lineJoin = 'round'; ctx.stroke(); }
      if (it.shape === 'cylinder') { const e = Math.min(it.h * 0.18, it.w * 0.25); ctx.beginPath(); ctx.ellipse(it.x + it.w / 2, it.y + e, it.w / 2, e, 0, 0, Math.PI); ctx.stroke(); }
      ctx.restore();
      if (!editing && it.text) { const pad = 10, lum = luminance(it.color ?? '#fff'); const col = it.textColor ?? (lum < 0.35 ? '#fff' : '#1e1e1e'); ctx.fillStyle = col; ctx.textBaseline = 'top'; const inset = it.shape === 'ellipse' || it.shape === 'diamond' || it.shape === 'hexagon' || it.shape === 'octagon' ? 0.16 : it.shape === 'triangle' || it.shape === 'triangleDown' ? 0.25 : it.shape === 'star' ? 0.25 : 0.04; const iw = it.w * (1 - inset * 2) - pad, ih = it.h * (1 - inset * 2) - pad; const f = fitFont(ctx, it, it.text, iw, ih, it.fontSize ?? 16); const lh = f.size * 1.3, th = f.lines.length * lh; const al = it.align ?? 'center'; ctx.textAlign = al; const tx = al === 'left' ? it.x + it.w * inset + pad / 2 : al === 'center' ? it.x + it.w / 2 : it.x + it.w * (1 - inset) - pad / 2; const y0 = it.y + (it.h - th) / 2 + (it.shape === 'triangle' ? it.h * 0.12 : 0); f.lines.forEach((l, i) => { ctx.fillText(l, tx, y0 + i * lh); decorate(ctx, it, l, tx, y0 + i * lh, f.size, al, col); }); ctx.textAlign = 'left'; }
      badge(ctx, board, it, o, zoom); break;
    }
    case 'text': {
      if (editing) break;
      const size = it.fontSize ?? 20, col = ink(it.textColor, o.dark); ctx.font = fontOf(it, size); ctx.fillStyle = col; ctx.textBaseline = 'top';
      const lines = wrapLines(ctx, it.text ?? '', it.w - 8); const al = it.align ?? 'left'; ctx.textAlign = al; const tx = al === 'left' ? it.x + 4 : al === 'center' ? it.x + it.w / 2 : it.x + it.w - 4;
      lines.forEach((l, i) => { ctx.fillText(l, tx, it.y + 2 + i * size * 1.3); decorate(ctx, it, l, tx, it.y + 2 + i * size * 1.3, size, al, col); }); ctx.textAlign = 'left';
      if (!it.text && o.chrome) { ctx.fillStyle = 'rgba(128,128,128,.6)'; ctx.fillText('Type something', it.x + 4, it.y + 2); }
      break;
    }
    case 'connector': drawConnector(ctx, board, it, zoom, o); break;
    case 'stroke': drawStroke(ctx, it, o.dark); break;
    case 'section': {
      const c = it.color ?? '#8fb8ff';
      ctx.fillStyle = hexA(c, o.dark ? 0.12 : 0.2); ctx.strokeStyle = hexA(c, 0.9); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(it.x, it.y - SECTION_TITLE_H + 2, Math.min(it.w, 260), SECTION_TITLE_H - 2, [8, 8, 0, 0]); ctx.fill();
      if (!editing) { ctx.fillStyle = '#1e1e1e'; ctx.font = `600 14px ${FONT}`; ctx.textBaseline = 'middle'; ctx.save(); ctx.beginPath(); ctx.rect(it.x, it.y - SECTION_TITLE_H, Math.min(it.w, 260) - 10, SECTION_TITLE_H); ctx.clip(); ctx.fillText(it.text || 'Section', it.x + 12, it.y - SECTION_TITLE_H / 2 + 1); ctx.restore(); }
      break;
    }
    case 'emoji': drawStamp(ctx, it); badge(ctx, board, it, o, zoom); break;
    case 'table': drawTable(ctx, it, o, editing); break;
    case 'code': drawCode(ctx, it, editing); break;
    case 'image': {
      const im = getImage(it.src!, o.onImage);
      ctx.save(); ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 6); ctx.clip();
      if (im) ctx.drawImage(im, it.x, it.y, it.w, it.h); else { ctx.fillStyle = 'rgba(128,128,128,.25)'; ctx.fillRect(it.x, it.y, it.w, it.h); }
      ctx.restore(); badge(ctx, board, it, o, zoom); break;
    }
    case 'link': {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 10); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#eef3ff'; ctx.beginPath(); ctx.roundRect(it.x + 10, it.y + 10, it.h - 20, it.h - 20, 8); ctx.fill();
      ctx.font = `${(it.h - 20) * 0.5}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText('🔗', it.x + it.h / 2, it.y + it.h / 2 + 1); ctx.textAlign = 'left';
      let host = it.url ?? ''; try { host = new URL(it.url!).host; } catch { /* keep raw */ }
      ctx.save(); ctx.beginPath(); ctx.rect(it.x + it.h, it.y, it.w - it.h - 8, it.h); ctx.clip();
      ctx.fillStyle = '#1e1e1e'; ctx.font = `600 14px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.fillText(it.text || host, it.x + it.h, it.y + it.h / 2 - 3);
      ctx.fillStyle = '#6b7280'; ctx.font = `400 12px ${FONT}`; ctx.fillText(it.url ?? '', it.x + it.h, it.y + it.h / 2 + 16); ctx.restore(); break;
    }
    case 'timer': {
      const left = timerLeft(it, o.now), running = !!it.startedAt && left > 0, frac = (it.duration ?? 1) ? left / (it.duration ?? 1) : 0;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.fillStyle = left === 0 && it.startedAt ? '#4f46e5' : '#262626'; ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 14); ctx.fill(); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.roundRect(it.x + 14, it.y + it.h - 16, it.w - 28, 4, 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(it.x + 14, it.y + it.h - 16, Math.max(4, (it.w - 28) * frac), 4, 2); ctx.fill();
      const s = Math.ceil(left / 1000), mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
      ctx.fillStyle = '#fff'; ctx.font = `700 34px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(`${mm}:${ss}`, it.x + it.w / 2, it.y + it.h / 2 - 6);
      ctx.beginPath(); ctx.fillStyle = '#fff';
      if (running) { ctx.roundRect(it.x + 18, it.y + it.h / 2 - 16, 5, 16, 1); ctx.roundRect(it.x + 28, it.y + it.h / 2 - 16, 5, 16, 1); } else { ctx.moveTo(it.x + 19, it.y + it.h / 2 - 17); ctx.lineTo(it.x + 33, it.y + it.h / 2 - 9); ctx.lineTo(it.x + 19, it.y + it.h / 2 - 1); ctx.closePath(); }
      ctx.fill(); ctx.font = `600 11px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText('reset', it.x + it.w - 26, it.y + it.h / 2 - 6); ctx.textAlign = 'left'; break;
    }
  }
}

function decorate(ctx: CanvasRenderingContext2D, it: JamItem, line: string, x: number, y: number, size: number, align: string, col: string) {
  if (!it.underline && !it.strike) return;
  const w = ctx.measureText(line).width, x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, size / 14); ctx.beginPath();
  if (it.underline) { ctx.moveTo(x0, y + size * 1.08); ctx.lineTo(x0 + w, y + size * 1.08); }
  if (it.strike) { ctx.moveTo(x0, y + size * 0.55); ctx.lineTo(x0 + w, y + size * 0.55); }
  ctx.stroke(); ctx.restore();
}
function luminance(hex: string): number { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 1; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
export function hexA(hex: string, a: number): string { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

function badge(ctx: CanvasRenderingContext2D, board: BoardData, it: JamItem, o: RenderOpts, zoom: number) {
  const total = voteTotal(it); if (!total) return;
  const hidden = board.voting?.active && board.voting.hidden; const n = hidden ? (it.votes?.[o.meId] ?? 0) : total; if (!n) return;
  const r = 13; const cx = it.x + it.w - 4, cy = it.y + 4; ctx.save(); ctx.fillStyle = VOTE; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), cx, cy + 1); ctx.restore(); void zoom;
}

function capShape(ctx: CanvasRenderingContext2D, cap: string, at: Pt, dir: Pt, lw: number, col: string) {
  if (cap === 'none') return;
  const s = 7 + lw * 2.2, nx = -dir.y, ny = dir.x; ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
  if (cap === 'arrow') { ctx.moveTo(at.x - dir.x * s + nx * s * 0.6, at.y - dir.y * s + ny * s * 0.6); ctx.lineTo(at.x, at.y); ctx.lineTo(at.x - dir.x * s - nx * s * 0.6, at.y - dir.y * s - ny * s * 0.6); ctx.stroke(); }
  else if (cap === 'triangle') { ctx.moveTo(at.x, at.y); ctx.lineTo(at.x - dir.x * s + nx * s * 0.55, at.y - dir.y * s + ny * s * 0.55); ctx.lineTo(at.x - dir.x * s - nx * s * 0.55, at.y - dir.y * s - ny * s * 0.55); ctx.closePath(); ctx.fill(); }
  else if (cap === 'diamond') { ctx.moveTo(at.x, at.y); ctx.lineTo(at.x - dir.x * s * 0.6 + nx * s * 0.5, at.y - dir.y * s * 0.6 + ny * s * 0.5); ctx.lineTo(at.x - dir.x * s * 1.2, at.y - dir.y * s * 1.2); ctx.lineTo(at.x - dir.x * s * 0.6 - nx * s * 0.5, at.y - dir.y * s * 0.6 - ny * s * 0.5); ctx.closePath(); ctx.fill(); }
  else if (cap === 'circle') { ctx.arc(at.x - dir.x * s * 0.4, at.y - dir.y * s * 0.4, s * 0.4, 0, Math.PI * 2); ctx.fill(); }
  else if (cap === 'bar') { ctx.moveTo(at.x + nx * s * 0.6, at.y + ny * s * 0.6); ctx.lineTo(at.x - nx * s * 0.6, at.y - ny * s * 0.6); ctx.stroke(); }
  ctx.restore();
}
function drawConnector(ctx: CanvasRenderingContext2D, board: BoardData, it: JamItem, zoom: number, o: RenderOpts) {
  const r = routeConnector(board, it), lw = it.strokeW ?? 2, col = ink(it.stroke, o.dark);
  ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(dashOf(it.dash, lw)); ctx.beginPath();
  if (r.curve) { ctx.moveTo(r.pts[0].x, r.pts[0].y); ctx.bezierCurveTo(r.pts[1].x, r.pts[1].y, r.pts[2].x, r.pts[2].y, r.pts[3].x, r.pts[3].y); }
  else if (it.route === 'elbow' && r.pts.length > 2) { // rounded corners
    ctx.moveTo(r.pts[0].x, r.pts[0].y);
    for (let i = 1; i < r.pts.length - 1; i++) ctx.arcTo(r.pts[i].x, r.pts[i].y, r.pts[i + 1].x, r.pts[i + 1].y, 10);
    ctx.lineTo(r.pts[r.pts.length - 1].x, r.pts[r.pts.length - 1].y);
  } else { ctx.moveTo(r.pts[0].x, r.pts[0].y); for (const p of r.pts.slice(1)) ctx.lineTo(p.x, p.y); }
  ctx.stroke(); ctx.restore();
  const flat = flattenRoute(r), n = flat.length;
  const dirAt = (a: Pt, b: Pt) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  if (n >= 2) {
    const endDir = r.curve ? dirAt(cubicAt(r.pts, 0.96), r.pts[3]) : dirAt(flat[n - 2], flat[n - 1]);
    const startDir = r.curve ? dirAt(cubicAt(r.pts, 0.04), r.pts[0]) : dirAt(flat[1], flat[0]);
    capShape(ctx, it.capEnd ?? 'arrow', flat[n - 1], endDir, lw, col); capShape(ctx, it.capStart ?? 'none', flat[0], startDir, lw, col);
  }
  if (it.text) {
    const m = r.curve ? cubicAt(r.pts, 0.5) : polyMid(flat); ctx.font = `500 13px ${FONT}`; const tw = ctx.measureText(it.text).width + 14;
    ctx.fillStyle = boardBg(o.dark); ctx.beginPath(); ctx.roundRect(m.x - tw / 2, m.y - 12, tw, 24, 6); ctx.fill(); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.text, m.x, m.y + 1); ctx.textAlign = 'left';
  }
  if (o.selection.has(it.id) && o.chrome) { ctx.save(); ctx.strokeStyle = ACCENT; ctx.globalAlpha = 0.35; ctx.lineWidth = lw + 6 / zoom; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(flat[0].x, flat[0].y); for (const p of flat.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.restore(); }
}
function drawStroke(ctx: CanvasRenderingContext2D, it: JamItem, dark: boolean) {
  const ps = strokePoints(it); if (!ps.length) return;
  ctx.save(); ctx.lineCap = it.pen === 'highlighter' ? 'butt' : 'round'; ctx.lineJoin = 'round';
  const col = ink(it.stroke, dark);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = it.pen === 'highlighter' ? (it.strokeW ?? 14) * 3 : it.pen === 'marker' ? (it.strokeW ?? 6) * 1.6 : it.strokeW ?? 3;
  if (it.pen === 'highlighter') { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = dark ? 'screen' : 'multiply'; }
  if (ps.length === 1) { ctx.beginPath(); ctx.arc(ps[0].x, ps[0].y, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
  ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y);
  for (let i = 1; i < ps.length - 1; i++) { const mx = (ps[i].x + ps[i + 1].x) / 2, my = (ps[i].y + ps[i + 1].y) / 2; ctx.quadraticCurveTo(ps[i].x, ps[i].y, mx, my); }
  ctx.lineTo(ps[ps.length - 1].x, ps[ps.length - 1].y); ctx.stroke(); ctx.restore();
}
function drawTable(ctx: CanvasRenderingContext2D, it: JamItem, o: RenderOpts, editing: boolean) {
  const cells = it.cells!, cw = it.colW!, rh = it.rowH!, sz = tableSize(it);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = it.color ?? '#fff'; ctx.fillRect(it.x, it.y, sz.w, sz.h); ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(it.x, it.y, sz.w, rh[0]);
  ctx.strokeStyle = it.stroke ?? INK; ctx.lineWidth = 1.5; ctx.beginPath();
  let x = it.x; for (let c = 0; c <= cw.length; c++) { ctx.moveTo(x, it.y); ctx.lineTo(x, it.y + sz.h); x += cw[c] ?? 0; }
  let y = it.y; for (let r = 0; r <= rh.length; r++) { ctx.moveTo(it.x, y); ctx.lineTo(it.x + sz.w, y); y += rh[r] ?? 0; } ctx.stroke();
  ctx.fillStyle = '#1e1e1e'; ctx.textBaseline = 'middle'; const size = it.fontSize ?? 14;
  y = it.y; cells.forEach((row, r) => { x = it.x; row.forEach((txt, c) => { if (txt && !(editing && o.editing && false)) { ctx.font = `${r === 0 ? '700' : '500'} ${size}px ${FONT}`; ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y, cw[c] - 4, rh[r]); ctx.clip(); const lines = wrapLines(ctx, txt, cw[c] - 14); const lh = size * 1.3; lines.forEach((l, i) => ctx.fillText(l, x + 8, y + rh[r] / 2 + (i - (lines.length - 1) / 2) * lh)); ctx.restore(); } x += cw[c]; }); y += rh[r]; });
}
const KW = new Set('const let var function return if else for while class new import from export default async await try catch throw switch case break continue true false null undefined def in is not and or None True False self this typeof interface type extends public private static void int string bool'.split(' '));
function drawCode(ctx: CanvasRenderingContext2D, it: JamItem, editing: boolean) {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.fillStyle = '#1f2330'; ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 10); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#ff5f57'; ctx.beginPath(); ctx.arc(it.x + 16, it.y + 16, 4.5, 0, 7); ctx.fill(); ctx.fillStyle = '#febc2e'; ctx.beginPath(); ctx.arc(it.x + 32, it.y + 16, 4.5, 0, 7); ctx.fill(); ctx.fillStyle = '#28c840'; ctx.beginPath(); ctx.arc(it.x + 48, it.y + 16, 4.5, 0, 7); ctx.fill();
  ctx.font = `500 11px ${FONT}`; ctx.fillStyle = '#8b93a7'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(it.lang ?? '', it.x + it.w - 14, it.y + 16); ctx.textAlign = 'left';
  if (editing) return;
  const size = it.fontSize ?? 13, lh = size * 1.55; ctx.font = `${size}px ${MONO}`; ctx.save(); ctx.beginPath(); ctx.rect(it.x, it.y + 30, it.w, it.h - 34); ctx.clip();
  (it.text ?? '').split('\n').forEach((line, i) => {
    const y = it.y + 44 + i * lh; ctx.fillStyle = '#5b6379'; ctx.textAlign = 'right'; ctx.fillText(String(i + 1), it.x + 30, y); ctx.textAlign = 'left';
    let x = it.x + 42; for (const tok of line.match(/\/\/.*|#.*|"[^"]*"|'[^']*'|`[^`]*`|\d+(\.\d+)?|\w+|\s+|./g) ?? []) {
      ctx.fillStyle = /^(\/\/|#)/.test(tok) ? '#6a737d' : /^["'`]/.test(tok) ? '#9ece6a' : /^\d/.test(tok) ? '#ff9e64' : KW.has(tok) ? '#bb9af7' : /^[A-Z]\w*$/.test(tok) ? '#7dcfff' : '#c0caf5';
      ctx.fillText(tok, x, y); x += ctx.measureText(tok).width;
    }
  }); ctx.restore();
}

// ---------- selection handles ----------
export type HandleKind = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot' | 'from' | 'to';
export interface Handle { kind: HandleKind; p: Pt }
export function selectionFrame(board: BoardData, ids: string[]): { box: Box; rot: number; single: JamItem | null } | null {
  const its = ids.map(i => board.items[i]).filter(Boolean);
  if (!its.length) return null;
  if (its.length === 1 && its[0].kind !== 'connector' && its[0].kind !== 'stroke') { const it = its[0]; return { box: { x: it.x, y: it.y, w: it.w, h: it.h }, rot: it.rot, single: it }; }
  const bs = its.map(i => itemBox(board, i)); const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y)), x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
  return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rot: 0, single: its.length === 1 ? its[0] : null };
}
export function handlesFor(board: BoardData, ids: string[], zoom: number): Handle[] {
  const its = ids.map(i => board.items[i]).filter(Boolean);
  if (its.length === 1 && its[0].kind === 'connector') { const r = flattenRoute(routeConnector(board, its[0])); return [{ kind: 'from', p: r[0] }, { kind: 'to', p: r[r.length - 1] }]; }
  if (its.length === 1 && (its[0].kind === 'timer' || its[0].kind === 'emoji' && false)) return [];
  const f = selectionFrame(board, ids); if (!f) return [];
  const { x, y, w, h } = f.box, c = { x: x + w / 2, y: y + h / 2 };
  const pts: [HandleKind, Pt][] = [['nw', { x, y }], ['n', { x: x + w / 2, y }], ['ne', { x: x + w, y }], ['e', { x: x + w, y: y + h / 2 }], ['se', { x: x + w, y: y + h }], ['s', { x: x + w / 2, y: y + h }], ['sw', { x, y: y + h }], ['w', { x, y: y + h / 2 }], ['rot', { x: x + w / 2, y: y - 26 / zoom }]];
  const lockedAll = its.every(i => i.locked);
  return lockedAll ? [] : pts.map(([kind, p]) => ({ kind, p: f.rot ? rotateAround(p, c, f.rot) : p }));
}
const CONNECT_SIDES: Exclude<Side, 'auto'>[] = ['t', 'r', 'b', 'l'];
/** Little "+" buttons around a lone selected shape/sticky for quick connected duplicates. */
export function connectHandles(board: BoardData, ids: string[], zoom: number): { side: Exclude<Side, 'auto'>; p: Pt }[] {
  if (ids.length !== 1) return []; const it = board.items[ids[0]];
  if (!it || it.locked || (it.kind !== 'sticky' && it.kind !== 'shape' && it.kind !== 'text')) return [];
  const gap = 26 / zoom; return CONNECT_SIDES.map(side => { const p = sidePoint(it, side); const n = { t: { x: 0, y: -1 }, r: { x: 1, y: 0 }, b: { x: 0, y: 1 }, l: { x: -1, y: 0 } }[side]; const nn = rotateAround(n, { x: 0, y: 0 }, it.rot); return { side, p: { x: p.x + nn.x * gap, y: p.y + nn.y * gap } }; });
}
function drawHandles(ctx: CanvasRenderingContext2D, board: BoardData, cam: { x: number; y: number; zoom: number }, o: RenderOpts) {
  const ids = [...o.selection]; if (!ids.length || o.editing) return;
  const toS = (p: Pt) => ({ x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom });
  const f = selectionFrame(board, ids);
  if (f && ids.length > 1) { const cs = [{ x: f.box.x, y: f.box.y }, { x: f.box.x + f.box.w, y: f.box.y }, { x: f.box.x + f.box.w, y: f.box.y + f.box.h }, { x: f.box.x, y: f.box.y + f.box.h }].map(toS); ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.beginPath(); cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
  if (f?.single && f.single.kind !== 'connector' && f.single.kind !== 'stroke') { const cs = cornersOf(f.single).map(toS); ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.beginPath(); cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); }
  for (const hd of handlesFor(board, ids, cam.zoom)) {
    const s = toS(hd.p);
    if (hd.kind === 'rot') { const frame = f!; const top = toS(rotateAround({ x: frame.box.x + frame.box.w / 2, y: frame.box.y }, { x: frame.box.x + frame.box.w / 2, y: frame.box.y + frame.box.h / 2 }, frame.rot)); ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, 7); ctx.fill(); ctx.stroke(); continue; }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5;
    if (hd.kind === 'from' || hd.kind === 'to') { ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.fill(); ctx.stroke(); } else { ctx.beginPath(); ctx.roundRect(s.x - 4.5, s.y - 4.5, 9, 9, 2); ctx.fill(); ctx.stroke(); }
  }
  for (const ch of connectHandles(board, ids, cam.zoom)) {
    const s = toS(ch.p); ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke();
  }
}

/** Render the whole board (or a region) to a PNG blob. */
export async function exportPng(board: BoardData, ids: string[] | null, dark: boolean, scale = 2, maxPx = 6000): Promise<Blob | null> {
  const its = (ids ?? board.order).map(i => board.items[i]).filter(Boolean);
  if (!its.length) return null;
  const bs = its.map(i => itemBox(board, i)); const x0 = Math.min(...bs.map(b => b.x)) - 40, y0 = Math.min(...bs.map(b => b.y)) - 40, x1 = Math.max(...bs.map(b => b.x + b.w)) + 40, y1 = Math.max(...bs.map(b => b.y + b.h)) + 40;
  const w = x1 - x0, h = y1 - y0; const s = Math.min(scale, maxPx / Math.max(w, h));
  await Promise.all(its.filter(i => i.kind === 'image').map(i => new Promise<void>(res => { if (getImage(i.src!, res)) res(); })));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
  const sub = ids ? { ...board, order: board.order.filter(i => ids.includes(i)) } : board;
  drawBoard(cv.getContext('2d')!, { ...sub, grid: 'none' }, { x: x0, y: y0, zoom: 1 }, w, h, { dark, dpr: s, selection: new Set(), hover: null, editing: null, now: Date.now(), meId: '', chrome: false, marquee: null, guides: [], onImage: () => {}, connectHint: null, draft: null, hideEditingText: false });
  return new Promise(res => cv.toBlob(res, 'image/png'));
}
/** The camera the whiteboard opens with: the whole board framed with some room around it (same maths as the editor's Zoom to fit). */
export function fitBoardCamera(board: BoardData, W: number, H: number): { x: number; y: number; zoom: number } {
  const box = selectionBox(board, board.order);
  if (!box) return { x: -W / 2, y: -H / 2, zoom: 1 };
  const z = Math.max(0.05, Math.min(Math.min((W - 160) / Math.max(box.w, 1), (H - 220) / Math.max(box.h, 1), 1.5), 4));
  return { zoom: z, x: box.x + box.w / 2 - W / 2 / z, y: box.y + box.h / 2 - H / 2 / z };
}
/** Draw a whole board (no editing chrome) onto a fresh canvas of w x h CSS pixels, at `dpr` device pixels per pixel. Used for whiteboard cards inside design files. */
export function renderBoardCanvas(board: BoardData, w: number, h: number, dpr: number, dark: boolean, onImage: () => void): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
  drawBoard(cv.getContext('2d')!, board, fitBoardCamera(board, w, h), w, h, { dark, dpr, selection: new Set(), hover: null, editing: null, now: Date.now(), meId: '', chrome: false, marquee: null, guides: [], onImage, connectHint: null, draft: null, hideEditingText: false });
  return cv;
}
export { boxOfPoints, votesUsed };

/** Stamps: emoji with a white "sticker" edge, plus +1, ?, a red sticker dot and an initial-in-a-circle avatar. */
function drawStamp(ctx: CanvasRenderingContext2D, it: JamItem) {
  const e = it.emoji ?? '👍', cx = it.x + it.w / 2, cy = it.y + it.h / 2, s = it.h;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const outlined = (draw: () => void) => { ctx.lineJoin = 'round'; ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = s * 0.1; ctx.shadowOffsetY = s * 0.04; draw(); };
  if (e === '+1' || e === '?') {
    ctx.font = `900 ${s * (e === '?' ? 1.0 : 0.85)}px ${FONT}`; ctx.translate(cx, cy); if (e === '+1') ctx.rotate(-0.1);
    outlined(() => { ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.16; ctx.strokeText(e, 0, 0); ctx.shadowColor = 'transparent'; ctx.fillStyle = e === '?' ? '#e5502d' : '#7c4dff'; ctx.fillText(e, 0, 0); });
  } else if (e === '●') {
    outlined(() => { ctx.fillStyle = '#e5502d'; ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(cx + s * 0.1, cy - s * 0.42); ctx.quadraticCurveTo(cx + s * 0.12, cy - s * 0.1, cx + s * 0.42, cy - s * 0.12); ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.38, cx + s * 0.1, cy - s * 0.42); ctx.fill();
  } else if (e.startsWith('@')) {
    outlined(() => { ctx.fillStyle = '#4f46e5'; ctx.strokeStyle = '#fff'; ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    ctx.shadowColor = 'transparent'; ctx.fillStyle = '#fff'; ctx.font = `700 ${s * 0.42}px ${FONT}`; ctx.fillText(e.slice(1, 3), cx, cy + s * 0.02);
  } else {
    ctx.font = `${s * 0.78}px ${EMOJI_FONT}`; ctx.fillStyle = '#000';
    ctx.shadowColor = '#fff'; ctx.shadowBlur = Math.max(2, s * 0.09); ctx.fillText(e, cx, cy + s * 0.04); ctx.fillText(e, cx, cy + s * 0.04); // white sticker edge
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = s * 0.1; ctx.shadowOffsetY = s * 0.04; ctx.fillText(e, cx, cy + s * 0.04);
  }
  ctx.restore();
}
