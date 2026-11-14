import { useEffect, useMemo, useRef, useState } from 'react';
import { DEVICES, PrototypeRuntime, blendFrames, deviceSpec, ease, flows, topFrames, topFrameOf, worldBounds, type Animation, type DocumentData, type Pt, type Transition } from '@layr/core';
import { drawNode } from '../engine/render';
import { ImageCache } from '../engine/images';
import { Icon } from '../icons';
import { Select } from '../ui/Select';
import { askText, askConfirm } from '../ui/dialogs';

type Dir = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
const VEC: Record<Dir, Pt> = { LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 }, TOP: { x: 0, y: -1 }, BOTTOM: { x: 0, y: 1 } };
const ID = [1, 0, 0, 1, 0, 0] as const;

/** Which frame a "Present" press should start from. */
export function pickStart(doc: DocumentData, pageId: string, selection: string[]): string | null {
  for (const s of selection) { const f = doc.nodes[s] && topFrameOf(doc, s); if (f) return f; }
  const fl = flows(doc).find(f => f.pageId === pageId) ?? flows(doc)[0];
  if (fl) return fl.frameId;
  return topFrames(doc, pageId)[0]?.id ?? null;
}

interface Anim { tr: Transition; start: number; dur: number; ovBefore: { frame: string; origin: Pt; backdrop: boolean }[]; before?: DocumentData }

export function Player({ doc, startFrame, onClose, standalone, fileId }: { doc: DocumentData; startFrame: string; onClose: () => void; standalone?: boolean; fileId?: string }) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const images = useMemo(() => new ImageCache(() => redraw.current()), []);
  const [rt, setRt] = useState(() => new PrototypeRuntime(doc, startFrame));
  const [start, setStart] = useState(startFrame);
  const [fit, setFit] = useState(true);
  const [hotspots, setHotspots] = useState(false);
  const [msg, setMsg] = useState('');
  const [, force] = useState(0);
  const page = doc.nodes[doc.nodes[startFrame]?.parent ?? ''];
  const [device, setDevice] = useState<string>(page?.proto?.device ?? 'NONE');
  const spec = deviceSpec(device);
  const bg = page?.proto?.background ?? '#1e1e1e';
  const redraw = useRef<() => void>(() => {});
  const st = useRef({ queue: [] as Anim[], cur: null as Anim | null, raf: 0, timers: [] as ReturnType<typeof setTimeout>[], fired: new Set<string>(), hover: null as null | { node: string; rect: { x: number; y: number; w: number; h: number } }, hoverChain: [] as string[], down: null as null | { chain: string[]; p: Pt; x: number; y: number; pressed: boolean; dragged: boolean; node?: string }, scale: 1 });
  const vp = rt.doc.nodes[start] ?? rt.doc.nodes[startFrame];
  const W = vp?.width ?? 375, H = vp?.height ?? 812;

  // ---------- drawing ----------
  const env = (scale: number) => ({ images, scale, hideTextOf: null });
  const drawFrame = (c: CanvasRenderingContext2D, d: DocumentData, frameId: string, scale: number, scroll: Pt, dx: number, dy: number, alpha: number) => {
    const fn = d.nodes[frameId]; if (!fn || alpha <= 0) return;
    c.save();
    c.beginPath(); c.rect(0, 0, W, H); c.clip(); // content never leaks outside the viewport
    c.translate(dx, dy); c.globalAlpha *= alpha;
    c.translate(-fn.x, -fn.y);
    const scrolls = fn.overflowScroll && fn.overflowScroll !== 'NONE' && (scroll.x || scroll.y);
    if (!scrolls) drawNode(c, d, frameId, env(scale), ID);
    else {
      const shell = { ...d, nodes: { ...d.nodes, [frameId]: { ...fn, children: [] } } };
      drawNode(c, shell, frameId, env(scale), ID);
      c.save(); c.translate(fn.x, fn.y); c.beginPath(); c.rect(0, 0, fn.width, fn.height); c.clip(); c.translate(-scroll.x, -scroll.y);
      for (const ch of fn.children) drawNode(c, d, ch, env(scale), ID);
      c.restore();
    }
    c.restore();
  };
  const offset = (dir: Dir | undefined, t: number, size = 1) => { const v = VEC[dir ?? 'LEFT']; return { x: -v.x * W * size * (1 - t), y: -v.y * H * size * (1 - t) }; };

  const render = () => {
    const canvas = cvs.current; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1, scale = st.current.scale;
    canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    const c = canvas.getContext('2d')!;
    c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    const a = st.current.cur, d = rt.doc;
    const sc = (f: string) => rt.scroll[f] ?? { x: 0, y: 0 };
    const base = (frame: string) => drawFrame(c, d, frame, scale * dpr, sc(frame), 0, 0, 1);
    const overlays = (list: { frame: string; origin: Pt; backdrop: boolean }[], skip?: string, p?: { frame: string; apply: () => void }) => {
      for (const o of list) {
        if (o.frame === skip) continue;
        if (o.backdrop) { c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(0, 0, W, H); }
        drawFrame(c, d, o.frame, scale * dpr, sc(o.frame), o.origin.x, o.origin.y, 1);
      }
      void p;
    };
    const live = rt.overlays.map((o, i) => ({ frame: o.frame, origin: rt.overlayOrigin(i), backdrop: o.backdrop }));
    if (!a) { base(rt.frame); overlays(live); return; }
    const raw = Math.min(1, (performance.now() - a.start) / Math.max(1, a.dur));
    const tr = a.tr, an = (tr as { anim?: Animation }).anim;
    const p = an ? ease(an.easing, raw) : raw;
    if (tr.kind === 'navigate') {
      const t = an?.type ?? 'INSTANT', dir = an?.direction;
      if (t === 'INSTANT') base(tr.to);
      else if (t === 'DISSOLVE') { base(tr.from); drawFrame(c, d, tr.to, scale * dpr, sc(tr.to), 0, 0, p); }
      else if (t === 'SMART_ANIMATE') { const b = blendFrames(d, tr.from, d, tr.to, p); drawFrame(c, b.doc, b.frameId, scale * dpr, sc(tr.to), 0, 0, 1); }
      else if (t === 'MOVE_IN') { drawFrame(c, d, tr.from, scale * dpr, sc(tr.from), 0, 0, 1); const o = offset(dir, p); drawFrame(c, d, tr.to, scale * dpr, sc(tr.to), o.x, o.y, 1); }
      else if (t === 'MOVE_OUT') { drawFrame(c, d, tr.to, scale * dpr, sc(tr.to), 0, 0, 1); const o = offset(dir, 1 - p); drawFrame(c, d, tr.from, scale * dpr, sc(tr.from), o.x, o.y, 1); }
      else if (t === 'PUSH') { const o = offset(dir, p), o2 = offset(dir, 1 - p); drawFrame(c, d, tr.from, scale * dpr, sc(tr.from), o2.x, o2.y, 1); drawFrame(c, d, tr.to, scale * dpr, sc(tr.to), o.x, o.y, 1); }
      else if (t === 'SLIDE_IN') { const o = offset(dir, p), pa = offset(dir, 1 - p, 0.3); drawFrame(c, d, tr.from, scale * dpr, sc(tr.from), -pa.x, -pa.y, 1); drawFrame(c, d, tr.to, scale * dpr, sc(tr.to), o.x, o.y, 1); }
      else { const o = offset(dir, 1 - p), pb = offset(dir, p, 0.3); drawFrame(c, d, tr.to, scale * dpr, sc(tr.to), -pb.x * -1, -pb.y * -1, 1); drawFrame(c, d, tr.from, scale * dpr, sc(tr.from), o.x, o.y, 1); }
      return;
    }
    if (tr.kind === 'overlayOpen') {
      const idx = rt.overlays.findIndex(o => o.frame === tr.frame); const origin = idx >= 0 ? rt.overlayOrigin(idx) : { x: 0, y: 0 };
      base(rt.frame); overlays(live.filter(o => o.frame !== tr.frame));
      if (tr.backdrop) { c.fillStyle = `rgba(0,0,0,${0.4 * p})`; c.fillRect(0, 0, W, H); }
      const t = tr.anim.type; const mv = ['MOVE_IN', 'SLIDE_IN', 'PUSH'].includes(t);
      const o = mv ? offset(tr.anim.direction, p) : { x: 0, y: 0 };
      drawFrame(c, d, tr.frame, scale * dpr, sc(tr.frame), origin.x + o.x, origin.y + o.y, t === 'DISSOLVE' || t === 'SMART_ANIMATE' ? p : 1);
      return;
    }
    if (tr.kind === 'overlayClose') {
      base(rt.frame); overlays(live);
      const prev = a.ovBefore.find(o => o.frame === tr.frame);
      if (prev) {
        if (prev.backdrop) { c.fillStyle = `rgba(0,0,0,${0.4 * (1 - p)})`; c.fillRect(0, 0, W, H); }
        const t = tr.anim.type; const mv = ['MOVE_IN', 'MOVE_OUT', 'SLIDE_IN', 'SLIDE_OUT', 'PUSH'].includes(t);
        const o = mv ? offset(tr.anim.direction ?? 'BOTTOM', 1 - p) : { x: 0, y: 0 };
        drawFrame(c, d, tr.frame, scale * dpr, sc(tr.frame), prev.origin.x + o.x, prev.origin.y + o.y, t === 'DISSOLVE' || t === 'SMART_ANIMATE' ? 1 - p : 1);
      }
      return;
    }
    if (tr.kind === 'scroll') {
      const cur = { x: tr.from.x + (tr.to.x - tr.from.x) * p, y: tr.from.y + (tr.to.y - tr.from.y) * p };
      drawFrame(c, d, tr.frame, scale * dpr, cur, 0, 0, 1); overlays(live); return;
    }
    if (tr.kind === 'change' && a.before) {
      const t = tr.anim.type;
      if (t === 'SMART_ANIMATE') { const b = blendFrames(a.before, tr.frame, d, tr.frame, p); drawFrame(c, b.doc, b.frameId, scale * dpr, sc(tr.frame), 0, 0, 1); }
      else if (t === 'DISSOLVE') { drawFrame(c, a.before, tr.frame, scale * dpr, sc(tr.frame), 0, 0, 1); drawFrame(c, d, tr.frame, scale * dpr, sc(tr.frame), 0, 0, p); }
      else base(tr.frame);
      overlays(live); return;
    }
    base(rt.frame); overlays(live);
  };
  redraw.current = () => { if (!st.current.cur) render(); };

  // ---------- running transitions ----------
  const settle = () => {
    st.current.timers.forEach(clearTimeout); st.current.timers = [];
    const key = (f: string) => f;
    for (const dl of rt.delayed()) {
      const id = `${key(rt.frame)}:${dl.node}:${dl.interaction.id}`;
      if (st.current.fired.has(id)) continue;
      st.current.fired.add(id);
      st.current.timers.push(setTimeout(() => play(rt.run(dl.interaction.actions, dl.node)), dl.ms));
    }
  };
  const pump = () => {
    const s = st.current;
    if (s.cur) return;
    const next = s.queue.shift();
    if (!next) { render(); settle(); return; }
    s.cur = next;
    const tick = () => {
      render();
      if (performance.now() - next.start >= next.dur) { s.cur = null; s.raf = 0; pump(); } else s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  };
  const play = (trs: Transition[], ovBefore?: Anim['ovBefore']) => {
    for (const t of trs) {
      if (t.kind === 'error') { setMsg(t.message); continue; }
      if (t.kind === 'link') { void askConfirm('Open this link?', { message: t.url, okLabel: 'Open' }).then(yes => { if (yes) window.open(t.url, '_blank', 'noopener,noreferrer'); }); continue; }
      const anim = (t as { anim?: Animation }).anim;
      const dur = !anim || anim.type === 'INSTANT' && t.kind !== 'scroll' ? 0 : anim.duration;
      const before = t.kind === 'change' ? t.before : undefined;
      if (t.kind === 'navigate' && t.to !== t.from) st.current.fired.clear();
      if (dur <= 0) { render(); continue; }
      st.current.queue.push({ tr: t, start: 0, dur, ovBefore: ovBefore ?? [], before });
    }
    const s = st.current;
    for (const q of s.queue) if (!q.start) q.start = performance.now();
    force(n => n + 1); pump();
  };
  const snapshotOverlays = () => rt.overlays.map((o, i) => ({ frame: o.frame, origin: rt.overlayOrigin(i), backdrop: o.backdrop }));
  const fire = (fn: () => Transition[]) => { const ov = snapshotOverlays(); const t = fn(); play(t, ov); };

  // ---------- layout / scale ----------
  useEffect(() => {
    const fitScale = () => { const w = wrap.current; if (!w) return; const pad = !spec ? 40 : 120; st.current.scale = fit ? Math.min((w.clientWidth - pad) / W, (w.clientHeight - pad) / H, 3) : 1; render(); };
    fitScale(); const ro = new ResizeObserver(fitScale); if (wrap.current) ro.observe(wrap.current); return () => ro.disconnect();
  }, [fit, device, W, H, rt, start]);
  useEffect(() => { render(); settle(); return () => { st.current.timers.forEach(clearTimeout); cancelAnimationFrame(st.current.raf); }; }, [rt]);
  useEffect(() => { render(); }, [hotspots]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !standalone) { onClose(); return; }
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) { restart(); return; }
      if (e.key === 'ArrowLeft' && !st.current.cur) { fire(() => rt.run([{ type: 'BACK', anim: { type: 'INSTANT', easing: 'LINEAR', duration: 0 } }], rt.frame)); return; }
      fire(() => rt.fireKey(e.key));
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const restart = () => { st.current.queue = []; st.current.cur = null; st.current.fired.clear(); st.current.timers.forEach(clearTimeout); setMsg(''); const n = new PrototypeRuntime(doc, start); setRt(n); };
  const pickFlow = (frame: string) => { setStart(frame); st.current.queue = []; st.current.cur = null; st.current.fired.clear(); setMsg(''); setRt(new PrototypeRuntime(doc, frame)); };

  // ---------- pointer ----------
  const toVp = (e: React.PointerEvent | React.MouseEvent): Pt => { const r = cvs.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const scrollBy = (frame: string, dx: number, dy: number) => {
    const fn = rt.doc.nodes[frame]; if (!fn?.overflowScroll || fn.overflowScroll === 'NONE') return false;
    let mx = 0, my = 0; for (const c of fn.children) { const n = rt.doc.nodes[c]; mx = Math.max(mx, n.x + n.width - fn.width); my = Math.max(my, n.y + n.height - fn.height); }
    const cur = rt.scroll[frame] ?? { x: 0, y: 0 };
    const next = { x: fn.overflowScroll === 'VERTICAL' ? 0 : Math.min(mx, Math.max(0, cur.x + dx)), y: fn.overflowScroll === 'HORIZONTAL' ? 0 : Math.min(my, Math.max(0, cur.y + dy)) };
    rt.scroll[frame] = next; render(); return next.x !== cur.x || next.y !== cur.y;
  };
  const hoverTarget = (chain: string[]) => { for (let i = chain.length - 1; i >= 0; i--) if (rt.doc.nodes[chain[i]]?.interactions?.some(x => ['HOVER', 'MOUSE_ENTER', 'MOUSE_LEAVE'].includes(x.trigger.type))) return chain[i]; return null; };
  const clickable = (chain: string[]) => chain.some(c => rt.doc.nodes[c]?.interactions?.some(x => ['CLICK', 'PRESS', 'MOUSE_DOWN', 'MOUSE_UP', 'DRAG'].includes(x.trigger.type)));

  const onMove = (e: React.PointerEvent) => {
    const p = toVp(e); const h = rt.hitChainAt(p); const s = st.current;
    if (cvs.current) cvs.current.style.cursor = clickable(h.chain) ? 'pointer' : '';
    if (s.down) {
      const dx = e.clientX - s.down.x, dy = e.clientY - s.down.y;
      if (!s.down.dragged && Math.hypot(dx, dy) > 8) {
        s.down.dragged = true;
        const hit = rt.find(s.down.chain, { type: 'DRAG' });
        if (hit && !s.cur) { fire(() => rt.run(hit.interaction.actions, hit.node)); return; }
      }
      if (s.down.dragged) { const last = (s.down as unknown as { lx?: number; ly?: number }); const ldx = e.clientX - (last.lx ?? s.down.x), ldy = e.clientY - (last.ly ?? s.down.y); last.lx = e.clientX; last.ly = e.clientY; scrollBy(h.frame, -ldx / s.scale, -ldy / s.scale); }
    }
    const hv = s.hover;
    if (hv && !s.cur) {
      // hovering stays in force until the pointer leaves the area of the layer that triggered it
      const inside = p.x >= hv.rect.x && p.y >= hv.rect.y && p.x <= hv.rect.x + hv.rect.w && p.y <= hv.rect.y + hv.rect.h;
      if (inside) return;
      s.hover = null;
      fire(() => { const o = rt.doc.nodes[hv.node]; const out: Transition[] = []; if (o?.interactions?.some(i => i.trigger.type === 'MOUSE_LEAVE')) out.push(...rt.fire({ type: 'MOUSE_LEAVE' }, [hv.node])); if (o?.interactions?.some(i => i.trigger.type === 'HOVER')) out.push(...rt.run([{ type: 'BACK', anim: { type: 'INSTANT', easing: 'LINEAR', duration: 0 } }], hv.node)); return out; });
      return;
    }
    const target = hoverTarget(h.chain);
    if (target && !s.cur && !hv) {
      const f = topFrameOf(rt.doc, target) ?? rt.frame, fr = rt.doc.nodes[f], b = worldBounds(rt.doc, target);
      const oi = rt.overlays.findIndex(o => o.frame === f), org = oi >= 0 ? rt.overlayOrigin(oi) : { x: 0, y: 0 }, sc2 = rt.scroll[f] ?? { x: 0, y: 0 };
      s.hover = { node: target, rect: { x: b.x - fr.x - sc2.x + org.x, y: b.y - fr.y - sc2.y + org.y, w: b.w, h: b.h } };
      fire(() => { const out: Transition[] = []; out.push(...rt.fire({ type: 'MOUSE_ENTER' }, [target])); out.push(...rt.fire({ type: 'HOVER' }, [target])); return out; });
    }
  };
  const onDown = (e: React.PointerEvent) => {
    if (st.current.cur) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toVp(e), h = rt.hitChainAt(p);
    st.current.down = { chain: h.chain, p, x: e.clientX, y: e.clientY, pressed: false, dragged: false };
    const ov = h.overlayIndex >= 0 ? rt.overlays[h.overlayIndex] : null;
    void ov;
    fire(() => { const out = rt.fire({ type: 'MOUSE_DOWN' }, h.chain); const press = rt.find(h.chain, { type: 'PRESS' }); if (press) { st.current.down!.pressed = true; st.current.down!.node = press.node; out.push(...rt.run(press.interaction.actions, press.node)); } return out; });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = st.current.down; st.current.down = null;
    if (!d) return;
    const p = toVp(e), h = rt.hitChainAt(p);
    fire(() => {
      const out: Transition[] = [];
      out.push(...rt.fire({ type: 'MOUSE_UP' }, h.chain));
      if (d.pressed) out.push(...rt.run([{ type: 'BACK', anim: { type: 'INSTANT', easing: 'LINEAR', duration: 0 } }], d.node ?? rt.frame));
      if (!d.dragged) {
        // clicking outside the top overlay closes it when the overlay asks for that
        const top = rt.overlays[rt.overlays.length - 1];
        const outside = top && (h.overlayIndex < rt.overlays.length - 1 || (h.overlayIndex === rt.overlays.length - 1 && !h.chain.length));
        if (top && outside && top.closeOnOutside) out.push(...rt.run([{ type: 'OVERLAY_CLOSE', anim: top.anim }], rt.frame));
        else out.push(...rt.fire({ type: 'CLICK' }, h.chain));
      }
      return out;
    });
  };
  const onWheel = (e: React.WheelEvent) => { const h = rt.hitChainAt(toVp(e)); scrollBy(h.frame, e.shiftKey ? e.deltaY : e.deltaX, e.shiftKey ? 0 : e.deltaY); };

  // hotspots overlay (DOM so it never affects the render)
  const spots = hotspots ? (() => {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    const base = rt.doc.nodes[rt.frame];
    const walk = (id: string, f: string, ox: number, oy: number) => { const n = rt.doc.nodes[id]; if (!n || !n.visible) return; if (n.interactions?.length && id !== f) { const b = worldBounds(rt.doc, id), fr = rt.doc.nodes[f]; const sc = rt.scroll[f] ?? { x: 0, y: 0 }; out.push({ x: b.x - fr.x - sc.x + ox, y: b.y - fr.y - sc.y + oy, w: b.w, h: b.h }); } n.children.forEach(c => walk(c, f, ox, oy)); };
    if (base) walk(rt.frame, rt.frame, 0, 0);
    rt.overlays.forEach((o, i) => { const org = rt.overlayOrigin(i); walk(o.frame, o.frame, org.x, org.y); });
    return out;
  })() : [];

  const flowList = flows(doc);
  const sc = st.current.scale;
  return (
    <div className="player" role="dialog" aria-label="Prototype player">
      <div className="player-bar">
        {!standalone && <button className="btn ghost" onClick={onClose} aria-label="Close player"><Icon n="close" size={14} /> Close</button>}
        {standalone && <button className="btn ghost" onClick={onClose}><Icon n="back" size={14} /> Back</button>}
        <Select aria-label="Flow" value={start} onChange={e => pickFlow(e.target.value)}>
          {flowList.map(f => <option key={f.frameId} value={f.frameId}>Flow: {f.name}</option>)}
          {topFrames(doc, doc.nodes[startFrame]?.parent ?? '').filter(f => !f.flowStart).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => fire(() => rt.run([{ type: 'BACK', anim: { type: 'INSTANT', easing: 'LINEAR', duration: 0 } }], rt.frame))} disabled={!rt.canGoBack} title="Back (←)"><Icon n="back" size={14} /></button>
        <button className="btn ghost" onClick={restart} title="Restart (R)"><Icon n="rotate90" size={14} /> Restart</button>
        <button className={'btn ghost' + (hotspots ? ' on' : '')} aria-pressed={hotspots} onClick={() => setHotspots(!hotspots)} title="Highlight interactive layers">Hotspots</button>
        <Select aria-label="Device" value={spec ? spec.id : 'NONE'} onChange={e => setDevice(e.target.value)}><option value="NONE">No device</option>{(['Phone', 'Tablet', 'Laptop', 'Desktop'] as const).map(g => <optgroup key={g} label={g}>{DEVICES.filter(d => d.group === g).map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</optgroup>)}</Select>
        <button className="btn ghost" onClick={() => setFit(!fit)}>{fit ? 'Fit' : '100%'}</button>
        {!standalone && fileId && <a className="btn ghost" href={`#/play/${fileId}`} target="_blank" rel="noreferrer">Open in new tab</a>}
      </div>
      <div className="player-stage" ref={wrap} style={{ background: bg }}>
        <div className={`device ${spec?.kind ?? ''}`} data-cam={spec?.camera} data-device={spec?.id} style={{ width: W * sc, height: H * sc, ...(spec ? { ['--bezel' as string]: `${spec.bezel}px`, ['--rad' as string]: `${spec.radius}px` } : {}) }}>
          {spec?.kind === 'browser' && <div className="chrome-bar"><i /><i /><i /></div>}
          {spec && ['island', 'notch', 'punch'].includes(spec.camera) && <i className={'cam ' + spec.camera} />}
          <canvas ref={cvs} style={{ width: W * sc, height: H * sc, display: 'block', touchAction: 'none' }} data-testid="player-canvas"
            onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { st.current.down = null; }} onWheel={onWheel} />
          {spots.map((s, i) => <div key={i} className="hotspot" style={{ left: s.x * sc, top: s.y * sc, width: s.w * sc, height: s.h * sc }} />)}
        </div>
      </div>
      <div className="player-foot" aria-live="polite">
        <span className="muted">{rt.doc.nodes[rt.frame]?.name}{rt.overlays.length ? ` + ${rt.overlays.length} overlay` : ''}</span>
        {msg && <span className="perr" role="alert">{msg} <button className="icon-btn" aria-label="Dismiss" onClick={() => setMsg('')}><Icon n="close" size={11} /></button></span>}
        <span className="muted small">R restart · ← back · Esc close · wheel / drag scrolls scrolling frames</span>
      </div>
    </div>
  );
}
