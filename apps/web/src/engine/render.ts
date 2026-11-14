import { apply, boundsOfPoints, flatten, localMatrix, mul, pathBounds, rectsIntersect, type DocumentData, type Mat, type Paint, type Rect, type SceneNode, type VectorPath } from '@layr/core';
import { applyTextStyle, caseText, fontString, layoutText } from './text';
import { outlines, widthPolygon, wiggled } from './strokeFx';
import type { ImageCache } from './images';

export interface DrawEnv {
  images: ImageCache;
  /** device pixels per world unit — needed because canvas shadow/blur sizes are not transformed */
  scale: number;
  /** world-space cull rectangle (optional) */
  view?: Rect;
  hideTextOf?: string | null;
  /** draw layout guides (editor view only; never in exports) */
  showGuides?: boolean;
  /** set while compositing boolean operations: forces the blend mode and skips strokes */
  composite?: GlobalCompositeOperation;
  noStroke?: boolean;
}

const BLEND: Record<string, GlobalCompositeOperation> = { NORMAL: 'source-over', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten' };

export function rgba(hex: string, a = 1): string {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return `rgba(${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)},${a})`;
}

function traceOne(c: CanvasRenderingContext2D, path: VectorPath) {
  const pts = path.points, count = pts.length;
  if (!count) return;
  c.moveTo(pts[0].x, pts[0].y);
  const segs = path.closed ? count : count - 1;
  for (let i = 0; i < segs; i++) { const a = pts[i], b = pts[(i + 1) % count]; c.bezierCurveTo(a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y); }
  if (path.closed) c.closePath();
}
export function tracePath(c: CanvasRenderingContext2D, n: SceneNode) {
  traceOne(c, n.path!);
  for (const sp of n.subpaths ?? []) traceOne(c, sp);
}
function radii(n: SceneNode): number | number[] {
  if (n.cornerRadii) { const lim = Math.min(n.width, n.height) / 2; return n.cornerRadii.map(r => Math.min(r, lim)); }
  return Math.min(n.cornerRadius, n.width / 2, n.height / 2);
}
function shapePath(c: CanvasRenderingContext2D, n: SceneNode) {
  c.beginPath();
  if (n.type === 'VECTOR' && n.path && n.path.points.length > 1) tracePath(c, n);
  else if (n.type === 'ELLIPSE') c.ellipse(n.width / 2, n.height / 2, Math.max(n.width / 2, 0), Math.max(n.height / 2, 0), 0, 0, Math.PI * 2);
  else if (n.type === 'LINE') { c.moveTo(0, 0); c.lineTo(n.width, 0); }
  else if (n.cornerRadii || n.cornerRadius > 0) c.roundRect(0, 0, n.width, n.height, radii(n));
  else c.rect(0, 0, n.width, n.height);
}

function paintStyle(c: CanvasRenderingContext2D, p: Paint, n: SceneNode): string | CanvasGradient | null {
  if (p.type === 'SOLID') return rgba(p.color, 1);
  if (p.type === 'LINEAR') {
    const a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const half = (Math.abs(n.width * dx) + Math.abs(n.height * dy)) / 2;
    const cx = n.width / 2, cy = n.height / 2;
    const g = c.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    for (const s of [...p.stops].sort((x, y) => x.pos - y.pos)) g.addColorStop(Math.min(1, Math.max(0, s.pos)), rgba(s.color, s.opacity));
    return g;
  }
  return null;
}

function drawImagePaint(c: CanvasRenderingContext2D, n: SceneNode, p: Extract<Paint, { type: 'IMAGE' }>, env: DrawEnv) {
  const img = env.images.get(p.assetId);
  if (!img) { c.fillStyle = 'rgba(128,128,128,0.25)'; c.fill(); return; }
  c.save(); c.clip();
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (p.scaleMode === 'STRETCH') c.drawImage(img, 0, 0, n.width, n.height);
  else {
    const s = p.scaleMode === 'FILL' ? Math.max(n.width / iw, n.height / ih) : Math.min(n.width / iw, n.height / ih);
    const w = iw * s, h = ih * s;
    c.drawImage(img, (n.width - w) / 2, (n.height - h) / 2, w, h);
  }
  c.restore();
}

function fillPaints(c: CanvasRenderingContext2D, n: SceneNode, paints: Paint[], env: DrawEnv, shadow: boolean) {
  const shadows = shadow ? n.effects.filter((e): e is Extract<typeof e, { type: 'DROP_SHADOW' }> => e.type === 'DROP_SHADOW' && e.visible) : [];
  const vis = paints.filter(p => p.visible);
  const draw = (p: Paint) => {
    const baseAlpha = c.globalAlpha;
    c.globalAlpha = baseAlpha * p.opacity;
    shapePath(c, n);
    if (p.type === 'IMAGE') drawImagePaint(c, n, p, env);
    else { const st = paintStyle(c, p, n); if (st) { c.fillStyle = st; c.fill(n.subpaths?.length ? 'evenodd' : 'nonzero'); } }
    c.globalAlpha = baseAlpha;
  };
  if (shadows.length && vis.length) {
    // shadows are cast by the lowest paint's silhouette
    for (const s of shadows) {
      c.save();
      c.shadowColor = rgba(s.color, s.opacity); c.shadowBlur = s.blur * env.scale; c.shadowOffsetX = s.x * env.scale; c.shadowOffsetY = s.y * env.scale;
      draw(vis[0]);
      c.restore();
    }
  }
  for (const p of vis) draw(p);
}

/** Arrow / triangle / dot at the two ends of a line or open path, in the stroke's colour. */
function drawEndPoints(c: CanvasRenderingContext2D, n: SceneNode, style: string | CanvasGradient) {
  type EP = { x: number; y: number; dx: number; dy: number };
  let a: EP | null = null, b: EP | null = null;
  if (n.type === 'LINE') { a = { x: 0, y: 0, dx: -1, dy: 0 }; b = { x: n.width, y: 0, dx: 1, dy: 0 }; }
  else if (n.type === 'VECTOR' && n.path && !n.path.closed && n.path.points.length >= 2) {
    const P = n.path.points, last = P.length - 1;
    const dir = (from: { x: number; y: number }, to: { x: number; y: number }) => { const l = Math.hypot(to.x - from.x, to.y - from.y) || 1; return { dx: (to.x - from.x) / l, dy: (to.y - from.y) / l }; };
    const p0 = P[0], p1 = P[1], pe = P[last], pp = P[last - 1];
    const h0 = p0.ox || p0.oy ? { x: p0.x + p0.ox, y: p0.y + p0.oy } : p1.ix || p1.iy ? { x: p1.x + p1.ix, y: p1.y + p1.iy } : p1;
    const h1 = pe.ix || pe.iy ? { x: pe.x + pe.ix, y: pe.y + pe.iy } : pp.ox || pp.oy ? { x: pp.x + pp.ox, y: pp.y + pp.oy } : pp;
    const d0 = dir(h0, p0), d1 = dir(h1, pe);
    a = { x: p0.x, y: p0.y, ...d0 }; b = { x: pe.x, y: pe.y, ...d1 };
  }
  if (!a || !b) return;
  const wgt = Math.max(1, n.strokeWeight), L = Math.max(7, wgt * 3.5);
  c.save(); c.setLineDash([]); c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = wgt; c.strokeStyle = style; c.fillStyle = style;
  const draw = (kind: string | undefined, e: EP) => {
    if (!kind || kind === 'NONE') return;
    const nx = -e.dy, ny = e.dx, hw = L * 0.52;
    c.beginPath();
    if (kind === 'ROUND') { c.arc(e.x, e.y, wgt / 2, 0, Math.PI * 2); c.fill(); return; }
    if (kind === 'SQUARE') { const h = wgt / 2; c.moveTo(e.x + nx * h, e.y + ny * h); c.lineTo(e.x + nx * h + e.dx * h, e.y + ny * h + e.dy * h); c.lineTo(e.x - nx * h + e.dx * h, e.y - ny * h + e.dy * h); c.lineTo(e.x - nx * h, e.y - ny * h); c.closePath(); c.fill(); return; }
    if (kind === 'CIRCLE') { c.arc(e.x, e.y, L / 2.2, 0, Math.PI * 2); c.fill(); return; }
    const bx = e.x - e.dx * L, by = e.y - e.dy * L;
    if (kind === 'DIAMOND') { const mx = e.x - e.dx * L / 2, my = e.y - e.dy * L / 2; c.moveTo(e.x, e.y); c.lineTo(mx + nx * hw * 0.8, my + ny * hw * 0.8); c.lineTo(bx, by); c.lineTo(mx - nx * hw * 0.8, my - ny * hw * 0.8); c.closePath(); c.fill(); return; }
    if (kind === 'TRIANGLE') { c.moveTo(e.x, e.y); c.lineTo(bx + nx * hw, by + ny * hw); c.lineTo(bx - nx * hw, by - ny * hw); c.closePath(); c.fill(); return; }
    if (kind === 'REVERSED_TRIANGLE') { c.moveTo(e.x + nx * hw, e.y + ny * hw); c.lineTo(e.x - nx * hw, e.y - ny * hw); c.lineTo(bx, by); c.closePath(); c.fill(); return; }
    c.moveTo(bx + nx * hw, by + ny * hw); c.lineTo(e.x, e.y); c.lineTo(bx - nx * hw, by - ny * hw); c.stroke();
  };
  draw(n.strokeStart, a); draw(n.strokeEnd, b);
  c.restore();
}

/** Dynamic (wiggle) and brush / width-profile strokes: drawn from the sampled outline instead of the plain canvas stroke. */
function strokeFx(c: CanvasRenderingContext2D, n: SceneNode, style: string | CanvasGradient) {
  c.save(); c.strokeStyle = style; c.fillStyle = style;
  c.lineJoin = ({ MITER: 'miter', ROUND: 'round', BEVEL: 'bevel' } as const)[n.strokeJoin ?? 'MITER']; c.lineCap = ({ NONE: 'butt', ROUND: 'round', SQUARE: 'square' } as const)[n.strokeCap ?? 'NONE'];
  c.lineWidth = n.strokeWeight; c.setLineDash(n.dashes?.length ? n.dashes : []);
  const kind = n.strokeKind ?? 'BASIC';
  for (const poly of outlines(n)) {
    if (kind === 'DYNAMIC') {
      const w = wiggled(poly, n.strokeWeight, n.strokeDynamic ?? { frequency: 75, wiggle: 30, smoothen: 50 }), P = w.pts;
      if (P.length < 2) continue;
      c.beginPath(); c.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length - 1; i++) { const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2; c.quadraticCurveTo(P[i].x, P[i].y, mx, my); }
      c.lineTo(P[P.length - 1].x, P[P.length - 1].y);
      if (w.closed) c.closePath();
      c.stroke();
    } else {
      const rings = widthPolygon(poly, n.strokeWeight, { profile: n.strokeProfile, flip: n.strokeProfileFlip, brush: kind === 'BRUSH' ? n.strokeBrush ?? { id: 'CHARCOAL', direction: 'RIGHT' } : undefined });
      c.beginPath();
      for (const r of rings) { r.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); }
      c.fill('evenodd');
    }
  }
  c.restore();
}

function strokePaints(c: CanvasRenderingContext2D, n: SceneNode, env: DrawEnv) {
  const strokes = n.strokes.filter(p => p.visible && p.type !== 'IMAGE');
  if (!strokes.length || n.strokeWeight <= 0) return;
  const align = n.type === 'LINE' || n.type === 'VECTOR' ? 'CENTER' : n.strokeAlign; // inside/outside need a closed area; vectors stroke on centre
  for (const p of strokes) {
    const st = paintStyle(c, p, n); if (!st) continue;
    if ((n.strokeKind && n.strokeKind !== 'BASIC') || (n.strokeProfile && n.strokeProfile !== 'UNIFORM')) {
      c.save(); c.globalAlpha *= p.opacity; strokeFx(c, n, st); c.restore();
      if (n.strokeStart || n.strokeEnd) drawEndPoints(c, n, st);
      continue;
    }
    c.save();
    c.globalAlpha *= p.opacity; c.strokeStyle = st;
    c.lineJoin = ({ MITER: 'miter', ROUND: 'round', BEVEL: 'bevel' } as const)[n.strokeJoin ?? 'MITER']; c.lineCap = ({ NONE: 'butt', ROUND: 'round', SQUARE: 'square' } as const)[n.strokeCap ?? 'NONE'];
    c.miterLimit = n.strokeMiterAngle ? 1 / Math.sin((n.strokeMiterAngle * Math.PI) / 360) : 10;
    c.setLineDash(n.dashes?.length ? n.dashes : []);
    shapePath(c, n);
    if (align === 'CENTER') c.lineWidth = n.strokeWeight;
    else {
      c.lineWidth = n.strokeWeight * 2;
      if (align === 'INSIDE') c.clip();
      else { const pad = n.strokeWeight * 2 + 4; c.beginPath(); c.rect(-pad, -pad, n.width + pad * 2, n.height + pad * 2); shapeAppend(c, n); c.clip('evenodd'); shapePath(c, n); }
    }
    c.stroke();
    c.restore();
    if (n.strokeStart || n.strokeEnd) drawEndPoints(c, n, st);
  }
  void env;
}
/** append the shape to the current path without beginPath (for even-odd outside clipping) */
function shapeAppend(c: CanvasRenderingContext2D, n: SceneNode) {
  if (n.type === 'ELLIPSE') { c.moveTo(n.width, n.height / 2); c.ellipse(n.width / 2, n.height / 2, n.width / 2, n.height / 2, 0, 0, Math.PI * 2); }
  else if (n.cornerRadii || n.cornerRadius > 0) c.roundRect(0, 0, n.width, n.height, radii(n));
  else c.rect(0, 0, n.width, n.height);
}

/** Characters laid out along the node's `textPath` (scaled to the node's box), each rotated to the local tangent. */
function drawTextOnPath(c: CanvasRenderingContext2D, n: SceneNode, fill: Paint, env: DrawEnv) {
  void env;
  const t = n.text!;
  const b = pathBounds(n.textPath!);
  const sx = b.w > 1e-6 ? n.width / b.w : 1, sy = b.h > 1e-6 ? n.height / b.h : 1;
  const pts = flatten(n.textPath!, 24).map(p => ({ x: (p.x - b.x) * sx, y: (p.y - b.y) * sy }));
  if (pts.length < 2) return;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  c.font = fontString(t); c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const st = paintStyle(c, fill, n); if (!st) return;
  c.fillStyle = st;
  const baseAlpha = c.globalAlpha; c.globalAlpha = baseAlpha * fill.opacity;
  const chars = Array.from(caseText(t.characters.replace(/\n/g, ' '), t.textCase));
  const adv = chars.map(ch => c.measureText(ch).width + t.letterSpacing);
  const used = adv.reduce((a, b2) => a + b2, 0);
  let s0 = t.align === 'LEFT' ? 0 : t.align === 'CENTER' ? (total - used) / 2 : total - used;
  let seg = 1;
  chars.forEach((ch, i) => {
    const mid = s0 + adv[i] / 2; s0 += adv[i];
    if (mid < 0 || mid > total) return;
    while (seg < cum.length - 1 && cum[seg] < mid) seg++;
    const a = pts[seg - 1], q = pts[seg], len = cum[seg] - cum[seg - 1] || 1, f = (mid - cum[seg - 1]) / len;
    const x = a.x + (q.x - a.x) * f, y = a.y + (q.y - a.y) * f;
    c.save(); c.translate(x, y); c.rotate(Math.atan2(q.y - a.y, q.x - a.x)); c.fillText(ch, -adv[i] / 2, 0); c.restore();
  });
  c.globalAlpha = baseAlpha;
}

function drawText(c: CanvasRenderingContext2D, n: SceneNode, env: DrawEnv) {
  const t = n.text!;
  if (env.hideTextOf === n.id) return;
  const fill = n.fills.find(f => f.visible && f.type !== 'IMAGE');
  if (!fill) return;
  if (n.textPath) { drawTextOnPath(c, n, fill, env); return; }
  const layout = layoutText(t, n.width, c, n.height);
  applyTextStyle(c, t);
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const st = paintStyle(c, fill, n); if (!st) return;
  c.fillStyle = st; c.strokeStyle = st;
  const baseAlpha = c.globalAlpha; c.globalAlpha = baseAlpha * fill.opacity;
  const fs = t.fontSize, lh = layout.lineHeightPx;
  let yOff = t.vAlign === 'MIDDLE' ? Math.max(0, (n.height - layout.height) / 2) : t.vAlign === 'BOTTOM' ? Math.max(0, n.height - layout.height) : 0;
  if (t.trim === 'CAP_HEIGHT') { const capH = c.measureText('H').actualBoundingBoxAscent || fs * 0.72; yOff -= Math.max(0, lh / 2 + fs * 0.35 - capH); }
  const slant = t.slant ? Math.tan((t.slant * Math.PI) / 180) : 0;
  for (const l of layout.lines) {
    const y = yOff + l.top + lh / 2, avail = n.width - l.indent;
    let x = l.indent;
    if (t.align === 'CENTER') x = l.indent + (avail - l.width) / 2; else if (t.align === 'RIGHT') x = n.width - l.width;
    c.save();
    if (slant) { c.translate(x, y); c.transform(1, 0, slant, 1, 0, 0); c.translate(-x, -y); }
    if (l.prefix) c.fillText(l.prefix, 0, y);
    const words = l.text.split(' ');
    if (t.align === 'JUSTIFIED' && !l.last && words.length > 1) {
      const widths = words.map(w => c.measureText(w).width), gap = (avail - widths.reduce((a, b) => a + b, 0)) / (words.length - 1);
      let cx = l.indent; words.forEach((w, i) => { c.fillText(w, cx, y); cx += widths[i] + gap; });
    } else c.fillText(l.text, x, y);
    if (t.decoration && t.decoration !== 'NONE' && l.text) {
      const ly = t.decoration === 'UNDERLINE' ? y + fs * 0.47 : y - fs * 0.02;
      c.lineWidth = Math.max(1, fs / 16); c.beginPath(); c.moveTo(x, ly); c.lineTo(x + l.width, ly); c.stroke();
    }
    c.restore();
  }
  c.globalAlpha = baseAlpha;
  (c as any).letterSpacing = '0px';
}

/** Clip the canvas to a mask layer's outline (drawn in the parent's space). */
function clipToMask(c: CanvasRenderingContext2D, ch: SceneNode) {
  const rr = (ch.rotation * Math.PI) / 180, cs = Math.cos(rr), sn = Math.sin(rr);
  c.beginPath(); c.save();
  c.transform(cs, sn, -sn, cs, ch.x, ch.y);
  if (ch.type === 'VECTOR' && ch.path) tracePath(c, ch); else shapeAppend(c, ch);
  c.restore(); c.clip();
}
/** Children in z-order; a mask layer clips every sibling above it. */
function drawKids(c: CanvasRenderingContext2D, doc: DocumentData, n: SceneNode, env: DrawEnv, m: Mat) {
  let clips = 0;
  for (const id of n.children) {
    const ch = doc.nodes[id];
    if (ch.isMask && ch.visible) { c.save(); clips++; clipToMask(c, ch); continue; }
    drawNode(c, doc, id, env, m);
  }
  while (clips--) c.restore();
}
/** Boolean group: children are combined on an offscreen layer (bottom shape first, the rest add / cut / intersect / exclude). */
function drawBoolean(c: CanvasRenderingContext2D, doc: DocumentData, n: SceneNode, env: DrawEnv, m: Mat) {
  const off = document.createElement('canvas'); off.width = c.canvas.width; off.height = c.canvas.height;
  const o = off.getContext('2d')!;
  o.setTransform(c.getTransform());
  const kids = n.children.filter(id => doc.nodes[id].visible);
  const mode: GlobalCompositeOperation = n.boolOp === 'SUBTRACT' ? 'destination-out' : n.boolOp === 'INTERSECT' ? 'destination-in' : n.boolOp === 'EXCLUDE' ? 'xor' : 'source-over';
  kids.forEach((id, i) => {
    if (i === 0 || n.boolOp === 'UNION') drawNode(o, doc, id, { ...env, composite: i === 0 ? 'source-over' : undefined }, m);
    else drawNode(o, doc, id, { ...env, composite: mode, noStroke: true }, m);
  });
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(off, 0, 0); c.restore();
}

export function drawNode(c: CanvasRenderingContext2D, doc: DocumentData, id: string, env: DrawEnv, parentM: Mat) {
  const n = doc.nodes[id];
  if (!n.visible) return;
  const m = mul(parentM, localMatrix(n));
  let culled = false;
  if (env.view) {
    const b = boundsOfPoints([{ x: 0, y: 0 }, { x: n.width, y: 0 }, { x: n.width, y: n.height }, { x: 0, y: n.height }].map(p => apply(m, p)));
    const pad = 64 + n.strokeWeight + Math.max(0, ...n.effects.map(e => (e.type === 'DROP_SHADOW' ? e.blur * 2 + Math.hypot(e.x, e.y) : e.radius * 3)));
    if (!rectsIntersect({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, env.view)) {
      if (n.type === 'GROUP' || n.clipsContent || !n.children.length) culled = true;
    }
  }
  if (culled) return;
  c.save();
  const rr = (n.rotation * Math.PI) / 180, cs = Math.cos(rr), sn = Math.sin(rr);
  c.transform(cs, sn, -sn, cs, n.x, n.y);
  c.globalAlpha *= n.opacity;
  c.globalCompositeOperation = env.composite ?? BLEND[n.blendMode] ?? 'source-over';
  const blur = n.effects.find(e => e.type === 'LAYER_BLUR' && e.visible);
  if (blur && blur.type === 'LAYER_BLUR') c.filter = `blur(${blur.radius * env.scale}px)`;

  if (n.type === 'TEXT') drawText(c, n, env);
  else if (n.type !== 'GROUP') {
    if (n.type !== 'LINE') fillPaints(c, n, n.fills, env, true);
    if (!env.noStroke) strokePaints(c, n, env);
  }
  if (n.children.length) {
    if (n.type === 'GROUP' && n.boolOp && n.children.length >= 2) drawBoolean(c, doc, n, env, m);
    else {
      c.save();
      if (n.clipsContent) { shapePath(c, n); c.clip(); }
      drawKids(c, doc, n, env, m);
      c.restore();
    }
  }
  if (env.showGuides && n.guides?.length) drawGuides(c, n, env);
  c.restore();
}

export function drawChildren(c: CanvasRenderingContext2D, doc: DocumentData, containerId: string, env: DrawEnv) {
  drawKids(c, doc, doc.nodes[containerId], env, [1, 0, 0, 1, 0, 0]);
}

/** Extra pixels around a node's box that its stroke/effects can paint (for export bounds). */
export function renderPadding(n: SceneNode): number {
  let p = n.strokeAlign === 'OUTSIDE' ? n.strokeWeight * 2 : n.strokeAlign === 'CENTER' ? n.strokeWeight / 2 : 0;
  for (const e of n.effects) if (e.visible) p = Math.max(p, e.type === 'DROP_SHADOW' ? Math.max(Math.abs(e.x), Math.abs(e.y)) + e.blur * 1.5 : e.radius * 2);
  return Math.ceil(p);
}

function drawGuides(c: CanvasRenderingContext2D, n: SceneNode, env: DrawEnv) {
  c.save();
  const px = 1 / env.scale;
  for (const g of n.guides ?? []) {
    if (!g.visible) continue;
    c.fillStyle = rgba(g.color, g.opacity); c.strokeStyle = rgba(g.color, Math.min(1, g.opacity * 2));
    c.lineWidth = px;
    if (g.type === 'GRID') {
      const s = Math.max(1, g.size);
      if (s * env.scale < 4) continue; // too dense to be useful when zoomed out
      c.beginPath();
      for (let x = s; x < n.width; x += s) { c.moveTo(x, 0); c.lineTo(x, n.height); }
      for (let y = s; y < n.height; y += s) { c.moveTo(0, y); c.lineTo(n.width, y); }
      c.stroke();
    } else {
      const horiz = g.type === 'COLUMNS', total = horiz ? n.width : n.height, count = Math.max(1, Math.round(g.size));
      const cell = (total - 2 * g.margin - g.gutter * (count - 1)) / count;
      if (cell <= 0) continue;
      for (let i = 0; i < count; i++) { const o = g.margin + i * (cell + g.gutter); if (horiz) c.fillRect(o, 0, cell, n.height); else c.fillRect(0, o, n.width, cell); }
    }
  }
  c.restore();
}
